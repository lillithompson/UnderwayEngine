/** WebGL renderer for HSV color picker — depends only on context.ts */

import { createGLEngine, GLEngine } from './context';
import { QUAD_VERT } from './shaders';
import { HSV_PICKER_FRAG } from './hsvPickerShaders';

interface PickerLocs {
  a_position: number;
  a_uv: number;
  u_hue: WebGLUniformLocation | null;
  u_svPoint: WebGLUniformLocation | null;
  u_hueAngle: WebGLUniformLocation | null;
  u_resolution: WebGLUniformLocation | null;
  u_hueScale: WebGLUniformLocation | null;
  u_svScale: WebGLUniformLocation | null;
}

export class HsvPickerRenderer {
  private engine: GLEngine;
  private program: WebGLProgram;
  private quadBuffer: WebGLBuffer;
  private locs: PickerLocs;
  private width: number;
  private height: number;

  constructor(gl: WebGLRenderingContext, width: number, height: number) {
    this.engine = createGLEngine(gl);
    this.width = width;
    this.height = height;

    const { compileShader, linkProgram, createQuadBuffer } = this.engine;

    const vert = compileShader(gl.VERTEX_SHADER, QUAD_VERT);
    const frag = compileShader(gl.FRAGMENT_SHADER, HSV_PICKER_FRAG);
    this.program = linkProgram(vert, frag);

    gl.detachShader(this.program, vert);
    gl.detachShader(this.program, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    this.quadBuffer = createQuadBuffer();

    this.locs = {
      a_position: gl.getAttribLocation(this.program, 'a_position'),
      a_uv: gl.getAttribLocation(this.program, 'a_uv'),
      u_hue: gl.getUniformLocation(this.program, 'u_hue'),
      u_svPoint: gl.getUniformLocation(this.program, 'u_svPoint'),
      u_hueAngle: gl.getUniformLocation(this.program, 'u_hueAngle'),
      u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
      u_hueScale: gl.getUniformLocation(this.program, 'u_hueScale'),
      u_svScale: gl.getUniformLocation(this.program, 'u_svScale'),
    };
  }

  /**
   * Render the HSV picker.
   * @param hue Hue in [0, 360)
   * @param svU SV selection point U in [0, 1] UV space
   * @param svV SV selection point V in [0, 1] UV space
   */
  render(hue: number, svU: number, svV: number, hueScale = 1, svScale = 1): void {
    const gl = this.engine.gl;

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);

    // Set uniforms
    gl.uniform1f(this.locs.u_hue, hue);
    gl.uniform2f(this.locs.u_svPoint, svU, svV);
    gl.uniform1f(this.locs.u_hueAngle, hue * (Math.PI / 180));
    gl.uniform2f(this.locs.u_resolution, this.width, this.height);
    gl.uniform1f(this.locs.u_hueScale, hueScale);
    gl.uniform1f(this.locs.u_svScale, svScale);

    // Bind quad buffer and set attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const stride = 4 * 4; // 4 floats × 4 bytes
    gl.enableVertexAttribArray(this.locs.a_position);
    gl.vertexAttribPointer(this.locs.a_position, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.locs.a_uv);
    gl.vertexAttribPointer(this.locs.a_uv, 2, gl.FLOAT, false, stride, 8);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.flush();
    (gl as any).endFrameEXP?.();
  }

  dispose(): void {
    const gl = this.engine.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.quadBuffer);
  }
}
