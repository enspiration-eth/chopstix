/** Shared GLSL snippets. */
export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03;
    a *= 0.5;
  }
  return v;
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03;
    a *= 0.5;
  }
  return v;
}
`

/** Analytic sky model shared by the sky dome, the ground haze and the clouds so they agree. */
export const SKY = /* glsl */ `
uniform vec3 uSunDir;
uniform float uAltitude;
vec3 skyColor(vec3 dir, float alt) {
  float a = clamp(alt / 11000.0, 0.0, 1.0);
  float space = smoothstep(0.15, 1.0, a);
  float y = dir.y;
  // the horizon dips as we climb
  float dip = -0.012 - sqrt(2.0 * max(alt, 0.0) / 400000.0);
  float h = clamp((y - dip) / (1.0 - dip), 0.0, 1.0);
  vec3 zenith = mix(vec3(0.035, 0.15, 0.5), vec3(0.004, 0.008, 0.03), space);
  vec3 horizon = mix(vec3(0.6, 0.7, 0.84), vec3(0.32, 0.55, 0.95), space * 0.85);
  float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);
  // golden-hour tint on the horizon toward the sun
  vec2 flat2 = dir.xz / max(length(dir.xz), 1e-4);
  float toward = max(dot(flat2, normalize(uSunDir.xz)), 0.0);
  vec3 warm = vec3(1.0, 0.62, 0.36);
  horizon = mix(horizon, warm, pow(toward, 2.0) * 0.7 * (1.0 - space * 0.6));
  float bandWidth = mix(4.0, 22.0, space);
  vec3 col = mix(horizon, zenith, pow(h, 1.0 / (1.0 + bandWidth * 0.12)));
  // thin limb glow in near-space
  col += vec3(0.25, 0.45, 1.0) * exp(-abs(y - dip) * mix(60.0, 140.0, space)) * space * 0.9;
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.85, 0.65) * pow(sd, 12.0) * mix(0.35, 0.15, space);
  col += vec3(1.0, 0.75, 0.5) * pow(sd, 3.0) * 0.12 * (1.0 - space);
  return col * mix(1.0, 0.6, sunUp * 0.0);
}
`
