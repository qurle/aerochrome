export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vPos;
void main() {
  vPos = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Main pass: colour split → sharpen/soften → LUT → film effects. */
export const MAIN_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vPos;
out vec4 outColor;

uniform sampler2D uSrc;
uniform sampler3D uLut;
uniform sampler2D uHalo;
uniform float uLutSize;
uniform vec4 uOutRect;   // output region in full-image uv (x0, y0, x1, y1), top-left origin
uniform vec4 uSrcRect;   // region covered by uSrc, same space
uniform vec2 uSrcTexel;  // 1 / uSrc size in texels
uniform vec2 uImageSize; // full image size in px
uniform vec2 uOutSize;   // output size in px
uniform float uFlipY;

uniform float uStrength;
uniform float uSharpen;
uniform float uFilm;
uniform vec4 uFilmMix;   // grain, halation, vignette, soft
uniform float uFade;
uniform float uAberr;

vec2 srcUv(vec2 u) { return (u - uSrcRect.xy) / (uSrcRect.zw - uSrcRect.xy); }

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x) * 2.0 - 1.0;
}
float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

vec3 lut(vec3 c) {
  vec3 coord = (clamp(c, 0.0, 1.0) * (uLutSize - 1.0) + 0.5) / uLutSize;
  return texture(uLut, coord).rgb;
}

void main() {
  vec2 p = vec2(vPos.x, mix(vPos.y, 1.0 - vPos.y, uFlipY));
  vec2 u = mix(uOutRect.xy, uOutRect.zw, p);
  vec2 s = srcUv(u);

  // Lateral colour split that grows towards the edges (aspect-correct).
  vec2 aspect = vec2(uImageSize.x / max(uImageSize.x, uImageSize.y), uImageSize.y / max(uImageSize.x, uImageSize.y));
  vec2 d = (u - 0.5) * aspect;
  vec3 c;
  if (uAberr > 0.0) {
    vec2 off = d * dot(d, d) * uAberr / aspect;
    c = vec3(texture(uSrc, srcUv(u + off)).r, texture(uSrc, s).g, texture(uSrc, srcUv(u - off)).b);
  } else {
    c = texture(uSrc, s).rgb;
  }

  // Unsharp mask; negative amount softens (part of Filmness).
  vec3 blur = (texture(uSrc, s + vec2(uSrcTexel.x, 0)).rgb + texture(uSrc, s - vec2(uSrcTexel.x, 0)).rgb +
               texture(uSrc, s + vec2(0, uSrcTexel.y)).rgb + texture(uSrc, s - vec2(0, uSrcTexel.y)).rgb) * 0.25;
  float k = uSharpen * 1.8 - uFilm * uFilmMix.w * 0.55;
  c = clamp(c + (c - blur) * k, 0.0, 1.0);

  vec3 col = mix(c, lut(c), uStrength);

  if (uFilm > 0.0) {
    // Halation: warm glow around highlights.
    vec3 h = texture(uHalo, u).rgb;
    vec3 glow = h * vec3(1.0, 0.32, 0.18) * uFilm * uFilmMix.y * 0.9;
    col = 1.0 - (1.0 - col) * (1.0 - glow);

    // Fade: lifted blacks.
    col = uFade + col * (1.0 - uFade);

    // Vignette.
    float v = smoothstep(0.3, 0.95, length(d * 2.0 / max(aspect.x, aspect.y)) * 0.75);
    col *= 1.0 - v * uFilm * uFilmMix.z * 0.45;

    // Grain, defined in full-resolution pixels so preview and export match.
    float cell = max(1.4, min(uImageSize.x, uImageSize.y) / 1500.0);
    vec2 fullPx = u * uImageSize;
    float footprint = uImageSize.x * (uOutRect.z - uOutRect.x) / uOutSize.x;
    float n = valueNoise(fullPx / cell) * 0.75 + valueNoise(fullPx / (cell * 0.6) + 17.0) * 0.45;
    float y = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float amp = uFilm * uFilmMix.x * 0.085 * sqrt(max(0.0, 1.0 - abs(2.0 * y - 1.0)) + 0.05);
    amp *= clamp(cell / footprint, 0.35, 1.0);
    col += n * amp;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Highlight bright-pass for halation. */
export const BRIGHT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPos;
out vec4 outColor;
uniform sampler2D uSrc;
void main() {
  vec3 c = texture(uSrc, vec2(vPos.x, vPos.y)).rgb;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(0.62, 0.98, y);
  outColor = vec4(vec3(w * w), 1.0);
}`;

/** 13-tap separable gaussian. */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPos;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uDir; // texel step * radius scale
void main() {
  float w[7] = float[](0.1964, 0.1748, 0.1232, 0.0688, 0.0304, 0.0107, 0.0030);
  vec3 acc = texture(uSrc, vPos).rgb * w[0];
  for (int i = 1; i < 7; i++) {
    acc += texture(uSrc, vPos + uDir * float(i)).rgb * w[i];
    acc += texture(uSrc, vPos - uDir * float(i)).rgb * w[i];
  }
  outColor = vec4(acc, 1.0);
}`;
