import { CompositionState } from '../types';
import { compSnapStep } from '../compositionCellMath';
import { createGLEngine, GLEngine } from './context';
import { QUAD_VERT, INFINITE_GRID_FRAG } from './shaders';

export class CompositionRenderer {
  private engine: GLEngine;
  private gridProgram: WebGLProgram;
  private quadBuffer: WebGLBuffer;

  constructor(gl: WebGLRenderingContext) {
    this.engine = createGLEngine(gl);
    const { compileShader, linkProgram, createQuadBuffer } = this.engine;

    const quadVert = compileShader(gl.VERTEX_SHADER, QUAD_VERT);
    const gridFrag = compileShader(gl.FRAGMENT_SHADER, INFINITE_GRID_FRAG);
    this.gridProgram = linkProgram(quadVert, gridFrag);

    gl.detachShader(this.gridProgram, quadVert);
    gl.detachShader(this.gridProgram, gridFrag);
    gl.deleteShader(quadVert);
    gl.deleteShader(gridFrag);

    this.quadBuffer = createQuadBuffer();
  }

  render(state: CompositionState, onPostRender?: (gl: WebGLRenderingContext) => void): void {
    const gl = this.engine.gl;
    const { viewport, camera, gridLevel, gridIntensity } = state;

    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;
    gl.viewport(0, 0, bufW, bufH);
    gl.clearColor(0.02, 0.016, 0.031, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const aspect = bufW / (bufH || 1);
    const offsetU = camera.offsetX / (viewport.width || 1);
    const offsetV = camera.offsetY / (viewport.width || 1);

    this.drawGrid(offsetU, offsetV, camera.zoom, aspect, bufW, bufH, 32 / compSnapStep(gridLevel), gridIntensity);

    gl.flush();
    onPostRender?.(gl);
    (gl as any).endFrameEXP?.();
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

    gl.uniform3f(gl.getUniformLocation(prog, 'u_bgColor'), 0.02, 0.016, 0.031);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_gridIntensity'), gridIntensity);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.engine.gl;
    gl.deleteProgram(this.gridProgram);
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
