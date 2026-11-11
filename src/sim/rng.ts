/** mulberry32: tiny deterministic PRNG with explicit state so the sim stays pure */
export const nextRandom = (state: number): readonly [number, number] => {
  let t = (state + 0x6d2b79f5) | 0
  const nextState = t
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, nextState]
}

export const hashSeed = (seed: number): number => {
  let h = seed | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) | 0
}
