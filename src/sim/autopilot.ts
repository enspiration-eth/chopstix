import { BOOSTER, ENGINES, G, STACK, WORLD } from './constants'
import { basePoint, boosterMass, pinsPoint } from './physics'
import type { Controls, SimState } from './types'

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export interface AutopilotMemory {
  readonly boostback: boolean
}

/**
 * A bang-bang "pilot" that only presses the same four keys a human has.
 * It proves the mission is flyable (see autopilot.test.ts) and flies the title-screen attract loop.
 */
export const autopilot = (s: SimState): Controls => {
  const b = s.booster
  const base = basePoint(s)
  const none: Controls = { q: false, w: false, o: false, p: false, stage: false }
  if (s.phase === 'Crashed' || s.phase === 'Caught' || s.phase === 'Touchdown') return none

  const attitude = (thetaCmd: number, enginesOn: boolean) => {
    const err = b.theta - thetaCmd
    const c = err + 0.9 * b.omega + (enginesOn ? 0.6 * (s.gimbal / ENGINES.gimbalMax) * 0.05 : 0)
    const dead = 0.0025
    return { w: c > dead, o: c < -dead, c }
  }

  if (s.stacked) {
    const thetaCmd = clamp(-0.004 * b.vx - 0.00012 * (base.x - WORLD.catchX), -0.06, 0.06)
    const { w, o, c } = attitude(thetaCmd, true)
    const stage = base.y >= s.targetAlt - 15 || (b.vy < 8 && base.y > s.targetAlt - 400)
    // MECO when the coast alone will carry us past the target
    const coastHeight = (Math.max(0, b.vy) * Math.max(0, b.vy)) / (2 * G) * 0.92
    const meco = base.y + coastHeight > s.targetAlt + 20
    if (meco) return { q: c < -0.002, p: c > 0.002, w, o, stage }
    return { q: !(c > 0.035), p: !(c < -0.035), w, o, stage }
  }

  // ---- booster return
  const pins = pinsPoint(s)
  const h = pins.y - WORLD.armY
  const dx = base.x - WORLD.catchX
  const mass = boosterMass(s)
  const maxAcc = (2 * ENGINES.bankThrust * ENGINES.returnThrustScale) / mass - G
  const sink = -b.vy

  const tApex = Math.max(0, b.vy) / G
  const hApex = h + Math.max(0, b.vy) * tApex * 0.5
  const tFall = tApex + hApex / 110
  const dxAim = dx - 22
  const predicted = dxAim + b.vx * tFall

  const needed = sink > 0 ? (sink * sink) / (2 * Math.max(1, h - 4)) : 0
  const targetSink = Math.max(3.5, Math.sqrt(2 * maxAcc * 0.5 * Math.max(0, h - 2)))
  const centered = Math.abs(dx) < 2.2 && Math.abs(b.vx) < 1.2
  const finalApproach = h < 260
  const sinkCmd = centered ? Math.min(targetSink, Math.max(3, h * 0.08)) : dx < -6 ? -4 : h > 70 ? Math.min(targetSink, 6) : -1.5
  const landingBurn = finalApproach
    ? sink > sinkCmd || (needed > maxAcc * 0.7)
    : h < 2500 && sink > 0 && needed > maxAcc * 0.6

  const boostback = !landingBurn && Math.hypot(b.vx, b.vy) < 90 && h > 2200 && Math.abs(dxAim + b.vx * (tApex + hApex / 130)) > 90 && s.fuel > BOOSTER.fuelCapacity * 0.18
  const burning = landingBurn || boostback || (finalApproach && Math.abs(b.theta) < 0.3 && !centered && sink > -3)

  let thetaCmd: number
  if (boostback) thetaCmd = clamp(-predicted * 0.003, -0.45, 0.45)
  else if (finalApproach) {
    const towerSide = dx < -8 && base.y < WORLD.towerHeight + 20
    const vxCmd = towerSide ? (dx < -WORLD.towerHalfWidth * 2 - 30 ? 0 : -3) : clamp(-dx * 0.22, -8, 8)
    thetaCmd = clamp(0.03 * (vxCmd - b.vx), -0.12, 0.12)
  }
  else if (landingBurn && sink < 45) thetaCmd = clamp(0.02 * (clamp(-dxAim * 0.3, -12, 12) - b.vx), -0.14, 0.14)
  else if (landingBurn) thetaCmd = clamp(-0.01 * (clamp(-dxAim * 0.1, -25, 25) - b.vx), -0.06, 0.06)
  else if (b.vy > 0) thetaCmd = 0
  else thetaCmd = clamp(-0.03 * (clamp(-dxAim * 0.1, -50, 50) - b.vx), -0.35, 0.35)
  if (h < 25) thetaCmd = clamp(thetaCmd, -0.03, 0.03)

  const err = b.theta - thetaCmd
  const c = err + (burning ? 0.7 : 1.2) * b.omega
  const dead = burning ? 0.002 : 0.01
  const w = c > dead
  const o = c < -dead
  const aligned = Math.abs(err) < 1.0
  const q = burning && (aligned || !boostback) && !(c > 0.06)
  const p = burning && (aligned || !boostback) && !(c < -0.06)
  void STACK
  return { q, p, w, o, stage: false }
}
