// Scene fragment shaders for round two. Each is appended to the shared
// header in gl.ts and reads its animation state from uP and uQ.

/** uP: x melt, y rise, z settle (chrome hardens into the card). */
export const LIQUID_METAL = `
vec3 chrome(vec2 p) {
  // Broad, high-contrast reflection bands read as polished metal; a thin
  // iridescent film rides on top.
  float n = fbm(p * 0.006 + vec2(0.0, uTime * 0.2));
  float m = fbm(p * 0.009 - vec2(uTime * 0.15, 0.0) + n * 1.6);
  float band = 0.5 + 0.5 * sin(m * 24.0 + n * 8.0 + p.y * 0.02);
  vec3 base = mix(vec3(0.16, 0.18, 0.3), vec3(0.97, 0.98, 1.0),
    smoothstep(0.25, 0.75, band));
  vec3 tint = pal(n * 1.1 + m * 0.5 + p.y * 0.001);
  return mix(base, tint, 0.3) + pow(band, 16.0) * 0.6;
}
void main() {
  vec2 p = pix();
  vec4 R = uPackRect;
  vec4 C = uCardRect;
  float melt = uP.x;
  float rise = uP.y;
  float settle = uP.z;
  vec4 color = vec4(0.0);
  float floorY = R.y + R.w * 1.1;

  // Puddle collecting under the pack, then draining into the card.
  float amount = melt * (1.0 - settle);
  if (amount > 0.01) {
    vec2 d = (p - vec2(R.x, floorY)) /
      vec2(R.z * 2.0 * amount + 1.0, R.z * 0.4 * amount + 1.0);
    float wobble = (fbm(p * 0.03 + uTime * 0.2) - 0.5) * 0.35;
    float puddle = 1.0 - smoothstep(0.78, 1.0, length(d) + wobble);
    color = over(color, vec4(chrome(p), 1.0) * puddle);
  }

  // The pack: every column slides down at its own speed and turns to metal.
  if (melt < 1.0) {
    float column = noise(vec2(p.x * 0.045, 7.0)) * 0.7 +
      noise(vec2(p.x * 0.16, 3.0)) * 0.3;
    float slide = pow(melt, 1.6) * (0.3 + column * 1.6) * R.w * 2.7;
    float sway = sin(p.y * 0.04 + uTime * 3.0) * 7.0 * melt;
    vec4 pack = tex(uPack, R, vec2(p.x + sway, p.y - slide));
    pack *= step(p.y, floorY + 6.0);
    pack = mix(pack, vec4(chrome(p), 1.0) * pack.a, smoothstep(0.05, 0.6, melt));
    color = over(color, pack);
  }

  // A sheet of metal rises in the shape of the card, then hardens.
  if (rise > 0.0) {
    float body = 1.0 - smoothstep(-1.0, 1.0, sdRound(p - C.xy, C.zw, 14.0));
    float wave = (fbm(vec2(p.x * 0.03, uTime * 0.6)) - 0.5) * 56.0;
    float line = mix(C.y + C.w + 40.0, C.y - C.w - 50.0, rise) + wave;
    float risen = smoothstep(line - 6.0, line + 6.0, p.y);
    float grain = fbm(p * 0.018 + 3.0);
    float edge = settle * 1.3 - 0.12;
    float metal = smoothstep(edge - 0.07, edge, grain);
    float seam = smoothstep(0.09, 0.0, abs(grain - edge)) * step(0.01, settle);
    vec4 card = tex(uCard, C, p);
    vec4 shown = mix(card, vec4(chrome(p), 1.0) * body, metal);
    shown = glow(shown, vec3(1.0, 0.93, 0.78) * seam * body);
    color = over(color, shown * risen);
  }
  fragColor = color;
}`;

/** uP: x wash (pack bleeds away), y bloom (card paints in). */
export const INK_BLOOM = `
void main() {
  vec2 p = pix();
  vec4 R = uPackRect;
  vec4 C = uCardRect;
  float wash = uP.x;
  float bloom = uP.y;
  float grain = fbm(p * 0.035);
  vec4 color = vec4(0.0);
  vec3 ink = vec3(0.10, 0.12, 0.34);

  if (wash < 1.0) {
    vec2 flow = vec2(fbm(p * 0.012 + 3.0) - 0.5, fbm(p * 0.012 + 9.0) - 0.15) *
      170.0 * wash;
    vec4 pack = tex(uPack, R, p - flow);
    float edge = wash * 1.4 - 0.3;
    float keep = smoothstep(edge, edge + 0.3, grain + 0.12 * noise(p * 0.2));
    pack.rgb = mix(pack.rgb, pack.rgb * 0.7 + pack.a * 0.3, wash);
    color = over(color, pack * keep * (1.0 - wash * 0.35));
  }

  if (bloom > 0.0) {
    float mask = 0.0;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 centre = C.xy +
        (vec2(hash(vec2(fi, 1.3)), hash(vec2(fi, 7.7))) - 0.5) * C.zw * 1.5;
      float radius = max(0.0, bloom * 1.3 - fi * 0.085) * C.w * 1.9;
      float reach = length(p - centre) + (fbm(p * 0.022 + fi) - 0.5) * 120.0;
      mask = max(mask, 1.0 - smoothstep(radius - 30.0, radius, reach));
    }
    float sd = sdRound(p - C.xy, C.zw, 12.0);
    vec4 card = tex(uCard, C, p);
    // Wet edge: pigment gathers in a darker line at the advancing front.
    float front = mask * (1.0 - mask) * 4.0;
    vec4 painted = card * mask;
    painted.rgb = mix(painted.rgb, ink * painted.a, front * 0.6 * (1.0 - bloom));
    painted.rgb = mix(painted.rgb, painted.rgb * (0.82 + 0.36 * grain),
      1.0 - bloom);
    color = over(color, painted);
    float stain = mask * smoothstep(40.0, 0.0, sd) * step(0.0, sd) *
      (1.0 - smoothstep(0.7, 1.0, bloom));
    color = over(color, vec4(ink, 1.0) * stain * 0.4 * (0.4 + grain));
  }
  fragColor = color;
}`;

/** uP: x speed, y arrival, z flare, w tunnel brightness. uQ.x: distance. */
export const HYPERSPACE = `
void main() {
  vec2 p = pix();
  vec2 res = uRes / uDpr;
  vec4 C = uCardRect;
  vec2 d = (p - C.xy) / min(res.x, res.y);
  float r = length(d) + 0.0001;
  float a = atan(d.y, d.x);
  float speed = uP.x;
  float depth = 0.35 / r;
  vec3 light = vec3(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float u = a / TAU * (46.0 + fl * 37.0);
    float v = depth * (1.5 + fl) + uQ.x * (1.0 + fl * 0.4);
    float h = hash(vec2(floor(u), floor(v)) + fl * 17.0);
    float across = abs(fract(u) - 0.5);
    float along = fract(v);
    float streak = smoothstep(0.5, 0.0, across * 2.4) *
      smoothstep(0.0, 0.15, along) *
      smoothstep(1.0, 0.35 + 0.5 * (1.0 - speed), along);
    light += pal(h * 3.0 + fl * 0.2 + 0.55) * step(0.82, h) * streak *
      (0.6 + 0.9 * speed);
  }
  light *= smoothstep(0.02, 0.35, r);
  float cloud = fbm(vec2(cos(a) * 1.6 + depth * 1.3 + uQ.x * 0.5,
    sin(a) * 1.6 - uQ.x * 0.3));
  light += mix(vec3(0.16, 0.05, 0.42), vec3(0.0, 0.35, 0.62), cloud) * cloud *
    0.55 * smoothstep(0.05, 0.6, r) * (0.3 + speed);
  vec4 color = glow(vec4(0.0), light * uP.w);

  float arrive = uP.y;
  if (arrive > 0.0) {
    // The card grows out of the vanishing point with its colours split.
    float scale = mix(0.02, 1.0, arrive);
    float split = (1.0 - arrive) * 0.14;
    vec4 red = tex(uCard, vec4(C.xy, C.zw * scale * (1.0 + split)), p);
    vec4 green = tex(uCard, vec4(C.xy, C.zw * scale), p);
    vec4 blue = tex(uCard, vec4(C.xy, C.zw * scale * (1.0 - split)), p);
    color = over(color, vec4(red.r, green.g, blue.b,
      max(green.a, max(red.a, blue.a) * 0.7)));
  }
  float bar = smoothstep(0.012, 0.0, abs(d.y)) * smoothstep(0.9, 0.0, abs(d.x));
  color = glow(color, (vec3(0.8, 0.9, 1.0) * 0.07 / r + bar) * uP.z);
  fragColor = color;
}`;

/**
 * Interactive foil peel. uP: xy fold-line normal (points into the part
 * still stuck down), z curl radius. uQ: xy a point on the fold line,
 * w scale of the card lying underneath.
 */
export const FOIL_PEEL = `
vec3 foil(vec2 o) {
  float g = fbm(o * 0.05);
  vec3 silver = vec3(0.78, 0.8, 0.87);
  return mix(silver, pal(o.x * 0.004 + o.y * 0.003 + g * 0.4) * 0.5 + 0.5, 0.3) *
    (0.82 + 0.34 * g);
}
void main() {
  vec2 p = pix();
  vec2 n = uP.xy;
  float rho = uP.z;
  float t = dot(p - uQ.xy, n);
  vec4 color = tex(uCard, vec4(uCardRect.xy, uCardRect.zw * uQ.w), p);

  // Light spilling out from under the lifted foil, and its contact shadow.
  float open = step(t, -rho);
  color.rgb *= 1.0 - 0.4 * smoothstep(-rho - 30.0, -rho, t) * open;
  color = glow(color, vec3(1.0, 0.86, 0.55) * 0.3 * open *
    smoothstep(-rho - 150.0, -rho, t) * color.a);

  vec4 front = vec4(0.0);
  vec4 back = vec4(0.0);
  if (t > 0.0) {
    front = tex(uPack, uPackRect, p);
    front.rgb *= 1.0 - 0.22 * smoothstep(34.0, 0.0, t);
    // The flap lying flat on top, showing the foil's silver underside.
    vec2 origin = p - (3.14159 * rho + 2.0 * t) * n;
    float there = tex(uPack, uPackRect, origin).a;
    back = vec4(foil(origin) * (0.92 - 0.2 * smoothstep(60.0, 0.0, t)), 1.0) *
      step(0.5, there);
  } else if (t > -rho) {
    float bend = asin(clamp(-t / rho, 0.0, 1.0));
    // Lower quarter of the roll: still the printed side, turning away.
    front = tex(uPack, uPackRect, p - (rho * bend + t) * n);
    front.rgb *= 1.0 - 0.4 * (-t / rho);
    // Upper half of the roll: the underside catching the light.
    vec2 origin = p - (rho * (3.14159 - bend) + t) * n;
    float there = tex(uPack, uPackRect, origin).a;
    float lit = 0.6 + 0.55 * pow(sin(bend), 2.0);
    back = vec4(foil(origin) * lit, 1.0) * step(0.5, there);
  }
  color = over(color, front);
  fragColor = over(color, back);
}`;
