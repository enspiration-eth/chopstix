import { describe, expect, it } from 'vitest'
import {
  BOOSTER,
  CATCH,
  NO_CONTROLS,
  WORLD,
  autopilot,
  basePoint,
  boosterMass,
  initialState,
  score,
  step,
} from './index'
import type { Controls, SimState } from './index'

const run = (s: SimState, c: Controls, seconds: number) => {
  let st = s
  const n = Math.round(seconds * 120)
  for (let i = 0; i < n; i++) st = step(st, c).state
  return st
}

const both: Controls = { ...NO_CONTROLS, q: true, p: true }

const fallingBoosterAt = (h: number, vy: number, dx = 0, theta = 0): SimState => {
  const s = initialState(7)
  const baseY = WORLD.armY - WORLD.pinsAboveBase + h
  return {
    ...s,
    phase: 'Return',
    stacked: false,
    fuel: 150,
    booster: { x: WORLD.catchX + dx, y: baseY + BOOSTER.comFromBase, vx: 0, vy, theta, omega: 0 },
  }
}

describe('flight model', () => {
  it('is deterministic for a seed and input sequence', () => {
    const a = run(initialState(42), both, 20)
    const b = run(initialState(42), both, 20)
    expect(a).toEqual(b)
  })

  it('stays clamped on the pad without thrust', () => {
    const s = run(initialState(1), NO_CONTROLS, 5)
    expect(s.phase).toBe('Pad')
    expect(s.booster.y).toBe(initialState(1).booster.y)
  })

  it('cannot lift off on a single bank', () => {
    const s = run(initialState(1), { ...NO_CONTROLS, q: true }, 3)
    expect(s.phase).toBe('Pad')
  })

  it('lifts off when both banks are lit and burns fuel', () => {
    const s = run(initialState(1), both, 6)
    expect(s.phase).toBe('Ascent')
    expect(basePoint(s).y).toBeGreaterThan(WORLD.mountHeight + 20)
    expect(s.fuel).toBeLessThan(BOOSTER.fuelCapacity)
  })

  it('left bank harder than right pitches the nose right (positive tilt)', () => {
    const up = run(initialState(3), both, 4)
    const s = run(up, { ...NO_CONTROLS, q: true }, 1)
    expect(s.booster.omega).toBeGreaterThan(0)
  })

  it('gimbal O swings the nose right, W swings it left', () => {
    const up = run(initialState(3), both, 4)
    const o = run(up, { ...both, o: true }, 1.5)
    const w = run(up, { ...both, w: true }, 1.5)
    expect(o.booster.theta).toBeGreaterThan(up.booster.theta)
    expect(w.booster.theta).toBeLessThan(up.booster.theta)
  })

  it('only stages above the minimum release altitude, then drops the ship mass', () => {
    const low = run(initialState(5), both, 3)
    const tryLow = step(low, { ...both, stage: true }).state
    expect(tryLow.stacked).toBe(true)
    const high = run(initialState(5), both, 15)
    const staged = step(high, { ...both, stage: true })
    expect(staged.state.stacked).toBe(false)
    expect(staged.state.ship.active).toBe(true)
    expect(boosterMass(staged.state)).toBeLessThan(boosterMass(high))
    expect(staged.events.some(e => e._tag === 'Separation')).toBe(true)
  })

  it('catches a slow, centred, upright booster', () => {
    const s = run(fallingBoosterAt(1.5, -3), NO_CONTROLS, 1)
    expect(s.phase).toBe('Caught')
    expect(s.outcome?.kind).toBe('Caught')
  })

  it('rejects a booster that comes in too fast', () => {
    const s = run(fallingBoosterAt(2, -(CATCH.maxSinkRate + 6)), NO_CONTROLS, 1)
    expect(s.phase).toBe('Crashed')
  })

  it('rejects a booster that comes in tilted', () => {
    const s = run(fallingBoosterAt(1.5, -3, 0, (CATCH.maxTiltDeg + 4) * (Math.PI / 180)), NO_CONTROLS, 1)
    expect(s.phase).toBe('Crashed')
  })

  it('lithobrakes when it falls freely', () => {
    const s = run(fallingBoosterAt(800, -60, 200), NO_CONTROLS, 30)
    expect(s.phase).toBe('Crashed')
  })
})

describe('scoring', () => {
  it('rewards a catch far more than a crash', () => {
    const caught = run(fallingBoosterAt(1.5, -3), NO_CONTROLS, 1)
    const crashed = run(fallingBoosterAt(2, -20), NO_CONTROLS, 1)
    expect(score(caught).total).toBeGreaterThan(score(crashed).total + 4000)
  })
})

describe('autopilot (proves the mission is flyable with only Q/W/O/P/SPACE)', () => {
  const fly = (seed: number) => {
    let s = initialState(seed)
    while (s.t < 300 && (s.phase === 'Pad' || s.phase === 'Ascent' || s.phase === 'Return')) {
      s = step(s, autopilot(s)).state
    }
    return s
  }

  it('catches the booster on most seeds', () => {
    const results = Array.from({ length: 12 }, (_, i) => fly(i + 1))
    const caught = results.filter(s => s.phase === 'Caught').length
    expect(caught).toBeGreaterThanOrEqual(8)
    for (const s of results) expect(s.release).not.toBeNull()
  })
})

describe('descent guidance', () => {
  it('predicts a coast that lands where the engines-off sim lands', async () => {
    const { guidance, CATCH_BASE_Y } = await import('./index')
    const s0: SimState = { ...fallingBoosterAt(1500, -120, 400), booster: { ...fallingBoosterAt(1500, -120, 400).booster, vx: -25 } }
    const g = guidance(s0)
    let s = s0
    while (basePoint(s).y > CATCH_BASE_Y && s.phase === 'Return') s = step(s, NO_CONTROLS).state
    const real = basePoint(s).x - WORLD.catchX
    expect(Math.abs(g.impactDx - real)).toBeLessThan(25)
    expect(g.impactT).toBeGreaterThan(3)
    expect(g.path.length).toBeGreaterThan(4)
    expect(g.stopAlt).toBeGreaterThan(0)
    expect(g.burning).toBe(false)
  })

  it('switches to a braking prediction inside the stopping distance', async () => {
    const { guidance } = await import('./index')
    const s0 = fallingBoosterAt(300, -90, 20)
    const g = guidance(s0)
    expect(g.burning).toBe(true)
    expect(g.impactT).toBeGreaterThan(300 / 90)
    // the braking distance matches the real sim burning both banks flat out (spool-up makes it a bit longer)
    let s = s0
    for (let i = 0; i < 120 * 30 && s.booster.vy < 0 && s.phase === 'Return'; i++) s = step(s, both).state
    const lost = basePoint(s0).y - basePoint(s).y
    expect(Math.abs(g.stopAlt - lost) / lost).toBeLessThan(0.2)
  })
})
