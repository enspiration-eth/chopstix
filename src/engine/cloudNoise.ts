import * as THREE from 'three'

/**
 * One tileable 256² RGBA noise texture shared by every cloud and the ground shadows.
 * R: smooth fbm (cloud masses), G: inverted Worley (billows), B: fine fbm (detail), A: fine Worley.
 * Computed on the CPU once, so the shaders only pay for texture taps instead of procedural noise,
 * and the CPU can sample the same field (camera-in-cloud fog, punch-through).
 */
const SIZE = 256

const hash = (x: number, y: number, s: number) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const valueNoise = (x: number, y: number, period: number, seed: number) => {
  const xi = Math.floor(x), yi = Math.floor(y)
  const fx = x - xi, fy = y - yi
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const m = (v: number) => ((v % period) + period) % period
  const a = hash(m(xi), m(yi), seed), b = hash(m(xi + 1), m(yi), seed)
  const c = hash(m(xi), m(yi + 1), seed), d = hash(m(xi + 1), m(yi + 1), seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

const fbm = (u: number, v: number, base: number, octaves: number, seed: number) => {
  let sum = 0, amp = 0.5, norm = 0, f = base
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * f, v * f, f, seed + o * 17)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

const worley = (u: number, v: number, cells: number, seed: number) => {
  const x = u * cells, y = v * cells
  const xi = Math.floor(x), yi = Math.floor(y)
  let best = 9
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells
      const px = cx + hash(wx, wy, seed), py = cy + hash(wx, wy, seed + 5)
      const d = (px - x) * (px - x) + (py - y) * (py - y)
      if (d < best) best = d
    }
  return 1 - Math.min(1, Math.sqrt(best))
}

const stretch = (a: Float32Array) => {
  let lo = Infinity, hi = -Infinity
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v }
  const k = 1 / Math.max(hi - lo, 1e-6)
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! - lo) * k
}

export interface CloudNoise {
  readonly texture: THREE.DataTexture
  /** bilinear, wrapped sample of one channel at texture coords (u, v) */
  sample(u: number, v: number, channel: 0 | 1 | 2 | 3): number
}

export const createCloudNoise = (): CloudNoise => {
  const ch = [0, 1, 2, 3].map(() => new Float32Array(SIZE * SIZE))
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE, i = y * SIZE + x
      ch[0]![i] = fbm(u, v, 4, 5, 11)
      ch[1]![i] = worley(u, v, 8, 23) * 0.7 + worley(u, v, 16, 31) * 0.3
      ch[2]![i] = fbm(u, v, 16, 4, 47)
      ch[3]![i] = worley(u, v, 24, 59)
    }
  ch.forEach(stretch)
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++)
    for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(ch[c]![i]! * 255)
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  const sample = (u: number, v: number, c: 0 | 1 | 2 | 3) => {
    const x = (u - Math.floor(u)) * SIZE - 0.5, y = (v - Math.floor(v)) * SIZE - 0.5
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
    const at = (i: number, j: number) => data[((((j % SIZE) + SIZE) % SIZE) * SIZE + (((i % SIZE) + SIZE) % SIZE)) * 4 + c]! / 255
    const a = at(xi, yi), b = at(xi + 1, yi), d = at(xi, yi + 1), e = at(xi + 1, yi + 1)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
  }
  return { texture, sample }
}

/** Deck geometry, mirrored by DECK_GLSL in clouds.ts. */
export const DECK = { base: 2600, thick: 380, coverScale: 7000, billowScale: 1900, detailScale: 420 }

/**
 * Deck coverage that never visibly repeats. The noise texture tiles, so on its own the deck
 * would repeat every 7 km; from 10+ km up that reads as wallpaper. Three things break it:
 *  - a slow domain warp (period 31 km, rotated) bends the tile grid so cells never line up,
 *  - cloud masses mix three rotated scales whose periods (4.4, 7, 11.3 km) are incommensurate,
 *  - a 61 km "weather" field moves the coverage threshold: clear patches next to dense systems.
 * Warp and weather vary over kilometres, so the deck shader computes them once per pixel.
 * The weather offset is picked so the launch site sits under a cloudy system (the ascent punches the deck).
 * The GLSL below and the CPU functions after it are the same formula.
 */
const W = {
  weatherScale: 61000, weatherRot: [0.3624, -0.932] as const, weatherOff: [0.155, 0.217] as const,
  warpScale: 31000, warpRot: [0.8253, 0.5646] as const, warpOff: [0.57, 0.29] as const, warpAmp: 2800,
  coverScale2: 11326, coverRot: [0.2272, 0.9738] as const, coverOff: 0.41,
  coverScale3: 4423, coverRot3: [0.4536, -0.8912] as const, coverOff3: 0.77,
  billowRot: [0.9553, -0.2955] as const,
}
const f1 = (v: number) => v.toFixed(1)
const f4 = (v: number) => v.toFixed(4)
const rotG = (r: readonly [number, number], p: string) =>
  `vec2(${f4(r[0])} * ${p}.x - ${f4(r[1])} * ${p}.y, ${f4(r[1])} * ${p}.x + ${f4(r[0])} * ${p}.y)`
const rot = (r: readonly [number, number], x: number, z: number): [number, number] => [r[0] * x - r[1] * z, r[1] * x + r[0] * z]

/** needs `uniform sampler2D uCloudTex` declared before it */
export const DECK_COVER_GLSL = /* glsl */ `
// xy: domain-warp offset in metres, z: weather 0 (clear) .. 1 (stormy)
vec3 deckWeather(vec2 xz) {
  vec2 q = ${rotG(W.warpRot, 'xz')} / ${f1(W.warpScale)} + vec2(${f4(W.warpOff[0])}, ${f4(W.warpOff[1])});
  vec2 warp = vec2(texture2D(uCloudTex, q).r, texture2D(uCloudTex, q + vec2(0.5, 0.5)).r) - 0.5;
  vec2 wq = ${rotG(W.weatherRot, 'xz')} / ${f1(W.weatherScale)} + vec2(${f4(W.weatherOff[0])}, ${f4(W.weatherOff[1])});
  float weather = smoothstep(0.25, 0.75, texture2D(uCloudTex, wq).r);
  return vec3(warp * ${f1(W.warpAmp)}, weather);
}
vec2 deckDetailUV(vec2 pw) { return ${rotG(W.billowRot, 'pw')} / ${f1(DECK.detailScale)}; }
// pw: warped position (xz + deckWeather(xz).xy); weather: deckWeather(xz).z
float deckCoverW(vec2 pw, float weather, float time) {
  float m1 = texture2D(uCloudTex, pw / ${f1(DECK.coverScale)}).r;
  float m2 = texture2D(uCloudTex, ${rotG(W.coverRot, 'pw')} / ${f1(W.coverScale2)} + ${f4(W.coverOff)}).r;
  float m3 = texture2D(uCloudTex, ${rotG(W.coverRot3, 'pw')} / ${f1(W.coverScale3)} + ${f4(W.coverOff3)}).r;
  float masses = clamp(0.5 + (m1 * 0.4 + m2 * 0.35 + m3 * 0.25 - 0.5) * 1.65, 0.0, 1.0);
  float b = texture2D(uCloudTex, ${rotG(W.billowRot, 'pw')} / ${f1(DECK.billowScale)} + 0.37 + vec2(time * 0.0006, 0.0)).g;
  float lo = mix(0.50, 0.33, weather);
  return smoothstep(lo, lo + 0.22, masses * 0.62 + b * 0.38);
}
`

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export const deckWeather = (n: CloudNoise, x: number, z: number): [number, number, number] => {
  const [qx0, qz0] = rot(W.warpRot, x, z)
  const qx = qx0 / W.warpScale + W.warpOff[0], qz = qz0 / W.warpScale + W.warpOff[1]
  const wx = n.sample(qx, qz, 0) - 0.5, wz = n.sample(qx + 0.5, qz + 0.5, 0) - 0.5
  const [rx, rz] = rot(W.weatherRot, x, z)
  const weather = smooth(0.25, 0.75, n.sample(rx / W.weatherScale + W.weatherOff[0], rz / W.weatherScale + W.weatherOff[1], 0))
  return [wx * W.warpAmp, wz * W.warpAmp, weather]
}

export const deckCover = (n: CloudNoise, x: number, z: number, time = 0) => {
  const [wx, wz, weather] = deckWeather(n, x, z)
  const px = x + wx, pz = z + wz
  const m1 = n.sample(px / DECK.coverScale, pz / DECK.coverScale, 0)
  const [cx, cz] = rot(W.coverRot, px, pz)
  const m2 = n.sample(cx / W.coverScale2 + W.coverOff, cz / W.coverScale2 + W.coverOff, 0)
  const [ex, ez] = rot(W.coverRot3, px, pz)
  const m3 = n.sample(ex / W.coverScale3 + W.coverOff3, ez / W.coverScale3 + W.coverOff3, 0)
  const masses = Math.min(1, Math.max(0, 0.5 + (m1 * 0.4 + m2 * 0.35 + m3 * 0.25 - 0.5) * 1.65))
  const [bx, bz] = rot(W.billowRot, px, pz)
  const b = n.sample(bx / DECK.billowScale + 0.37 + time * 0.0006, bz / DECK.billowScale + 0.37, 1)
  const lo = 0.50 + (0.33 - 0.50) * weather
  return smooth(lo, lo + 0.22, masses * 0.62 + b * 0.38)
}

/** 0..1 how deep inside the deck a point is (for the camera-in-cloud whiteout). */
export const deckDensityAt = (n: CloudNoise, x: number, y: number, z: number) => {
  const c = deckCover(n, x, z)
  if (c < 0.01) return 0
  const top = DECK.base + DECK.thick * (0.25 + 0.75 * Math.pow(c, 0.7))
  const bottom = DECK.base + 40 * (1 - c)
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  return clamp01((top - y) / 45) * clamp01((y - bottom) / 35)
}
