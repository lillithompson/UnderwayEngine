import { CompositionState } from '../types';
import { compSnapStep } from '../compositionCellMath';
import { createGLEngine, GLEngine } from './context';
import { QUAD_VERT, INFINITE_GRID_FRAG } from './shaders';
import { CANVAS_BASE_GREY_GL } from '../colors';

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
    gl.clearColor(...CANVAS_BASE_GREY_GL, 1.0);
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

    gl.uniform3f(gl.getUniformLocation(prog, 'u_bgColor'), ...CANVAS_BASE_GREY_GL);
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

