import {
  ANGULAR_DAMPING,
  ATM,
  BOOSTER,
  BREAKUP,
  CATCH,
  DT,
  ENGINES,
  FINS,
  G,
  MISSION,
  STACK,
  TOUCHDOWN,
  WORLD,
} from './constants'
import { hashSeed, nextRandom } from './rng'
import type { Body, Controls, Outcome, SimEvent, SimState, Telemetry } from './types'

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const RAD = 180 / Math.PI

export const airDensity = (alt: number): number => ATM.rho0 * Math.exp(-Math.max(0, alt) / ATM.scaleHeight)

/** Horizontal wind (m/s, signed) at an altitude and time. Pure function of the seed. */
export const windAt = (seed: number, windDir: number, alt: number, t: number): number => {
  const p1 = (seed % 997) * 0.37
  const p2 = (seed % 613) * 0.71
  const base = 3 + 11 * smoothstep(400, 5200, alt)
  const gust = 2.5 * Math.sin(0.31 * t + p1) + 1.8 * Math.sin(1.07 * t + p2 + alt * 0.0021)
  return windDir * (base + gust * (0.4 + 0.6 * smoothstep(100, 2000, alt)))
}

export const isStackedGeometry = (s: SimState) => (s.stacked ? STACK : BOOSTER)

export const boosterMass = (s: Pick<SimState, 'stacked' | 'fuel'>): number =>
  BOOSTER.dryMass + s.fuel + (s.stacked ? STACK.shipMass : 0)

const up = (theta: number) => ({ x: Math.sin(theta), y: Math.cos(theta) })

/** World-space position of the engine plane (bottom of the booster). */
export const basePoint = (s: Pick<SimState, 'booster' | 'stacked'>) => {
  const geo = s.stacked ? STACK : BOOSTER
  const u = up(s.booster.theta)
  return { x: s.booster.x - u.x * geo.comFromBase, y: s.booster.y - u.y * geo.comFromBase }
}

export const pinsPoint = (s: Pick<SimState, 'booster' | 'stacked'>) => {
  const b = basePoint(s)
  const u = up(s.booster.theta)
  return { x: b.x + u.x * WORLD.pinsAboveBase, y: b.y + u.y * WORLD.pinsAboveBase }
}

const groundHeightAt = (x: number) =>
  Math.abs(x - WORLD.catchX) < WORLD.mountHalfWidth ? WORLD.mountHeight : 0

const inTower = (x: number, y: number) =>
  y < WORLD.towerHeight && Math.abs(x - WORLD.towerX) < WORLD.towerHalfWidth

export const initialState = (seed: number): SimState => {
  const h = hashSeed(seed)
  const [r1, s1] = nextRandom(h)
  const [r2, s2] = nextRandom(s1)
  const target = Math.round((MISSION.targetMin + r1 * (MISSION.targetMax - MISSION.targetMin)) / 50) * 50
  const booster: Body = {
    x: WORLD.catchX,
    y: WORLD.mountHeight + STACK.comFromBase,
    vx: 0,
    vy: 0,
    theta: 0,
    omega: 0,
  }
  return {
    seed,
    rng: s2,
    t: 0,
    met: 0,
    phase: 'Pad',
    booster,
    stacked: true,
    fuel: BOOSTER.fuelCapacity,
    throttleL: 0,
    throttleR: 0,
    jitterL: 0,
    jitterR: 0,
    gimbal: 0,
    fins: 0,
    ship: { x: 0, y: 0, vx: 0, vy: 0, theta: 0, omega: 0, active: false, burn: 0 },
    targetAlt: target,
    windDir: r2 < 0.5 ? -1 : 1,
    maxAlt: 0,
    maxQ: 0,
    maxQPassed: false,
    lowFuelWarned: false,
    release: null,
    outcome: null,
    arms: 0,
    armsX: WORLD.catchX,
  }
}

const approach = (v: number, target: number, rate: number) =>
  v < target ? Math.min(target, v + rate) : Math.max(target, v - rate)

const makeOutcome = (
  s: SimState,
  kind: Outcome['kind'],
  reason: string,
): Outcome => {
  const b = basePoint(s)
  return {
    kind,
    reason,
    dx: b.x - WORLD.catchX,
    vx: s.booster.vx,
    vy: s.booster.vy,
    tiltDeg: Math.abs(s.booster.theta) * RAD,
    t: s.met,
  }
}

const stepShip = (s: SimState, dt: number): SimState['ship'] => {
  const sh = s.ship
  if (!sh.active) return sh
  const burn = Math.min(1, sh.burn + dt / 1.6)
  const theta = approach(sh.theta, 0.42, 0.06 * dt)
  const acc = burn > 0.25 ? 17 * burn : 0
  const u = up(theta)
  const vx = sh.vx + u.x * acc * dt
  const vy = sh.vy + (u.y * acc - G) * dt
  return { ...sh, burn, theta, vx, vy, x: sh.x + vx * dt, y: sh.y + vy * dt }
}

export interface StepResult {
  readonly state: SimState
  readonly events: ReadonlyArray<SimEvent>
}

/**
 * Advance the simulation by one fixed timestep. Pure: same state + controls → same result.
 */
export const step = (prev: SimState, c: Controls, dt: number = DT): StepResult => {
  const events: SimEvent[] = []
  const t = prev.t + dt

  // Terminal phases: only animate the ship and the catch arms.
  if (prev.phase === 'Caught') {
    const arms = Math.min(1, prev.arms + dt / 0.55)
    const b = prev.booster
    const targetY = WORLD.armY - WORLD.pinsAboveBase + BOOSTER.comFromBase
    const k = 1 - Math.exp(-dt * 6)
    const booster: Body = {
      x: b.x + (WORLD.catchX - b.x) * k,
      y: b.y + (targetY - b.y) * k,
      vx: 0,
      vy: 0,
      theta: b.theta * (1 - k),
      omega: 0,
    }
    return {
      state: {
        ...prev,
        t,
        met: prev.met + dt,
        arms,
        booster,
        throttleL: approach(prev.throttleL, 0, dt * 3),
        throttleR: approach(prev.throttleR, 0, dt * 3),
        ship: stepShip(prev, dt),
      },
      events,
    }
  }
  if (prev.phase === 'Crashed' || prev.phase === 'Touchdown') {
    return {
      state: {
        ...prev,
        t,
        met: prev.met + dt,
        throttleL: 0,
        throttleR: 0,
        ship: stepShip(prev, dt),
      },
      events,
    }
  }

  const geo = prev.stacked ? STACK : BOOSTER
  const thrustScale = prev.stacked ? 1 : ENGINES.returnThrustScale
  const hasFuel = prev.fuel > 0

  // --- engines
  const spoolK = 1 - Math.exp(-dt / ENGINES.spoolTime)
  const throttleL = prev.throttleL + ((c.q && hasFuel ? 1 : 0) - prev.throttleL) * spoolK
  const throttleR = prev.throttleR + ((c.p && hasFuel ? 1 : 0) - prev.throttleR) * spoolK
  const [r1, rng1] = nextRandom(prev.rng)
  const [r2, rng2] = nextRandom(rng1)
  const jitterL = clamp(prev.jitterL * 0.996 + (r1 - 0.5) * 0.006, -ENGINES.jitter, ENGINES.jitter)
  const jitterR = clamp(prev.jitterR * 0.996 + (r2 - 0.5) * 0.006, -ENGINES.jitter, ENGINES.jitter)
  const FL = ENGINES.bankThrust * thrustScale * throttleL * (1 + jitterL)
  const FR = ENGINES.bankThrust * thrustScale * throttleR * (1 + jitterR)
  const F = FL + FR
  const fuel = Math.max(0, prev.fuel - (throttleL + throttleR) * ENGINES.bankBurn * thrustScale * dt)

  // --- actuators (QWOP-style: drive while held, slowly sag back to centre)
  const dir = (c.o ? 1 : 0) - (c.w ? 1 : 0)
  const gimbal =
    dir !== 0
      ? clamp(prev.gimbal + dir * ENGINES.gimbalRate * dt, -ENGINES.gimbalMax, ENGINES.gimbalMax)
      : approach(prev.gimbal, 0, ENGINES.gimbalReturnRate * dt)
  const fins = prev.stacked
    ? 0
    : dir !== 0
      ? clamp(prev.fins + dir * FINS.rate * dt, -1, 1)
      : approach(prev.fins, 0, FINS.rate * 0.5 * dt)

  // --- atmosphere
  const b = prev.booster
  const base0 = basePoint(prev)
  const alt = Math.max(0, base0.y)
  const rho = airDensity(alt)
  const wind = windAt(prev.seed, prev.windDir, alt, t)
  const vrx = b.vx - wind
  const vry = b.vy
  const vr = Math.hypot(vrx, vry)
  const q = 0.5 * rho * vr * vr

  const u = up(b.theta)
  const perp = { x: u.y, y: -u.x }
  const mass = boosterMass(prev)

  let fx = F * Math.cos(gimbal) * u.x - F * Math.sin(gimbal) * perp.x
  let fy = F * Math.cos(gimbal) * u.y - F * Math.sin(gimbal) * perp.y
  // clockwise torque from a force at r (relative to CoM)
  const cw = (rx: number, ry: number, Fx: number, Fy: number) => -(rx * Fy - ry * Fx)
  let tau = cw(-u.x * geo.comFromBase, -u.y * geo.comFromBase, -F * Math.sin(gimbal) * perp.x, -F * Math.sin(gimbal) * perp.y)
  tau += (FL - FR) * ENGINES.diffArm

  let sinAlpha = 0
  if (vr > 0.5) {
    const dragK = (q * geo.cdA) / vr
    fx -= vrx * dragK
    fy -= vry * dragK
    const along = vrx * u.x + vry * u.y
    const pxv = vrx - along * u.x
    const pyv = vry - along * u.y
    sinAlpha = Math.hypot(pxv, pyv) / vr
    const sideK = (q * geo.cnA) / vr
    const sfx = -pxv * sideK
    const sfy = -pyv * sideK
    fx += sfx
    fy += sfy
    tau += cw(u.x * geo.cpAboveCom, u.y * geo.cpAboveCom, sfx, sfy)
    if (!prev.stacked) tau += fins * FINS.authority * q
  }

  const inertia = (mass * geo.length * geo.length) / 12

  // --- pad hold-down
  if (prev.phase === 'Pad') {
    const liftoff = fy - mass * G > 0.02 * mass * G
    const pad: SimState = {
      ...prev,
      t,
      rng: rng2,
      throttleL,
      throttleR,
      jitterL,
      jitterR,
      gimbal,
      fins,
      fuel,
      phase: liftoff ? 'Ascent' : 'Pad',
    }
    if (liftoff) events.push({ _tag: 'Liftoff' })
    return { state: pad, events }
  }

  // --- integrate (semi-implicit Euler)
  const omega = b.omega + (tau / inertia - ANGULAR_DAMPING * b.omega) * dt
  let theta = b.theta + omega * dt
  if (theta > Math.PI) theta -= 2 * Math.PI
  else if (theta < -Math.PI) theta += 2 * Math.PI
  const vx = b.vx + (fx / mass) * dt
  const vy = b.vy + (fy / mass - G) * dt
  const booster: Body = { x: b.x + vx * dt, y: b.y + vy * dt, vx, vy, theta, omega }

  let s: SimState = {
    ...prev,
    t,
    met: prev.met + dt,
    rng: rng2,
    booster,
    throttleL,
    throttleR,
    jitterL,
    jitterR,
    gimbal,
    fins,
    fuel,
    ship: stepShip(prev, dt),
  }

  const base = basePoint(s)
  s = { ...s, maxAlt: Math.max(s.maxAlt, base.y) }

  // max-Q bookkeeping
  if (q > s.maxQ) s = { ...s, maxQ: q }
  else if (!s.maxQPassed && s.maxQ > 2500 && q < s.maxQ * 0.97) {
    s = { ...s, maxQPassed: true }
    events.push({ _tag: 'MaxQ' })
  }

  if (!s.lowFuelWarned && !s.stacked && s.fuel < BOOSTER.fuelCapacity * 0.06) {
    s = { ...s, lowFuelWarned: true }
    events.push({ _tag: 'LowFuel' })
  }

  // --- staging
  if (c.stage && s.stacked && s.phase === 'Ascent' && base.y > MISSION.minReleaseAlt) {
    const tiltDeg = Math.abs(theta) * RAD
    const release = { alt: base.y, tiltDeg, speed: Math.hypot(vx, vy), t: s.met }
    const inWindow = Math.abs(base.y - s.targetAlt) <= MISSION.releaseWindow
    const shipCom = { x: base.x + u.x * (BOOSTER.length + 25), y: base.y + u.y * (BOOSTER.length + 25) }
    const boosterCom = { x: base.x + u.x * BOOSTER.comFromBase, y: base.y + u.y * BOOSTER.comFromBase }
    s = {
      ...s,
      stacked: false,
      phase: 'Return',
      release: inWindow ? release : { ...release, alt: release.alt },
      booster: { ...booster, x: boosterCom.x, y: boosterCom.y, vx: vx - u.x * 1.2, vy: vy - u.y * 1.2 },
      ship: {
        x: shipCom.x,
        y: shipCom.y,
        vx: vx + u.x * 4,
        vy: vy + u.y * 4,
        theta,
        omega: 0,
        active: true,
        burn: 0,
      },
    }
    events.push({ _tag: 'Separation', release, inWindow })
  }

  // --- structural limits
  const limit = s.stacked ? BREAKUP.stack : BREAKUP.booster
  if (vr > 30 && q * sinAlpha > limit) {
    const outcome = makeOutcome(s, 'Crashed', 'Structural failure: too much angle of attack')
    return { state: { ...s, phase: 'Crashed', outcome }, events: [...events, { _tag: 'Crashed', outcome }] }
  }

  // --- tower collision (sample along the vehicle)
  const g2 = s.stacked ? STACK : BOOSTER
  const bp = basePoint(s)
  const uu = up(s.booster.theta)
  for (let i = 0; i <= 6; i++) {
    const d = (g2.length * i) / 6
    const px = bp.x + uu.x * d
    const py = bp.y + uu.y * d
    const armRoot = Math.abs(py - WORLD.armY) < 3 && px < WORLD.catchX - WORLD.armReach && px > WORLD.towerX
    if (inTower(px, py) || armRoot) {
      const outcome = makeOutcome(s, 'Crashed', 'Hit the tower')
      return { state: { ...s, phase: 'Crashed', outcome }, events: [...events, { _tag: 'Crashed', outcome }] }
    }
  }

  // --- catch attempt: pins cross the arm plane on the way down
  if (!s.stacked && s.phase === 'Return') {
    const pinsBefore = pinsPoint(prev)
    const pinsNow = pinsPoint(s)
    if (pinsBefore.y > WORLD.armY && pinsNow.y <= WORLD.armY && Math.abs(pinsNow.x - WORLD.catchX) < WORLD.armReach) {
      const dx = basePoint(s).x - WORLD.catchX
      const tiltDeg = Math.abs(s.booster.theta) * RAD
      const ok =
        Math.abs(dx) <= CATCH.maxDx &&
        -s.booster.vy <= CATCH.maxSinkRate &&
        Math.abs(s.booster.vx) <= CATCH.maxDrift &&
        tiltDeg <= CATCH.maxTiltDeg
      if (ok) {
        const outcome = makeOutcome(s, 'Caught', 'Caught by the tower arms')
        return {
          state: { ...s, phase: 'Caught', outcome, armsX: s.booster.x },
          events: [...events, { _tag: 'Caught', outcome }],
        }
      }
      const why =
        -s.booster.vy > CATCH.maxSinkRate
          ? 'Too fast into the arms'
          : tiltDeg > CATCH.maxTiltDeg
            ? 'Came in crooked and hit the arms'
            : Math.abs(s.booster.vx) > CATCH.maxDrift
              ? 'Sliding sideways into the arms'
              : 'Off-centre, clipped the arms'
      const outcome = makeOutcome(s, 'Crashed', why)
      return { state: { ...s, phase: 'Crashed', outcome }, events: [...events, { _tag: 'Crashed', outcome }] }
    }
  }

  // --- ground contact (lowest of base and nose)
  const top = { x: bp.x + uu.x * g2.length, y: bp.y + uu.y * g2.length }
  const lowBase = bp.y <= groundHeightAt(bp.x)
  const lowTop = top.y <= groundHeightAt(top.x)
  if (lowBase || lowTop) {
    const speed = Math.hypot(s.booster.vx, s.booster.vy)
    const tiltDeg = Math.abs(s.booster.theta) * RAD
    const soft = lowBase && !lowTop && speed <= TOUCHDOWN.maxSpeed && tiltDeg <= TOUCHDOWN.maxTiltDeg && !s.stacked
    const outcome = soft
      ? makeOutcome(s, 'Touchdown', 'Soft touchdown, but no catch')
      : makeOutcome(s, 'Crashed', speed > 60 ? 'Lithobraked' : tiltDeg > 30 ? 'Tipped over' : 'Hard landing')
    const kind = outcome.kind
    const frozen: Body = { ...s.booster, vx: 0, vy: 0, omega: 0 }
    return {
      state: { ...s, booster: frozen, phase: kind, outcome },
      events: [...events, kind === 'Touchdown' ? { _tag: 'Touchdown', outcome } : { _tag: 'Crashed', outcome }],
    }
  }

  return { state: s, events }
}

export const telemetry = (s: SimState): Telemetry => {
  const b = basePoint(s)
  const v = s.booster
  return {
    phase: s.phase,
    met: s.met,
    altitude: Math.max(0, b.y),
    speed: Math.hypot(v.vx, v.vy),
    vSpeed: v.vy,
    hSpeed: v.vx,
    tiltDeg: v.theta * RAD,
    fuelPct: (s.fuel / BOOSTER.fuelCapacity) * 100,
    throttleL: s.throttleL,
    throttleR: s.throttleR,
    gimbal: s.gimbal / ENGINES.gimbalMax,
    fins: s.fins,
    targetAlt: s.targetAlt,
    towerDx: b.x - WORLD.catchX,
    stacked: s.stacked,
    maxAlt: s.maxAlt,
    q: 0.5 * airDensity(b.y) * (v.vx * v.vx + v.vy * v.vy),
  }
}

export { DT }
