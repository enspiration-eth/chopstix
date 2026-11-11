export interface Body {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  /** radians, clockwise from vertical: positive leans the nose toward +x */
  readonly theta: number
  readonly omega: number
}

export type Phase = 'Pad' | 'Ascent' | 'Return' | 'Caught' | 'Touchdown' | 'Crashed'

export interface Controls {
  /** left engine bank */
  readonly q: boolean
  /** gimbal / fins: swing nose left */
  readonly w: boolean
  /** gimbal / fins: swing nose right */
  readonly o: boolean
  /** right engine bank */
  readonly p: boolean
  /** stage: release the payload stack (edge-triggered by the caller) */
  readonly stage: boolean
}

export const NO_CONTROLS: Controls = { q: false, w: false, o: false, p: false, stage: false }

export interface Release {
  readonly alt: number
  readonly tiltDeg: number
  readonly speed: number
  readonly t: number
}

export type OutcomeKind = 'Caught' | 'Touchdown' | 'Crashed'

export interface Outcome {
  readonly kind: OutcomeKind
  readonly reason: string
  readonly dx: number
  readonly vx: number
  readonly vy: number
  readonly tiltDeg: number
  readonly t: number
}

export interface Ship extends Body {
  readonly active: boolean
  readonly burn: number
}

export interface SimState {
  readonly seed: number
  readonly rng: number
  readonly t: number
  /** mission elapsed time since liftoff (negative before) */
  readonly met: number
  readonly phase: Phase
  readonly booster: Body
  readonly stacked: boolean
  readonly fuel: number
  readonly throttleL: number
  readonly throttleR: number
  readonly jitterL: number
  readonly jitterR: number
  readonly gimbal: number
  readonly fins: number
  readonly ship: Ship
  readonly targetAlt: number
  readonly windDir: number
  readonly maxAlt: number
  readonly maxQ: number
  readonly maxQPassed: boolean
  readonly lowFuelWarned: boolean
  readonly release: Release | null
  readonly outcome: Outcome | null
  /** 0 open … 1 closed around the booster */
  readonly arms: number
  readonly armsX: number
}

export type SimEvent =
  | { readonly _tag: 'Liftoff' }
  | { readonly _tag: 'MaxQ' }
  | { readonly _tag: 'Separation'; readonly release: Release; readonly inWindow: boolean }
  | { readonly _tag: 'Caught'; readonly outcome: Outcome }
  | { readonly _tag: 'Touchdown'; readonly outcome: Outcome }
  | { readonly _tag: 'Crashed'; readonly outcome: Outcome }
  | { readonly _tag: 'LowFuel' }

export interface Telemetry {
  readonly phase: Phase
  readonly met: number
  readonly altitude: number
  readonly speed: number
  readonly vSpeed: number
  readonly hSpeed: number
  readonly tiltDeg: number
  readonly fuelPct: number
  readonly throttleL: number
  readonly throttleR: number
  readonly gimbal: number
  readonly fins: number
  readonly targetAlt: number
  readonly towerDx: number
  readonly stacked: boolean
  readonly maxAlt: number
  readonly q: number
}
