import { EditorState, Layer, LAYER_PX, CELL_COUNTS, coalesceDirtyRects, viewportInsets, effectiveCanvasDims } from '../types';
import { computeBaseCamera } from '../state';
import { createGLEngine, GLEngine } from './context';
import { QUAD_VERT, LAYER_FRAG, GRID_FRAG, MIRROR_FRAG, SELECTION_FRAG, CLONE_OVERLAY_FRAG, PATH_SELECTION_FRAG } from './shaders';
import { mirrorOverlayAxes } from '../canvas-bounds';
import { CANVAS_BASE_GREY_GL } from '../colors';

/** Cached uniform locations for a shader program */
interface LayerLocs {
  u_texture: WebGLUniformLocation | null;
  u_opacity: WebGLUniformLocation | null;
  u_offset: WebGLUniformLocation | null;
  u_zoom: WebGLUniformLocation | null;
  u_aspect: WebGLUniformLocation | null;
  u_highlightMode: WebGLUniformLocation | null;
  u_isHighlighted: WebGLUniformLocation | null;
  u_boundsMin: WebGLUniformLocation | null;
  u_boundsMax: WebGLUniformLocation | null;
  a_position: number;
  a_uv: number;
}

interface GridLocs {
  u_cellCount: WebGLUniformLocation | null;
  u_offset: WebGLUniformLocation | null;
  u_zoom: WebGLUniformLocation | null;
  u_aspect: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_shiftX: WebGLUniformLocation | null;
  u_shiftY: WebGLUniformLocation | null;
  u_bgColor: WebGLUniformLocation | null;
  u_gridIntensity: WebGLUniformLocation | null;
  u_boundsMin: WebGLUniformLocation | null;
  u_boundsMax: WebGLUniformLocation | null;
  a_position: number;
  a_uv: number;
}

interface MirrorLocs {
  u_mirrorH: WebGLUniformLocation | null;
  u_mirrorV: WebGLUniformLocation | null;
  u_quadLinesH: WebGLUniformLocation | null;
  u_quadLinesV: WebGLUniformLocation | null;
  u_diag1: WebGLUniformLocation | null;
  u_diag2: WebGLUniformLocation | null;
  u_offset: WebGLUniformLocation | null;
  u_zoom: WebGLUniformLocation | null;
  u_aspect: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_mirrorCenter: WebGLUniformLocation | null;
  u_boundsMin: WebGLUniformLocation | null;
  u_boundsMax: WebGLUniformLocation | null;
  u_dashH: WebGLUniformLocation | null;
  u_dashV: WebGLUniformLocation | null;
  u_dashQuadH: WebGLUniformLocation | null;
  u_dashQuadV: WebGLUniformLocation | null;
  u_dashPeriod: WebGLUniformLocation | null;
  u_firstHalfU: WebGLUniformLocation | null;
  u_secondHalfU: WebGLUniformLocation | null;
  u_firstHalfV: WebGLUniformLocation | null;
  u_secondHalfV: WebGLUniformLocation | null;
  u_diagCenter: WebGLUniformLocation | null;
  a_position: number;
  a_uv: number;
}

interface SelectionLocs {
  u_selMinUV: WebGLUniformLocation | null;
  u_selMaxUV: WebGLUniformLocation | null;
  u_previewMinUV: WebGLUniformLocation | null;
  u_previewMaxUV: WebGLUniformLocation | null;
  u_hasMovePreview: WebGLUniformLocation | null;
  u_orientStartUV: WebGLUniformLocation | null;
  u_orientEndUV: WebGLUniformLocation | null;
  u_hasOrientLine: WebGLUniformLocation | null;
  u_offset: WebGLUniformLocation | null;
  u_zoom: WebGLUniformLocation | null;
  u_aspect: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_boundsMin: WebGLUniformLocation | null;
  u_boundsMax: WebGLUniformLocation | null;
  a_position: number;
  a_uv: number;
}

interface CloneOverlayLocs {
  u_cellCount: WebGLUniformLocation | null;
  u_sourceUV: WebGLUniformLocation | null;
  u_sampleUV: WebGLUniformLocation | null;
  u_anchorUV: WebGLUniformLocation | null;
  u_cursorUV: WebGLUniformLocation | null;
  u_sourceEnabled: WebGLUniformLocation | null;
  u_sampleEnabled: WebGLUniformLocation | null;
  u_anchorEnabled: WebGLUniformLocation | null;
  u_cursorEnabled: WebGLUniformLocation | null;
  u_offset: WebGLUniformLocation | null;
  u_zoom: WebGLUniformLocation | null;
  u_aspect: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_boundsMin: WebGLUniformLocation | null;
  u_boundsMax: WebGLUniformLocation | null;
  a_position: number;
  a_uv: number;
}

export class Renderer {
  private engine: GLEngine;
  private layerProgram: WebGLProgram;
  private gridProgram: WebGLProgram;
  private mirrorProgram: WebGLProgram;
  private selectionProgram: WebGLProgram;
  private cloneOverlayProgram: WebGLProgram;
  private pathSelectionProgram: WebGLProgram;
  private quadBuffer: WebGLBuffer;
  private textures = new Map<string, WebGLTexture>();
  // Pool of full-layer (LAYER_PX × LAYER_PX) WebGLTextures released from
  // `textures` but kept for reuse across file switches. On iOS each
  // 2048×2048 RGBA texture is a ~16 MB IOSurface; without pooling, opening
  // many figures back-to-back created tens of GB of IOSurface churn.
  private freeTexturePool: WebGLTexture[] = [];
  // 1 slot covers the common "switch between two figures" path while keeping
  // pooled GPU resident under ~16 MB. Higher values compounded WKWebView GPU
  // pressure on iOS and contributed to the figure-editor blank-canvas bug.
  private static readonly FREE_TEXTURE_POOL_MAX = 1;
  private pathTexture: WebGLTexture | null = null;
  private pathTexGeneration = -1;

  // Cached locations
  private layerLocs: LayerLocs;
  private gridLocs: GridLocs;
  private mirrorLocs: MirrorLocs;
  private selectionLocs: SelectionLocs;
  private cloneOverlayLocs: CloneOverlayLocs;

  // Reusable sorted-layers buffer to avoid per-frame allocation
  private sortedLayersBuf: Layer[] = [];

  // Grid line intensity (matches CompositionState.gridIntensity range, 0..1).
  // Pushed in from the host (Canvas) so the figure editor tracks the parent
  // composition's "Grid Weight" slider. Defaults to the composition default
  // so standalone use still renders sensibly.
  gridIntensity: number = 0.5;

  constructor(gl: WebGLRenderingContext) {
    this.engine = createGLEngine(gl);
    const { compileShader, linkProgram, createQuadBuffer } = this.engine;

    // Compile shaders
    const quadVert = compileShader(gl.VERTEX_SHADER, QUAD_VERT);
    const layerFrag = compileShader(gl.FRAGMENT_SHADER, LAYER_FRAG);
    const gridFrag = compileShader(gl.FRAGMENT_SHADER, GRID_FRAG);
    const mirrorFrag = compileShader(gl.FRAGMENT_SHADER, MIRROR_FRAG);
    const selectionFrag = compileShader(gl.FRAGMENT_SHADER, SELECTION_FRAG);
    const cloneOverlayFrag = compileShader(gl.FRAGMENT_SHADER, CLONE_OVERLAY_FRAG);
    const pathSelectionFrag = compileShader(gl.FRAGMENT_SHADER, PATH_SELECTION_FRAG);

    this.layerProgram = linkProgram(quadVert, layerFrag);
    this.gridProgram = linkProgram(quadVert, gridFrag);
    this.mirrorProgram = linkProgram(quadVert, mirrorFrag);
    this.selectionProgram = linkProgram(quadVert, selectionFrag);
    this.cloneOverlayProgram = linkProgram(quadVert, cloneOverlayFrag);
    this.pathSelectionProgram = linkProgram(quadVert, pathSelectionFrag);

    const programs = [
      this.layerProgram, this.gridProgram,
      this.mirrorProgram, this.selectionProgram, this.cloneOverlayProgram,
      this.pathSelectionProgram,
    ];
    const frags = [
      layerFrag, gridFrag, mirrorFrag,
      selectionFrag, cloneOverlayFrag, pathSelectionFrag,
    ];
    for (const prog of programs) gl.detachShader(prog, quadVert);
    gl.deleteShader(quadVert);
    for (let i = 0; i < programs.length; i++) {
      gl.detachShader(programs[i], frags[i]);
      gl.deleteShader(frags[i]);
    }

    this.quadBuffer = createQuadBuffer();

    // Cache all uniform and attribute locations once after linking

    this.layerLocs = {
      u_texture: gl.getUniformLocation(this.layerProgram, 'u_texture'),
      u_opacity: gl.getUniformLocation(this.layerProgram, 'u_opacity'),
      u_offset: gl.getUniformLocation(this.layerProgram, 'u_offset'),
      u_zoom: gl.getUniformLocation(this.layerProgram, 'u_zoom'),
      u_aspect: gl.getUniformLocation(this.layerProgram, 'u_aspect'),
      u_highlightMode: gl.getUniformLocation(this.layerProgram, 'u_highlightMode'),
      u_isHighlighted: gl.getUniformLocation(this.layerProgram, 'u_isHighlighted'),
      u_boundsMin: gl.getUniformLocation(this.layerProgram, 'u_boundsMin'),
      u_boundsMax: gl.getUniformLocation(this.layerProgram, 'u_boundsMax'),
      a_position: gl.getAttribLocation(this.layerProgram, 'a_position'),
      a_uv: gl.getAttribLocation(this.layerProgram, 'a_uv'),
    };

    this.gridLocs = {
      u_cellCount: gl.getUniformLocation(this.gridProgram, 'u_cellCount'),
      u_offset: gl.getUniformLocation(this.gridProgram, 'u_offset'),
      u_zoom: gl.getUniformLocation(this.gridProgram, 'u_zoom'),
      u_aspect: gl.getUniformLocation(this.gridProgram, 'u_aspect'),
      u_resolution: gl.getUniformLocation(this.gridProgram, 'u_resolution'),
      u_shiftX: gl.getUniformLocation(this.gridProgram, 'u_shiftX'),
      u_shiftY: gl.getUniformLocation(this.gridProgram, 'u_shiftY'),
      u_bgColor: gl.getUniformLocation(this.gridProgram, 'u_bgColor'),
      u_gridIntensity: gl.getUniformLocation(this.gridProgram, 'u_gridIntensity'),
      u_boundsMin: gl.getUniformLocation(this.gridProgram, 'u_boundsMin'),
      u_boundsMax: gl.getUniformLocation(this.gridProgram, 'u_boundsMax'),
      a_position: gl.getAttribLocation(this.gridProgram, 'a_position'),
      a_uv: gl.getAttribLocation(this.gridProgram, 'a_uv'),
    };

    this.mirrorLocs = {
      u_mirrorH: gl.getUniformLocation(this.mirrorProgram, 'u_mirrorH'),
      u_mirrorV: gl.getUniformLocation(this.mirrorProgram, 'u_mirrorV'),
      u_quadLinesH: gl.getUniformLocation(this.mirrorProgram, 'u_quadLinesH'),
      u_quadLinesV: gl.getUniformLocation(this.mirrorProgram, 'u_quadLinesV'),
      u_diag1: gl.getUniformLocation(this.mirrorProgram, 'u_diag1'),
      u_diag2: gl.getUniformLocation(this.mirrorProgram, 'u_diag2'),
      u_offset: gl.getUniformLocation(this.mirrorProgram, 'u_offset'),
      u_zoom: gl.getUniformLocation(this.mirrorProgram, 'u_zoom'),
      u_aspect: gl.getUniformLocation(this.mirrorProgram, 'u_aspect'),
      u_resolution: gl.getUniformLocation(this.mirrorProgram, 'u_resolution'),
      u_mirrorCenter: gl.getUniformLocation(this.mirrorProgram, 'u_mirrorCenter'),
      u_boundsMin: gl.getUniformLocation(this.mirrorProgram, 'u_boundsMin'),
      u_boundsMax: gl.getUniformLocation(this.mirrorProgram, 'u_boundsMax'),
      u_dashH: gl.getUniformLocation(this.mirrorProgram, 'u_dashH'),
      u_dashV: gl.getUniformLocation(this.mirrorProgram, 'u_dashV'),
      u_dashQuadH: gl.getUniformLocation(this.mirrorProgram, 'u_dashQuadH'),
      u_dashQuadV: gl.getUniformLocation(this.mirrorProgram, 'u_dashQuadV'),
      u_dashPeriod: gl.getUniformLocation(this.mirrorProgram, 'u_dashPeriod'),
      u_firstHalfU: gl.getUniformLocation(this.mirrorProgram, 'u_firstHalfU'),
      u_secondHalfU: gl.getUniformLocation(this.mirrorProgram, 'u_secondHalfU'),
      u_firstHalfV: gl.getUniformLocation(this.mirrorProgram, 'u_firstHalfV'),
      u_secondHalfV: gl.getUniformLocation(this.mirrorProgram, 'u_secondHalfV'),
      u_diagCenter: gl.getUniformLocation(this.mirrorProgram, 'u_diagCenter'),
      a_position: gl.getAttribLocation(this.mirrorProgram, 'a_position'),
      a_uv: gl.getAttribLocation(this.mirrorProgram, 'a_uv'),
    };

    this.selectionLocs = {
      u_selMinUV: gl.getUniformLocation(this.selectionProgram, 'u_selMinUV'),
      u_selMaxUV: gl.getUniformLocation(this.selectionProgram, 'u_selMaxUV'),
      u_previewMinUV: gl.getUniformLocation(this.selectionProgram, 'u_previewMinUV'),
      u_previewMaxUV: gl.getUniformLocation(this.selectionProgram, 'u_previewMaxUV'),
      u_hasMovePreview: gl.getUniformLocation(this.selectionProgram, 'u_hasMovePreview'),
      u_orientStartUV: gl.getUniformLocation(this.selectionProgram, 'u_orientStartUV'),
      u_orientEndUV: gl.getUniformLocation(this.selectionProgram, 'u_orientEndUV'),
      u_hasOrientLine: gl.getUniformLocation(this.selectionProgram, 'u_hasOrientLine'),
      u_offset: gl.getUniformLocation(this.selectionProgram, 'u_offset'),
      u_zoom: gl.getUniformLocation(this.selectionProgram, 'u_zoom'),
      u_aspect: gl.getUniformLocation(this.selectionProgram, 'u_aspect'),
      u_resolution: gl.getUniformLocation(this.selectionProgram, 'u_resolution'),
      u_boundsMin: gl.getUniformLocation(this.selectionProgram, 'u_boundsMin'),
      u_boundsMax: gl.getUniformLocation(this.selectionProgram, 'u_boundsMax'),
      a_position: gl.getAttribLocation(this.selectionProgram, 'a_position'),
      a_uv: gl.getAttribLocation(this.selectionProgram, 'a_uv'),
    };

    this.cloneOverlayLocs = {
      u_cellCount: gl.getUniformLocation(this.cloneOverlayProgram, 'u_cellCount'),
      u_sourceUV: gl.getUniformLocation(this.cloneOverlayProgram, 'u_sourceUV'),
      u_sampleUV: gl.getUniformLocation(this.cloneOverlayProgram, 'u_sampleUV'),
      u_anchorUV: gl.getUniformLocation(this.cloneOverlayProgram, 'u_anchorUV'),
      u_cursorUV: gl.getUniformLocation(this.cloneOverlayProgram, 'u_cursorUV'),
      u_sourceEnabled: gl.getUniformLocation(this.cloneOverlayProgram, 'u_sourceEnabled'),
      u_sampleEnabled: gl.getUniformLocation(this.cloneOverlayProgram, 'u_sampleEnabled'),
      u_anchorEnabled: gl.getUniformLocation(this.cloneOverlayProgram, 'u_anchorEnabled'),
      u_cursorEnabled: gl.getUniformLocation(this.cloneOverlayProgram, 'u_cursorEnabled'),
      u_offset: gl.getUniformLocation(this.cloneOverlayProgram, 'u_offset'),
      u_zoom: gl.getUniformLocation(this.cloneOverlayProgram, 'u_zoom'),
      u_aspect: gl.getUniformLocation(this.cloneOverlayProgram, 'u_aspect'),
      u_resolution: gl.getUniformLocation(this.cloneOverlayProgram, 'u_resolution'),
      u_boundsMin: gl.getUniformLocation(this.cloneOverlayProgram, 'u_boundsMin'),
      u_boundsMax: gl.getUniformLocation(this.cloneOverlayProgram, 'u_boundsMax'),
      a_position: gl.getAttribLocation(this.cloneOverlayProgram, 'a_position'),
      a_uv: gl.getAttribLocation(this.cloneOverlayProgram, 'a_uv'),
    };
  }

  render(state: EditorState, activeLayerOverride?: Layer, highlightedLayerId?: string | null): void {
    const gl = this.engine.gl;
    const { viewport, camera, layers } = state;

    // Use actual drawingBuffer size to cover the full GL surface
    const bufW = gl.drawingBufferWidth;
    const bufH = gl.drawingBufferHeight;

    gl.viewport(0, 0, bufW, bufH);
    const activeLayer = activeLayerOverride ?? layers.find((l) => l.id === state.activeLayerId);
    // Black margin: the figure editor's backdrop matches the studio chrome
    // around it (PatternStudio's BG_BLACK). The canvas itself is painted
    // opaquely by the grid pass on top, so the clear only shows in the margin
    // — no fullscreen quad needed to fill it.
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const aspect = bufW / (bufH || 1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Compute effective camera uniforms (base camera frames the visible canvas area).
    // When a clip box is set, it defines the visible area.
    const vw = viewport.width || 1;
    const dims = effectiveCanvasDims(state.fileConfig, state.resizingCanvas);
    const { baseZoom, baseOffsetU, baseOffsetV } = computeBaseCamera(
      dims.widthL0, dims.heightL0, vw, viewport.height || 1, viewportInsets(viewport), dims.originL0X, dims.originL0Y);
    const effectiveZoom = camera.zoom * baseZoom;
    const effectiveOffsetU = camera.offsetX / vw + baseOffsetU;
    const effectiveOffsetV = camera.offsetY / vw + baseOffsetV;

    // Canvas window in layer UV [origin/32, (origin+dim)/32].
    const boundsMinU = dims.originL0X / 32;
    const boundsMinV = dims.originL0Y / 32;
    const boundsMaxU = (dims.originL0X + dims.widthL0) / 32;
    const boundsMaxV = (dims.originL0Y + dims.heightL0) / 32;

    // Draw grid underneath layers
    if (activeLayer) {
      this.drawGrid(
        CELL_COUNTS[activeLayer.level],
        effectiveOffsetU,
        effectiveOffsetV,
        effectiveZoom,
        aspect,
        bufW,
        bufH,
        activeLayer.shiftX,
        activeLayer.shiftY,
        boundsMinU,
        boundsMinV,
        boundsMaxU,
        boundsMaxV,
      );
    }

    // Draw visible layers sorted by order (reuse buffer to avoid allocation)
    const buf = this.sortedLayersBuf;
    buf.length = 0;
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].visible) buf.push(layers[i]);
    }
    buf.sort((a, b) => {
      const aH = a.id === highlightedLayerId ? 1 : 0;
      const bH = b.id === highlightedLayerId ? 1 : 0;
      if (aH !== bH) return aH - bH;
      return a.order - b.order;
    });

    const hlMode = highlightedLayerId != null;
    for (let i = 0; i < buf.length; i++) {
      const layer = buf[i];
      this.ensureTexture(layer);
      const isHl = hlMode && layer.id === highlightedLayerId;
      this.drawLayer(layer, effectiveOffsetU, effectiveOffsetV, effectiveZoom, aspect, boundsMinU, boundsMinV, boundsMaxU, boundsMaxV, hlMode, isHl);
    }

    // Draw mirror axis lines when active (hidden during canvas resize drag).
    // Line positions come from the *active layer's* cell-window axis, not
    // the canvas pixel midpoint, so the rendered overlay tracks the
    // engine's actual mirror axis at this resolution. See
    // `mirrorOverlayAxes` for the math and the dash-flag derivation.
    if (!state.resizingCanvas && activeLayer && (state.mirrorH || state.mirrorV || state.mirrorRotate || state.mirrorQuad || state.mirrorRow || state.mirrorCol || state.mirrorDiag1 || state.mirrorDiag2 || state.mirrorDiagBoth || state.mirrorStar)) {
      const axes = mirrorOverlayAxes(activeLayer, dims);
      // Diagonals always bisect cells diagonally → drawn dashed
      // unconditionally when enabled. The shader uses u_dashPeriod alone
      // for that, so no separate diag dash flag is needed.
      this.drawMirrorLines(
        state.mirrorH || state.mirrorRotate || state.mirrorQuad || state.mirrorCol || state.mirrorStar,
        state.mirrorV || state.mirrorRotate || state.mirrorQuad || state.mirrorRow || state.mirrorStar,
        effectiveOffsetU,
        effectiveOffsetV,
        effectiveZoom,
        aspect,
        bufW,
        bufH,
        [axes.centerU, axes.centerV],
        boundsMinU,
        boundsMinV,
        boundsMaxU,
        boundsMaxV,
        state.mirrorQuad || state.mirrorCol,
        state.mirrorQuad || state.mirrorRow,
        state.mirrorDiag1 || state.mirrorDiagBoth || state.mirrorStar,
        state.mirrorDiag2 || state.mirrorDiagBoth || state.mirrorStar,
        axes.dashH,
        axes.dashV,
        axes.dashQuadH,
        axes.dashQuadV,
        axes.dashPeriod,
        axes.firstHalfU,
        axes.secondHalfU,
        axes.firstHalfV,
        axes.secondHalfV,
        [axes.diagCenterU, axes.diagCenterV],
      );
    }

    // Draw clone overlay
    if (state.tool.type === 'clone' && activeLayer) {
      const cellCount = CELL_COUNTS[activeLayer.level];
      this.drawCloneOverlay(
        cellCount,
        state.cloneSourceIndex,
        state.cloneSampleIndex,
        state.cloneAnchorIndex,
        state.cloneCursorIndex,
        effectiveOffsetU,
        effectiveOffsetV,
        effectiveZoom,
        aspect,
        bufW,
        bufH,
        activeLayer.shiftX,
        activeLayer.shiftY,
        boundsMinU,
        boundsMinV,
        boundsMaxU,
        boundsMaxV,
      );
    }

    // Draw path selection overlay
    if (state.selectionMode === 'path' && state.pathIndices.size > 0 && state.pathL0Indices) {
      this.drawPathSelection(
        state,
        effectiveOffsetU,
        effectiveOffsetV,
        effectiveZoom,
        aspect,
        bufW,
        bufH,
        boundsMinU,
        boundsMinV,
        boundsMaxU,
        boundsMaxV,
      );
    }

    // Draw selection overlay
    if (state.selection && activeLayer) {
      const cellCount = CELL_COUNTS[state.selection.level];
      const selAxes = mirrorOverlayAxes(activeLayer, dims);
      this.drawSelection(
        state,
        state.selection,
        cellCount,
        state.movePreview,
        state.rotatePreview,
        effectiveOffsetU,
        effectiveOffsetV,
        effectiveZoom,
        aspect,
        bufW,
        bufH,
        activeLayer.shiftX,
        activeLayer.shiftY,
        boundsMinU,
        boundsMinV,
        boundsMaxU,
        boundsMaxV,
        selAxes.centerU,
        selAxes.centerV,
      );
    }

    // Return textures for layers no longer in state to the free pool.
    // Runs every render (cheap: Map is tiny) so stale entries don't
    // survive past the frame that first rendered without them.
    if (this.textures.size > layers.length) {
      const activeIds = new Set<string>();
      for (let i = 0; i < layers.length; i++) activeIds.add(layers[i].id);
      for (const [id, tex] of this.textures) {
        if (!activeIds.has(id)) {
          this.recycleTexture(tex);
          this.textures.delete(id);
        }
      }
    }

    gl.flush();
    // expo-gl native frame presentation
    (gl as any).endFrameEXP?.();
  }

  private ensureTexture(layer: Layer): void {
    let tex = this.textures.get(layer.id);

    if (!tex) {
      // Reuse a pooled texture if available — its 2048×2048 RGBA storage
      // already exists, so texSubImage2D overwrites in place without
      // allocating a new IOSurface. Falls back to createTexture otherwise.
      const pooled = this.freeTexturePool.pop();
      if (pooled) {
        const gl = this.engine.gl;
        gl.bindTexture(gl.TEXTURE_2D, pooled);
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0, 0, 0, LAYER_PX, LAYER_PX,
          gl.RGBA, gl.UNSIGNED_BYTE, layer.data,
        );
        gl.bindTexture(gl.TEXTURE_2D, null);
        tex = pooled;
      } else {
        tex = this.engine.createTexture(LAYER_PX, LAYER_PX, layer.data);
      }
      this.textures.set(layer.id, tex);
      layer.dirtyRectCount = 0;
      return;
    }

    // Partial update if dirty — batch all rects under a single bind/unbind.
    const count = layer.dirtyRectCount;
    if (count > 0) {
      // Coalesce adjacent rects to reduce texSubImage2D calls
      coalesceDirtyRects(layer);
      const rects = layer.dirtyRects;
      const coalescedCount = layer.dirtyRectCount;
      const gl = this.engine.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (let i = 0; i < coalescedCount; i++) {
        const r = rects[i];
        if (r.width > 0 && r.height > 0) {
          this.engine.updateTextureRegionBound(
            tex, r.x, r.y, r.width, r.height, layer.data, LAYER_PX,
          );
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      layer.dirtyRectCount = 0;
    }
  }

  private drawLayer(
    layer: Layer,
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
    boundsMinU: number,
    boundsMinV: number,
    boundsMaxU: number,
    boundsMaxV: number,
    highlightMode: boolean = false,
    isHighlighted: boolean = false,
  ): void {
    const gl = this.engine.gl;
    const prog = this.layerProgram;
    const locs = this.layerLocs;
    gl.useProgram(prog);

    this.bindQuadCached(locs.a_position, locs.a_uv);

    gl.uniform1f(locs.u_opacity, layer.opacity);
    gl.uniform2f(locs.u_offset, offsetU, offsetV);
    gl.uniform1f(locs.u_zoom, zoom);
    gl.uniform1f(locs.u_aspect, aspect);
    gl.uniform1f(locs.u_highlightMode, highlightMode ? 1.0 : 0.0);
    gl.uniform1f(locs.u_isHighlighted, isHighlighted ? 1.0 : 0.0);
    gl.uniform2f(locs.u_boundsMin, boundsMinU, boundsMinV);
    gl.uniform2f(locs.u_boundsMax, boundsMaxU, boundsMaxV);

    const tex = this.textures.get(layer.id);
    if (tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(locs.u_texture, 0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawGrid(
    cellCount: number,
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
    viewportW: number,
    viewportH: number,
    shiftX: number = 0,
    shiftY: number = 0,
    boundsMinU: number = 0.0,
    boundsMinV: number = 0.0,
    boundsMaxU: number = 1.0,
    boundsMaxV: number = 1.0,
  ): void {
    const gl = this.engine.gl;
    const prog = this.gridProgram;
    const locs = this.gridLocs;
    gl.useProgram(prog);

    this.bindQuadCached(locs.a_position, locs.a_uv);

    gl.uniform1f(locs.u_cellCount, cellCount);
    gl.uniform2f(locs.u_offset, offsetU, offsetV);
    gl.uniform1f(locs.u_zoom, zoom);
    gl.uniform1f(locs.u_aspect, aspect);
    gl.uniform2f(locs.u_resolution, viewportW, viewportH);
    gl.uniform1f(locs.u_shiftX, shiftX);
    gl.uniform1f(locs.u_shiftY, shiftY);
    gl.uniform3f(locs.u_bgColor, ...CANVAS_BASE_GREY_GL);
    gl.uniform1f(locs.u_gridIntensity, this.gridIntensity);
    gl.uniform2f(locs.u_boundsMin, boundsMinU, boundsMinV);
    gl.uniform2f(locs.u_boundsMax, boundsMaxU, boundsMaxV);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawMirrorLines(
    mirrorH: boolean,
    mirrorV: boolean,
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
    viewportW: number,
    viewportH: number,
    mirrorCenter: [number, number] = [0.5, 0.5],
    boundsMinU: number = 0.0,
    boundsMinV: number = 0.0,
    boundsMaxU: number = 1.0,
    boundsMaxV: number = 1.0,
    quadLinesH: boolean = false,
    quadLinesV: boolean = false,
    diag1: boolean = false,
    diag2: boolean = false,
    dashH: boolean = false,
    dashV: boolean = false,
    dashQuadH: boolean = false,
    dashQuadV: boolean = false,
    dashPeriod: number = 0,
    firstHalfU: number = 0,
    secondHalfU: number = 0,
    firstHalfV: number = 0,
    secondHalfV: number = 0,
    diagCenter: [number, number] = mirrorCenter,
  ): void {
    const gl = this.engine.gl;
    const prog = this.mirrorProgram;
    const locs = this.mirrorLocs;
    gl.useProgram(prog);

    this.bindQuadCached(locs.a_position, locs.a_uv);

    gl.uniform1f(locs.u_mirrorH, mirrorH ? 1.0 : 0.0);
    gl.uniform1f(locs.u_mirrorV, mirrorV ? 1.0 : 0.0);
    gl.uniform1f(locs.u_quadLinesH, quadLinesH ? 1.0 : 0.0);
    gl.uniform1f(locs.u_quadLinesV, quadLinesV ? 1.0 : 0.0);
    gl.uniform1f(locs.u_diag1, diag1 ? 1.0 : 0.0);
    gl.uniform1f(locs.u_diag2, diag2 ? 1.0 : 0.0);
    gl.uniform2f(locs.u_offset, offsetU, offsetV);
    gl.uniform1f(locs.u_zoom, zoom);
    gl.uniform1f(locs.u_aspect, aspect);
    gl.uniform2f(locs.u_resolution, viewportW, viewportH);
    gl.uniform2f(locs.u_mirrorCenter, mirrorCenter[0], mirrorCenter[1]);
    gl.uniform2f(locs.u_boundsMin, boundsMinU, boundsMinV);
    gl.uniform2f(locs.u_boundsMax, boundsMaxU, boundsMaxV);
    gl.uniform1f(locs.u_dashH, dashH ? 1.0 : 0.0);
    gl.uniform1f(locs.u_dashV, dashV ? 1.0 : 0.0);
    gl.uniform1f(locs.u_dashQuadH, dashQuadH ? 1.0 : 0.0);
    gl.uniform1f(locs.u_dashQuadV, dashQuadV ? 1.0 : 0.0);
    gl.uniform1f(locs.u_dashPeriod, dashPeriod);
    gl.uniform1f(locs.u_firstHalfU, firstHalfU);
    gl.uniform1f(locs.u_secondHalfU, secondHalfU);
    gl.uniform1f(locs.u_firstHalfV, firstHalfV);
    gl.uniform1f(locs.u_secondHalfV, secondHalfV);
    gl.uniform2f(locs.u_diagCenter, diagCenter[0], diagCenter[1]);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawSelection(
    state: EditorState,
    selection: { startCellX: number; startCellY: number; endCellX: number; endCellY: number },
    cellCount: number,
    movePreview: { deltaCellX: number; deltaCellY: number } | null,
    rotatePreview: { rotation: 0 | 90 | 180 | 270 } | null,
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
    viewportW: number,
    viewportH: number,
    shiftX: number = 0,
    shiftY: number = 0,
    boundsMinU: number = 0.0,
    boundsMinV: number = 0.0,
    boundsMaxU: number = 1.0,
    boundsMaxV: number = 1.0,
    mirrorCenterU?: number,
    mirrorCenterV?: number,
  ): void {
    const gl = this.engine.gl;
    const prog = this.selectionProgram;
    const locs = this.selectionLocs;
    gl.useProgram(prog);
    this.bindQuadCached(locs.a_position, locs.a_uv);

    // Shared per-frame uniforms
    gl.uniform2f(locs.u_offset, offsetU, offsetV);
    gl.uniform1f(locs.u_zoom, zoom);
    gl.uniform1f(locs.u_aspect, aspect);
    gl.uniform2f(locs.u_resolution, viewportW, viewportH);
    gl.uniform2f(locs.u_boundsMin, boundsMinU, boundsMinV);
    gl.uniform2f(locs.u_boundsMax, boundsMaxU, boundsMaxV);

    // Primary selection rect in UV (offset by layer shift)
    const shiftU = shiftX / cellCount;
    const shiftV = shiftY / cellCount;
    const selMinU = selection.startCellX / cellCount + shiftU;
    const selMinV = selection.startCellY / cellCount + shiftV;
    const selMaxU = (selection.endCellX + 1) / cellCount + shiftU;
    const selMaxV = (selection.endCellY + 1) / cellCount + shiftV;

    // Mirror axis for selection outline reflections. Uses the cell-window
    // axis (same as paint mirroring and the overlay line) so the outline
    // preview matches where cells actually land at commit time.
    const selDims = effectiveCanvasDims(state.fileConfig);
    const canvasCenterU = mirrorCenterU ?? (selDims.originL0X + selDims.widthL0 / 2) / 32;
    const canvasCenterV = mirrorCenterV ?? (selDims.originL0Y + selDims.heightL0 / 2) / 32;

    // Emit the primary outline + preview + orient line
    this.emitSelectionRect(
      locs,
      selMinU, selMinV, selMaxU, selMaxV,
      movePreview, rotatePreview, cellCount,
      true,
    );

    // Mirror-expanded outlines. Only drawn during a move or rotate preview so
    // the user can anticipate where commit-time copies will land. At rest the
    // mirror toggle is already shown in the toolbar, and the extra ghost
    // rectangles compete visually with the real selection.
    const hasAnyMirror = state.mirrorH || state.mirrorV || state.mirrorRotate
      || state.mirrorQuad || state.mirrorRow || state.mirrorCol
      || state.mirrorDiag1 || state.mirrorDiag2 || state.mirrorDiagBoth
      || state.mirrorStar;
    const isPreviewing = movePreview !== null || rotatePreview !== null;
    if (hasAnyMirror && isPreviewing) {
      const reflectU = (u: number) => 2 * canvasCenterU - u;
      const reflectV = (v: number) => 2 * canvasCenterV - v;
      // H-mirror: reflect U
      const hMinU = reflectU(selMaxU);
      const hMaxU = reflectU(selMinU);
      // V-mirror: reflect V
      const vMinV = reflectV(selMaxV);
      const vMaxV = reflectV(selMinV);
      // Always draw H, V, and HV mirror outlines when any mirror mode is on.
      // (Matches the paint loop's behavior: at minimum an H+V+HV set of copies
      // is produced for any mirror combination.)
      this.emitSelectionRect(locs, hMinU, selMinV, hMaxU, selMaxV, movePreview, rotatePreview, cellCount, false, true, false);
      this.emitSelectionRect(locs, selMinU, vMinV, selMaxU, vMaxV, movePreview, rotatePreview, cellCount, false, false, true);
      this.emitSelectionRect(locs, hMinU, vMinV, hMaxU, vMaxV, movePreview, rotatePreview, cellCount, false, true, true);
    }
  }

  /** Issue a single selection-outline draw call with the given UV rect and
   *  optional move/rotate preview. Orientation line is drawn only when
   *  `drawOrient` is true (primary rect only — mirror copies suppress it). */
  private emitSelectionRect(
    locs: typeof this.selectionLocs,
    selMinU: number, selMinV: number, selMaxU: number, selMaxV: number,
    movePreview: { deltaCellX: number; deltaCellY: number } | null,
    rotatePreview: { rotation: 0 | 90 | 180 | 270 } | null,
    cellCount: number,
    drawOrient: boolean,
    reflectH: boolean = false,
    reflectV: boolean = false,
  ): void {
    const gl = this.engine.gl;
    gl.uniform2f(locs.u_selMinUV, selMinU, selMinV);
    gl.uniform2f(locs.u_selMaxUV, selMaxU, selMaxV);

    let hasPreview = false;

    if (movePreview) {
      // Mirror copies reflect the delta: e.g. horizontal mirror flips dx.
      const signU = reflectH ? -1 : 1;
      const signV = reflectV ? -1 : 1;
      const du = (movePreview.deltaCellX / cellCount) * signU;
      const dv = (movePreview.deltaCellY / cellCount) * signV;
      gl.uniform2f(locs.u_previewMinUV, selMinU + du, selMinV + dv);
      gl.uniform2f(locs.u_previewMaxUV, selMaxU + du, selMaxV + dv);
      hasPreview = true;
    }

    if (rotatePreview) {
      const selW = selMaxU - selMinU;
      const selH = selMaxV - selMinV;
      const centerU = (selMinU + selMaxU) / 2;
      const centerV = (selMinV + selMaxV) / 2;

      if (rotatePreview.rotation !== 0) {
        let previewW = selW;
        let previewH = selH;
        if (rotatePreview.rotation === 90 || rotatePreview.rotation === 270) {
          previewW = selH;
          previewH = selW;
        }
        gl.uniform2f(locs.u_previewMinUV, centerU - previewW / 2, centerV - previewH / 2);
        gl.uniform2f(locs.u_previewMaxUV, centerU + previewW / 2, centerV + previewH / 2);
        hasPreview = true;
      }

      if (drawOrient) {
        const topDx = 0;
        const topDy = -selH / 2;
        let rdx: number, rdy: number;
        switch (rotatePreview.rotation) {
          case 90:  rdx = -topDy; rdy = topDx;  break;
          case 180: rdx = -topDx; rdy = -topDy; break;
          case 270: rdx = topDy;  rdy = -topDx; break;
          default:  rdx = topDx;  rdy = topDy;  break;
        }
        gl.uniform2f(locs.u_orientStartUV, centerU, centerV);
        gl.uniform2f(locs.u_orientEndUV, centerU + rdx, centerV + rdy);
        gl.uniform1f(locs.u_hasOrientLine, 1.0);
      } else {
        gl.uniform2f(locs.u_orientStartUV, 0.0, 0.0);
        gl.uniform2f(locs.u_orientEndUV, 0.0, 0.0);
        gl.uniform1f(locs.u_hasOrientLine, 0.0);
      }
    } else {
      gl.uniform2f(locs.u_orientStartUV, 0.0, 0.0);
      gl.uniform2f(locs.u_orientEndUV, 0.0, 0.0);
      gl.uniform1f(locs.u_hasOrientLine, 0.0);
    }

    if (!hasPreview) {
      gl.uniform2f(locs.u_previewMinUV, 0.0, 0.0);
      gl.uniform2f(locs.u_previewMaxUV, 0.0, 0.0);
    }
    gl.uniform1f(locs.u_hasMovePreview, hasPreview ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawCloneOverlay(
    cellCount: number,
    sourceIdx: number | null,
    sampleIdx: number | null,
    anchorIdx: number | null,
    cursorIdx: number | null,
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
    viewportW: number,
    viewportH: number,
    shiftX: number = 0,
    shiftY: number = 0,
    boundsMinU: number = 0.0,
    boundsMinV: number = 0.0,
    boundsMaxU: number = 1.0,
    boundsMaxV: number = 1.0,
  ): void {
    if (sourceIdx === null && sampleIdx === null && anchorIdx === null && cursorIdx === null) return;

    const gl = this.engine.gl;
    const prog = this.cloneOverlayProgram;
    const locs = this.cloneOverlayLocs;
    gl.useProgram(prog);
    this.bindQuadCached(locs.a_position, locs.a_uv);

    gl.uniform1f(locs.u_cellCount, cellCount);

    const offX = shiftX === 0.5 ? 1 : 0;
    const offY = shiftY === 0.5 ? 1 : 0;
    const stride = cellCount + offX;
    const adjustU = (shiftX - offX) / cellCount;
    const adjustV = (shiftY - offY) / cellCount;

    const idxToUV = (idx: number): [number, number] => {
      const col = idx % stride;
      const row = Math.floor(idx / stride);
      return [col / cellCount + adjustU, row / cellCount + adjustV];
    };

    if (sourceIdx !== null) {
      const [u, v] = idxToUV(sourceIdx);
      gl.uniform2f(locs.u_sourceUV, u, v);
      gl.uniform1f(locs.u_sourceEnabled, 1.0);
    } else {
      gl.uniform2f(locs.u_sourceUV, 0.0, 0.0);
      gl.uniform1f(locs.u_sourceEnabled, 0.0);
    }

    if (sampleIdx !== null) {
      const [u, v] = idxToUV(sampleIdx);
      gl.uniform2f(locs.u_sampleUV, u, v);
      gl.uniform1f(locs.u_sampleEnabled, 1.0);
    } else {
      gl.uniform2f(locs.u_sampleUV, 0.0, 0.0);
      gl.uniform1f(locs.u_sampleEnabled, 0.0);
    }

    if (anchorIdx !== null) {
      const [u, v] = idxToUV(anchorIdx);
      gl.uniform2f(locs.u_anchorUV, u, v);
      gl.uniform1f(locs.u_anchorEnabled, 1.0);
    } else {
      gl.uniform2f(locs.u_anchorUV, 0.0, 0.0);
      gl.uniform1f(locs.u_anchorEnabled, 0.0);
    }

    if (cursorIdx !== null) {
      const [u, v] = idxToUV(cursorIdx);
      gl.uniform2f(locs.u_cursorUV, u, v);
      gl.uniform1f(locs.u_cursorEnabled, 1.0);
    } else {
      gl.uniform2f(locs.u_cursorUV, 0.0, 0.0);
      gl.uniform1f(locs.u_cursorEnabled, 0.0);
    }

    gl.uniform2f(locs.u_offset, offsetU, offsetV);
    gl.uniform1f(locs.u_zoom, zoom);
    gl.uniform1f(locs.u_aspect, aspect);
    gl.uniform2f(locs.u_resolution, viewportW, viewportH);
    gl.uniform2f(locs.u_boundsMin, boundsMinU, boundsMinV);
    gl.uniform2f(locs.u_boundsMax, boundsMaxU, boundsMaxV);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawPathSelection(
    state: EditorState,
    offsetU: number,
    offsetV: number,
    zoom: number,
    aspect: number,
    viewportW: number,
    viewportH: number,
    boundsMinU: number = 0.0,
    boundsMinV: number = 0.0,
    boundsMaxU: number = 1.0,
    boundsMaxV: number = 1.0,
  ): void {
    const gl = this.engine.gl;
    const l0Count = CELL_COUNTS[0]; // 32

    // Only re-upload texture when path indices changed
    if (this.pathTexGeneration !== state.pathGeneration || !this.pathTexture) {
      const texData = new Uint8Array(l0Count * l0Count * 4);
      const l0Indices = state.pathL0Indices!;
      l0Indices.forEach(idx => {
        const offset = idx * 4;
        texData[offset] = 255;     // R
        texData[offset + 1] = 0;   // G
        texData[offset + 2] = 0;   // B
        texData[offset + 3] = 255; // A
      });
      if (this.pathTexture) {
        gl.bindTexture(gl.TEXTURE_2D, this.pathTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, l0Count, l0Count, gl.RGBA, gl.UNSIGNED_BYTE, texData);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else {
        this.pathTexture = this.engine.createTexture(l0Count, l0Count, texData);
      }
      this.pathTexGeneration = state.pathGeneration;
    }

    const prog = this.pathSelectionProgram;
    gl.useProgram(prog);
    this.bindQuad(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pathTexture!);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_pathTex'), 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_l0Count'), l0Count);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_offset'), offsetU, offsetV);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_zoom'), zoom);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_aspect'), aspect);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), viewportW, viewportH);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_boundsMin'), boundsMinU, boundsMinV);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_boundsMax'), boundsMaxU, boundsMaxV);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Bind quad buffer with pre-cached attribute locations */
  private bindQuadCached(posLoc: number, uvLoc: number): void {
    const gl = this.engine.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);
  }

  /** Bind quad buffer, looking up attribute locations from program */
  private bindQuad(program: WebGLProgram): void {
    const gl = this.engine.gl;
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const uvLoc = gl.getAttribLocation(program, 'a_uv');
    this.bindQuadCached(posLoc, uvLoc);
  }

  /** Remove a layer's texture when the layer is deleted */
  removeTexture(layerId: string): void {
    const tex = this.textures.get(layerId);
    if (tex) {
      this.recycleTexture(tex);
      this.textures.delete(layerId);
    }
  }

  /**
   * Return unused layer textures to the free pool without waiting for
   * the next render. Called from Canvas when the active file's layer set
   * changes so the old file's 16 MB textures are recycled before the new
   * file's allocations begin.
   */
  releaseStaleTextures(activeLayerIds: Set<string>): void {
    for (const [id, tex] of this.textures) {
      if (!activeLayerIds.has(id)) {
        this.recycleTexture(tex);
        this.textures.delete(id);
      }
    }
  }

  /** Push a LAYER_PX × LAYER_PX texture back to the pool, or delete if full. */
  private recycleTexture(tex: WebGLTexture): void {
    if (this.freeTexturePool.length < Renderer.FREE_TEXTURE_POOL_MAX) {
      this.freeTexturePool.push(tex);
    } else {
      this.engine.gl.deleteTexture(tex);
    }
  }

  /** Release all GPU resources held by this renderer */
  dispose(): void {
    const gl = this.engine.gl;
    for (const tex of this.textures.values()) {
      gl.deleteTexture(tex);
    }
    this.textures.clear();
    for (const tex of this.freeTexturePool) {
      gl.deleteTexture(tex);
    }
    this.freeTexturePool.length = 0;
    if (this.pathTexture) {
      gl.deleteTexture(this.pathTexture);
      this.pathTexture = null;
    }
    gl.deleteProgram(this.layerProgram);
    gl.deleteProgram(this.gridProgram);
    gl.deleteProgram(this.mirrorProgram);
    gl.deleteProgram(this.selectionProgram);
    gl.deleteProgram(this.cloneOverlayProgram);
    gl.deleteProgram(this.pathSelectionProgram);
    gl.deleteBuffer(this.quadBuffer);
  }
}
