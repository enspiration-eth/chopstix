export interface QualityTier {
  readonly name: 'LOW' | 'MEDIUM' | 'HIGH'
  readonly maxDpr: number
  readonly bloom: boolean
  readonly bloomScale: number
  readonly clouds: number
  readonly smoke: number
  readonly fire: number
  /** ray-march steps through the cloud deck */
  readonly deckSteps: number
  readonly cloudShadows: boolean
}

export const TIERS: ReadonlyArray<QualityTier> = [
  { name: 'LOW', maxDpr: 1, bloom: false, bloomScale: 0.5, clouds: 60, smoke: 500, fire: 400, deckSteps: 4, cloudShadows: false },
  { name: 'MEDIUM', maxDpr: 1.5, bloom: true, bloomScale: 0.5, clouds: 120, smoke: 1100, fire: 900, deckSteps: 6, cloudShadows: true },
  { name: 'HIGH', maxDpr: 2, bloom: true, bloomScale: 1, clouds: 190, smoke: 1800, fire: 1400, deckSteps: 10, cloudShadows: true },
]

export const isMobile = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && 'ontouchend' in document))

/**
 * Frame-time governor: drops a tier after sustained slow frames, climbs back (never above the
 * starting tier) after a long run of fast ones.
 */
export class QualityGovernor {
  tier: number
  private readonly ceiling: number
  private ema = 16.7
  private slow = 0
  private fast = 0
  private settle = 2

  constructor(start: number, private readonly pinned = false) {
    this.tier = start
    this.ceiling = start
  }

  /** returns true when the tier changed */
  sample(frameMs: number, dt: number): boolean {
    this.ema += (Math.min(frameMs, 100) - this.ema) * (this.pinned ? 0.05 : 0)
    if (this.pinned) return false
    if (this.settle > 0) {
      this.settle -= dt
      return false
    }
    this.ema += (Math.min(frameMs, 100) - this.ema) * 0.05
    if (this.ema > 22) this.slow += dt
    else this.slow = Math.max(0, this.slow - dt * 0.5)
    if (this.ema < 15.5) this.fast += dt
    else this.fast = 0
    if (this.slow > 2.2 && this.tier > 0) {
      this.tier--
      this.reset()
      return true
    }
    if (this.fast > 10 && this.tier < this.ceiling) {
      this.tier++
      this.reset()
      return true
    }
    return false
  }

  get frameMs() {
    return this.ema
  }

  private reset() {
    this.slow = 0
    this.fast = 0
    this.ema = 16.7
    this.settle = 2
  }
}

/** `?tier=low|medium|high` pins the quality tier (debugging and screenshots). */
export const pinnedTier = (): number | null => {
  if (typeof location === 'undefined') return null
  const t = new URLSearchParams(location.search).get('tier')?.toUpperCase()
  const i = TIERS.findIndex(x => x.name === t)
  return i >= 0 ? i : null
}
