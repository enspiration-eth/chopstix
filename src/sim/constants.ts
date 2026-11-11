/** All tunables for the flight model. Units: metres, seconds, tonnes, kN (so kN / t = m/s²). */
export const DT = 1 / 120
export const G = 9.81

/** Game-scaled atmosphere: thinner, faster falloff than Earth so "space" is ~10 km away. */
export const ATM = {
  rho0: 1.0,
  scaleHeight: 2600,
} as const

export const STACK = {
  length: 121,
  radius: 4.5,
  comFromBase: 46,
  /** centre of pressure above the CoM: positive = aerodynamically unstable going nose-first */
  cpAboveCom: 24,
  cdA: 0.32,
  cnA: 2.2,
  shipMass: 600,
} as const

export const BOOSTER = {
  length: 71,
  radius: 4.5,
  comFromBase: 28,
  /** grid fins at the top put CoP above CoM: stable when falling tail-first */
  cpAboveCom: 8,
  cdA: 0.4,
  cnA: 1.6,
  dryMass: 180,
  fuelCapacity: 900,
} as const

export const ENGINES = {
  /** per-bank max thrust (left/right half of the 33-engine cluster) during ascent */
  bankThrust: 13300,
  /** fraction of thrust available after staging (13-engine relight) */
  returnThrustScale: 0.3,
  /** tonnes of propellant per second per bank at full throttle */
  bankBurn: 10,
  spoolTime: 0.32,
  gimbalMax: 0.12,
  gimbalRate: 0.55,
  gimbalReturnRate: 0.22,
  /** effective lever arm for differential bank thrust */
  diffArm: 6,
  /** slow random thrust imbalance amplitude (fraction) */
  jitter: 0.07,
} as const

export const FINS = {
  authority: 3.0,
  rate: 2.2,
} as const

export const ANGULAR_DAMPING = 0.12

export const WORLD = {
  towerX: -27,
  towerHalfWidth: 6,
  towerHeight: 146,
  armY: 92,
  /** pins sit this far above the booster base */
  pinsAboveBase: 62,
  catchX: 0,
  armReach: 14,
  mountHalfWidth: 10,
  mountHeight: 20,
} as const

export const MISSION = {
  targetMin: 3200,
  targetMax: 4800,
  releaseWindow: 500,
  minReleaseAlt: 600,
} as const

export const CATCH = {
  maxDx: 5,
  maxSinkRate: 8,
  maxDrift: 4,
  maxTiltDeg: 8,
} as const

export const TOUCHDOWN = {
  maxSpeed: 4.5,
  maxTiltDeg: 8,
} as const

export const BREAKUP = {
  stack: 6500,
  booster: 9000,
} as const
