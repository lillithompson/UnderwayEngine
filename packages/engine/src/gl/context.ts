/** Thin GL utility wrapper for shader compilation and resource creation */

// Reusable buffer for updateTextureRegion slow path (max dirty rect = 1024×1024 L4 cell)
const MAX_DIRTY_PX = 1024;
const sharedTexBuf = new Uint8Array(MAX_DIRTY_PX * MAX_DIRTY_PX * 4);

export interface GLEngine {
  gl: WebGLRenderingContext;
  compileShader(type: number, source: string): WebGLShader;
  linkProgram(vert: WebGLShader, frag: WebGLShader): WebGLProgram;
  createTexture(width: number, height: number, data: Uint8Array | null, filter?: number): WebGLTexture;
  updateTextureRegion(
    tex: WebGLTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    data: Uint8Array,
    sourceWidth: number,
  ): void;
  /** Same as updateTextureRegion but assumes texture is already bound (no bind/unbind). */
  updateTextureRegionBound(
    tex: WebGLTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    data: Uint8Array,
    sourceWidth: number,
  ): void;
  createQuadBuffer(): WebGLBuffer;
}

export function createGLEngine(gl: WebGLRenderingContext): GLEngine {
  function compileShader(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
  }

  function linkProgram(vert: WebGLShader, frag: WebGLShader): WebGLProgram {
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info}`);
    }
    return program;
  }

  function createTexture(
    width: number,
    height: number,
    data: Uint8Array | null,
    filter?: number,
  ): WebGLTexture {
    const f = filter ?? gl.NEAREST;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  function updateTextureRegion(
    tex: WebGLTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    data: Uint8Array,
    sourceWidth: number,
  ): void {
    // Fast path: if width matches sourceWidth, rows are contiguous — use subarray directly
    if (width === sourceWidth) {
      const subData = data.subarray(y * sourceWidth * 4, (y + height) * sourceWidth * 4);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, subData);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return;
    }

    // Extract the sub-rectangle — use shared buffer when it fits, allocate otherwise
    const len = width * height * 4;
    const buf = len <= sharedTexBuf.length ? sharedTexBuf : new Uint8Array(len);
    for (let row = 0; row < height; row++) {
      const srcOffset = ((y + row) * sourceWidth + x) * 4;
      const dstOffset = row * width * 4;
      buf.set(data.subarray(srcOffset, srcOffset + width * 4), dstOffset);
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      buf.subarray(0, len),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function updateTextureRegionBound(
    _tex: WebGLTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    data: Uint8Array,
    sourceWidth: number,
  ): void {
    // Fast path: if width matches sourceWidth, rows are contiguous — use subarray directly
    if (width === sourceWidth) {
      const subData = data.subarray(y * sourceWidth * 4, (y + height) * sourceWidth * 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, subData);
      return;
    }

    // Extract the sub-rectangle — use shared buffer when it fits, allocate otherwise
    const len = width * height * 4;
    const buf = len <= sharedTexBuf.length ? sharedTexBuf : new Uint8Array(len);
    for (let row = 0; row < height; row++) {
      const srcOffset = ((y + row) * sourceWidth + x) * 4;
      const dstOffset = row * width * 4;
      buf.set(data.subarray(srcOffset, srcOffset + width * 4), dstOffset);
    }

    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      buf.subarray(0, len),
    );
  }

  function createQuadBuffer(): WebGLBuffer {
    const buf = gl.createBuffer();
    if (!buf) throw new Error('Failed to create buffer');
    // Fullscreen quad: position (xy) + uv (st)
    const vertices = new Float32Array([
      // x,    y,   u,   v
      -1, -1,  0,   1,
       1, -1,  1,   1,
      -1,  1,  0,   0,
       1,  1,  1,   0,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    return buf;
  }

  return {
    gl,
    compileShader,
    linkProgram,
    createTexture,
    updateTextureRegion,
    updateTextureRegionBound,
    createQuadBuffer,
  };
}
