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

export const deckCover = (n: CloudNoise, x: number, z: number) => {
  const c = n.sample(x / DECK.coverScale, z / DECK.coverScale, 0) * 0.62 + n.sample(x / DECK.billowScale + 0.37, z / DECK.billowScale + 0.37, 1) * 0.38
  const t = Math.min(1, Math.max(0, (c - 0.42) / (0.64 - 0.42)))
  return t * t * (3 - 2 * t)
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
