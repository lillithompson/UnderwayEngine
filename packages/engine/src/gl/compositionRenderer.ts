import { CanvasPaintIsland, CompositionState } from '../types';
import { islandHeightCells, islandKey, CANVAS_PAINT_WIDTH_CELLS } from '../canvasPaint';
import { compSnapStep } from '../compositionCellMath';
import { createGLEngine, GLEngine } from './context';
import { QUAD_VERT, INFINITE_GRID_FRAG, CANVAS_PAINT_FRAG } from './shaders';
import { CANVAS_BASE_GREY_GL } from '../colors';

/** One cached canvas-paint island texture. `src` is the rgba array LAST
 *  uploaded (committed islands are immutable, so a reference change means
 *  new bytes); `dirty` covers the one mutable case — the in-stroke working
 *  copy, whose bytes change under a stable reference. The canvas calls
 *  invalidateCanvasPaint() with the stamped island keys to flag them. */
interface PaintTexEntry {
  tex: WebGLTexture;
  cols: number;
  rows: number;
  src: Uint8Array | null;
  dirty: boolean;
}

export class CompositionRenderer {
  private engine: GLEngine;
  private gridProgram: WebGLProgram;
  private paintProgram: WebGLProgram;
  private quadBuffer: WebGLBuffer;
  // Canvas paint island textures, keyed by island origin (islandKey). All
  // islands are tile-sized, so evicted entries free a bounded 64 KB each.
  private paintTextures = new Map<string, PaintTexEntry>();
  private paintPremul: Uint8Array | null = null;

  constructor(gl: WebGLRenderingContext) {
    this.engine = createGLEngine(gl);
    const { compileShader, linkProgram, createQuadBuffer } = this.engine;

    const quadVert = compileShader(gl.VERTEX_SHADER, QUAD_VERT);
    const gridFrag = compileShader(gl.FRAGMENT_SHADER, INFINITE_GRID_FRAG);
    this.gridProgram = linkProgram(quadVert, gridFrag);
    const paintFrag = compileShader(gl.FRAGMENT_SHADER, CANVAS_PAINT_FRAG);
    this.paintProgram = linkProgram(quadVert, paintFrag);

    gl.detachShader(this.gridProgram, quadVert);
    gl.detachShader(this.gridProgram, gridFrag);
    gl.detachShader(this.paintProgram, quadVert);
    gl.detachShader(this.paintProgram, paintFrag);
    gl.deleteShader(quadVert);
    gl.deleteShader(gridFrag);
    gl.deleteShader(paintFrag);

    this.quadBuffer = createQuadBuffer();
  }

  render(state: CompositionState, onPostRender?: (gl: WebGLRenderingContext) => void): void {
    const gl = this.engine.gl;
    const { viewport, camera, gridLevel, gridIntensity } = state;

    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;
    gl.viewport(0, 0, bufW, bufH);
    gl.clearColor(...CANVAS_BASE_GREY_GL, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const aspect = bufW / (bufH || 1);
    const offsetU = camera.offsetX / (viewport.width || 1);
    const offsetV = camera.offsetY / (viewport.width || 1);

    this.drawGrid(offsetU, offsetV, camera.zoom, aspect, bufW, bufH, 32 / compSnapStep(gridLevel), gridIntensity);

    // Canvas paint islands: over the grid, under every DOM-rendered scene
    // object (the whole world layer stacks above this GL surface).
    this.drawCanvasPaint(state.canvasPaint, offsetU, offsetV, camera.zoom, aspect);

    gl.flush();
    onPostRender?.(gl);
    (gl as any).endFrameEXP?.();
  }

  /** Flag islands' bytes as changed under stable array references (the
   *  in-stroke working copies) — next render re-uploads those textures.
   *  With no keys, every cached island is flagged. */
  invalidateCanvasPaint(keys?: Iterable<string>): void {
    if (!keys) {
      for (const entry of this.paintTextures.values()) entry.dirty = true;
      return;
    }
    for (const key of keys) {
      const entry = this.paintTextures.get(key);
      if (entry) entry.dirty = true;
    }
  }

  /** (Re)upload one island's texture when its bytes changed. Uploaded
   *  PREMULTIPLIED so the LINEAR upscale can't bleed transparent-black
   *  fringes into a dab's soft edge (the draw blends ONE, 1−srcA). */
  private uploadIsland(key: string, isl: CanvasPaintIsland): PaintTexEntry {
    const gl = this.engine.gl;
    const { cols, rows, rgba } = isl.overlay;
    let entry = this.paintTextures.get(key);
    if (!entry || entry.cols !== cols || entry.rows !== rows) {
      if (entry) gl.deleteTexture(entry.tex);
      entry = {
        tex: this.engine.createTexture(cols, rows, null, gl.LINEAR),
        cols, rows, src: null, dirty: false,
      };
      this.paintTextures.set(key, entry);
    }
    if (entry.src === rgba && !entry.dirty) return entry;
    const n = rgba.length;
    // One reusable scratch — islands are uniformly tile-sized, so this
    // allocates once and stays.
    if (!this.paintPremul || this.paintPremul.length < n) this.paintPremul = new Uint8Array(n);
    const dst = this.paintPremul;
    for (let i = 0; i < n; i += 4) {
      const a = rgba[i + 3];
      if (a === 0) {
        dst[i] = 0; dst[i + 1] = 0; dst[i + 2] = 0; dst[i + 3] = 0;
      } else if (a === 255) {
        dst[i] = rgba[i]; dst[i + 1] = rgba[i + 1]; dst[i + 2] = rgba[i + 2]; dst[i + 3] = 255;
      } else {
        dst[i] = (rgba[i] * a + 127) / 255 | 0;
        dst[i + 1] = (rgba[i + 1] * a + 127) / 255 | 0;
        dst[i + 2] = (rgba[i + 2] * a + 127) / 255 | 0;
        dst[i + 3] = a;
      }
    }
    this.engine.updateTextureRegion(entry.tex, 0, 0, cols, rows, dst, cols);
    entry.src = rgba;
    entry.dirty = false;
    return entry;
  }

  private drawCanvasPaint(
    islands: readonly CanvasPaintIsland[] | undefined,
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
  ): void {
    const gl = this.engine.gl;
    // Evict textures for islands no longer in the scene (undo of a stroke,
    // erased-empty prune) so the cache tracks the drawing, not its history.
    if (this.paintTextures.size > 0) {
      const live = new Set((islands ?? []).map((i) => islandKey(i.x, i.y)));
      for (const [key, entry] of this.paintTextures) {
        if (!live.has(key)) {
          gl.deleteTexture(entry.tex);
          this.paintTextures.delete(key);
        }
      }
    }
    if (!islands || islands.length === 0) return;

    const prog = this.paintProgram;
    gl.useProgram(prog);
    this.bindQuad(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_texture'), 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_offset'), offsetU, offsetV);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_zoom'), zoom);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_aspect'), aspect);
    const rectLoc = gl.getUniformLocation(prog, 'u_rect');

    // Premultiplied sources — see uploadIsland.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const isl of islands) {
      const key = islandKey(isl.x, isl.y);
      const entry = this.uploadIsland(key, isl);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      // Island rect in layer-UV space: 1 UV unit = 32 world cells (the
      // legacy page width — the unit the camera uniforms are expressed in).
      const u = CANVAS_PAINT_WIDTH_CELLS;
      gl.uniform4f(rectLoc, isl.x / u, isl.y / u,
        isl.widthCells / u, islandHeightCells(isl) / u);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private drawGrid(
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
    viewportW: number,
    viewportH: number,
    cellCount: number,
    gridIntensity: number,
  ): void {
    const gl = this.engine.gl;
    const prog = this.gridProgram;
    gl.useProgram(prog);

    this.bindQuad(prog);

    gl.uniform1f(gl.getUniformLocation(prog, 'u_cellCount'), cellCount);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_offset'), offsetU, offsetV);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_zoom'), zoom);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_aspect'), aspect);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), viewportW, viewportH);

    gl.uniform3f(gl.getUniformLocation(prog, 'u_bgColor'), ...CANVAS_BASE_GREY_GL);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_gridIntensity'), gridIntensity);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.engine.gl;
    gl.deleteProgram(this.gridProgram);
    gl.deleteProgram(this.paintProgram);
    for (const entry of this.paintTextures.values()) gl.deleteTexture(entry.tex);
    this.paintTextures.clear();
    gl.deleteBuffer(this.quadBuffer);
  }

  private bindQuad(program: WebGLProgram): void {
    const gl = this.engine.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

    const uvLoc = gl.getAttribLocation(program, 'a_uv');
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
  }
}

/** Inverse of (rotate * mirrorH * mirrorV) around the origin, returned as a
 *  column-major mat2: [c0.x, c0.y, c1.x, c1.y]. The forward transform
 *  matches the translate-rotate-mirror-translate blocks in
 *  engine/svgFigureBuilders.ts (buildFigureSVGContent / buildBlockSVGContent). Mirrors are involutions; rotation
 *  inverse is rotation by -angle. y-axis points down so positive rotation
 *  is clockwise — matches SVG semantics. */
export function computeInverseRotMirror(
  rotation: number,
  mirrorH: boolean,
  mirrorV: boolean,
): [number, number, number, number] {
  // R(-angle): inverse rotation matrix. For 0/90/180/270, integer entries.
  let r00: number, r01: number, r10: number, r11: number;
  switch (rotation) {
    case 90:  r00 = 0;  r01 = 1;  r10 = -1; r11 = 0;  break; // R(-90)
    case 180: r00 = -1; r01 = 0;  r10 = 0;  r11 = -1; break;
    case 270: r00 = 0;  r01 = -1; r10 = 1;  r11 = 0;  break; // R(-270)=R(90)
    default:  r00 = 1;  r01 = 0;  r10 = 0;  r11 = 1;  break;
  }
  // Premultiply by mirror (mirror is its own inverse). M = diag(sx, sy)
  // with sx = mirrorH ? -1 : 1, sy = mirrorV ? -1 : 1. M*R: scale rows.
  const sx = mirrorH ? -1 : 1;
  const sy = mirrorV ? -1 : 1;
  const m00 = sx * r00, m01 = sx * r01;
  const m10 = sy * r10, m11 = sy * r11;
  // Column-major: [c0.x=m00, c0.y=m10, c1.x=m01, c1.y=m11].
  return [m00, m10, m01, m11];
}
