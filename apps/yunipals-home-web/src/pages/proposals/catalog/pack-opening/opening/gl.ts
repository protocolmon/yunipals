// Full-screen WebGL2 shader layer for the opening lab. A scene shader draws
// the pack and card itself from two textures, so it can melt, refract or
// fold them in ways DOM elements cannot.

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

/** Shared uniforms and helpers prepended to every scene shader. */
const HEADER = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform sampler2D uPack;
uniform sampler2D uCard;
// Rects are centre.xy and half-size.zw in CSS pixels, origin top-left.
uniform vec4 uPackRect;
uniform vec4 uCardRect;
uniform vec4 uP;
uniform vec4 uQ;
out vec4 fragColor;

const float TAU = 6.2831853;
vec2 pix() {
  return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return value;
}
vec3 pal(float t) {
  return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67)));
}
vec2 rectUv(vec4 rect, vec2 p) {
  return (p - rect.xy) / (rect.zw * 2.0) + 0.5;
}
bool inside(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}
// Premultiplied texel of a texture placed in a rect; transparent outside.
vec4 tex(sampler2D image, vec4 rect, vec2 p) {
  vec2 uv = rectUv(rect, p);
  return inside(uv) ? texture(image, uv) : vec4(0.0);
}
vec4 over(vec4 below, vec4 above) {
  return above + below * (1.0 - above.a);
}
// Additive light on a premultiplied, possibly transparent pixel.
vec4 glow(vec4 color, vec3 light) {
  color.rgb += light;
  color.a = clamp(max(color.a, max(light.r, max(light.g, light.b))), 0.0, 1.0);
  return color;
}
float sdRound(vec2 p, vec2 half_, float radius) {
  vec2 q = abs(p) - half_ + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
`;

export type Rect = { x: number; y: number; w: number; h: number };
type Vec4 = [number, number, number, number];

export class ShaderLayer {
  private gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private textures: (WebGLTexture | null)[] = [null, null];
  private time = 0;
  private ratio = 1;
  /** Animation parameters, free for each shader to interpret. */
  p: Vec4 = [0, 0, 0, 0];
  q: Vec4 = [0, 0, 0, 0];
  packRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  cardRect: Rect = { x: 0, y: 0, w: 1, h: 1 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false
    });
    const { gl } = this;
    if (!gl) return;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  get supported() {
    return this.gl !== null;
  }

  resize() {
    this.ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.canvas.clientWidth * this.ratio);
    this.canvas.height = Math.round(this.canvas.clientHeight * this.ratio);
  }

  /** Compiles and activates a scene shader. Returns false if unavailable. */
  use(fragment: string) {
    const { gl } = this;
    if (!gl) return false;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`Shader: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, HEADER + fragment));
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Program: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.locations.clear();
    this.time = 0;
    this.p = [0, 0, 0, 0];
    this.q = [0, 0, 0, 0];
    return true;
  }

  /** Uploads an image or canvas as the pack (0) or card (1) texture. */
  texture(unit: 0 | 1, source: TexImageSource) {
    const { gl } = this;
    if (!gl) return;
    const texture = this.textures[unit] ?? gl.createTexture();
    this.textures[unit] = texture;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  stop() {
    this.program = null;
    const { gl } = this;
    if (!gl) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  frame(delta: number) {
    const { gl, program } = this;
    if (!gl || !program) return;
    this.time += delta;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    const location = (name: string) => {
      if (!this.locations.has(name))
        this.locations.set(name, gl.getUniformLocation(program, name));
      return this.locations.get(name) ?? null;
    };
    const rect = (value: Rect) => [
      value.x + value.w / 2,
      value.y + value.h / 2,
      value.w / 2,
      value.h / 2
    ];
    gl.uniform2f(location("uRes"), this.canvas.width, this.canvas.height);
    gl.uniform1f(location("uDpr"), this.ratio);
    gl.uniform1f(location("uTime"), this.time);
    gl.uniform1i(location("uPack"), 0);
    gl.uniform1i(location("uCard"), 1);
    gl.uniform4fv(location("uPackRect"), rect(this.packRect));
    gl.uniform4fv(location("uCardRect"), rect(this.cardRect));
    gl.uniform4fv(location("uP"), this.p);
    gl.uniform4fv(location("uQ"), this.q);
    this.textures.forEach((texture, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
