import { CATCH, MISSION, TOUCHDOWN } from './constants'
import type { SimState } from './types'

export interface ScoreBreakdown {
  readonly altitude: number
  readonly release: number
  readonly landing: number
  readonly fuel: number
  readonly total: number
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Pure scoring: altitude reached, payload release accuracy, catch quality, fuel left. */
export const score = (s: SimState): ScoreBreakdown => {
  const altitude = Math.round(Math.max(0, s.maxAlt) * 0.25)
  let release = 0
  if (s.release) {
    const err = Math.abs(s.release.alt - s.targetAlt)
    const acc = clamp01(1 - err / MISSION.releaseWindow)
    const tilt = clamp01(1 - s.release.tiltDeg / 25)
    release = Math.round(3000 * Math.pow(acc, 1.5) * (0.4 + 0.6 * tilt))
  }
  let landing = 0
  let fuel = 0
  const o = s.outcome
  if (o && o.kind === 'Caught') {
    const sink = clamp01(1 - Math.abs(o.vy) / CATCH.maxSinkRate)
    const centre = clamp01(1 - Math.abs(o.dx) / CATCH.maxDx)
    const tilt = clamp01(1 - o.tiltDeg / CATCH.maxTiltDeg)
    const drift = clamp01(1 - Math.abs(o.vx) / CATCH.maxDrift)
    landing = Math.round(4000 + 4000 * (0.35 * sink + 0.3 * centre + 0.2 * tilt + 0.15 * drift))
    fuel = Math.round(s.fuel * 8)
  } else if (o && o.kind === 'Touchdown') {
    const soft = clamp01(1 - Math.hypot(o.vx, o.vy) / TOUCHDOWN.maxSpeed)
    landing = Math.round(1000 + 1000 * soft)
    fuel = Math.round(s.fuel * 4)
  }
  return { altitude, release, landing, fuel, total: altitude + release + landing + fuel }
}
