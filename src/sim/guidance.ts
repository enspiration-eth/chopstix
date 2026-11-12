import { BOOSTER, ENGINES, G, STACK, WORLD } from './constants'
import { airDensity, basePoint, boosterMass, windAt } from './physics'
import type { SimState } from './types'

/** Height of the booster base when its catch pins are level with the chopstick arms. */
export const CATCH_BASE_Y = WORLD.armY - WORLD.pinsAboveBase

export interface Guidance {
  /** where the base crosses catch height if the engines stay off, relative to the tower (m) */
  readonly impactDx: number
  /** seconds until that crossing */
  readonly impactT: number
  /** height needed to stop the current sink rate at full return thrust, drag included (m) */
  readonly stopAlt: number
  /** the coast path, flattened [dx0, alt0, dx1, alt1, ...] relative to the tower */
  readonly path: ReadonlyArray<number>
  /** inside the braking distance: the prediction assumes a steady burn to the arms */
  readonly burning: boolean
}

/**
 * Engines-off coast prediction (gravity, drag, wind), integrated coarsely.
 * Pure and cheap (<= 240 steps), so the HUD can call it a few times a second.
 */
/** Height lost while braking the current sink rate with every return engine at full throttle (drag helps). */
const stoppingHeight = (s: SimState, y0: number, mass: number, cdA: number, thrustAcc: number) => {
  let vy = s.booster.vy
  const vx = s.booster.vx
  let y = y0
  const dt = 0.05
  for (let i = 0; i < 1600 && vy < 0; i++) {
    const v = Math.hypot(vx, vy)
    const drag = v > 0.5 ? (0.5 * airDensity(y) * v * cdA) / mass : 0
    vy += (thrustAcc - G - vy * drag) * dt
    y += vy * dt
  }
  return Math.max(0, y0 - y)
}

/**
 * Impact prediction for the HUD. Above the burn point it is the engines-off coast (gravity, drag, wind);
 * once the booster is inside its braking distance it assumes a steady burn that stops at catch height.
 * Pure and cheap (a few hundred steps), so the HUD can call it many times a second.
 */
export const guidance = (s: SimState): Guidance => {
  const geo = s.stacked ? STACK : BOOSTER
  const mass = boosterMass(s)
  const b0 = basePoint(s)
  const thrust = 2 * ENGINES.bankThrust * (s.stacked ? 1 : ENGINES.returnThrustScale)
  const stopAlt = stoppingHeight(s, b0.y, mass, geo.cdA, thrust / mass)
  const above = b0.y - CATCH_BASE_Y
  const sink0 = Math.max(0, -s.booster.vy)
  const burning = sink0 > 2 && above > 1 && above < stopAlt * 1.3
  // steady braking that ends exactly at catch height
  const brake = burning ? Math.min((sink0 * sink0) / (2 * above), thrust / mass) : 0
  let x = b0.x
  let y = b0.y
  let vx = s.booster.vx
  let vy = s.booster.vy
  let t = 0
  const dt = burning ? 0.1 : 0.25
  const path: number[] = [x - WORLD.catchX, Math.max(0, y)]
  const every = burning ? 8 : 4
  let i = 0
  while (y > CATCH_BASE_Y && t < 60) {
    const wind = windAt(s.seed, s.windDir, y, s.met + t)
    const rx = vx - wind
    const vr = Math.hypot(rx, vy)
    const k = vr > 0.5 ? (0.5 * airDensity(y) * vr * geo.cdA) / mass : 0
    const ax = -rx * k
    // while braking, the burn holds the planned deceleration (drag is already part of it)
    const ay = burning ? brake : -G - vy * k
    vx += ax * dt
    vy = burning ? Math.min(vy + ay * dt, -0.5) : vy + ay * dt
    const nx = x + vx * dt
    const ny = y + vy * dt
    if (ny <= CATCH_BASE_Y) {
      // land the last step exactly on the catch height
      const f = (y - CATCH_BASE_Y) / Math.max(y - ny, 1e-6)
      x += (nx - x) * f
      y = CATCH_BASE_Y
      t += dt * f
      break
    }
    x = nx
    y = ny
    t += dt
    if (++i % every === 0) path.push(x - WORLD.catchX, Math.max(0, y))
  }
  path.push(x - WORLD.catchX, Math.max(0, y))
  return { impactDx: x - WORLD.catchX, impactT: t, stopAlt, path, burning }
}
