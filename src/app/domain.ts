import { Schema } from 'effect'

export const Screen = Schema.Literals(['Booting', 'Title', 'HowTo', 'Playing', 'Paused', 'Result'])
export type Screen = typeof Screen.Type

export const Phase = Schema.Literals(['Pad', 'Ascent', 'Return', 'Caught', 'Touchdown', 'Crashed'])

export const Telemetry = Schema.Struct({
  phase: Phase,
  met: Schema.Number,
  altitude: Schema.Number,
  speed: Schema.Number,
  vSpeed: Schema.Number,
  hSpeed: Schema.Number,
  tiltDeg: Schema.Number,
  fuelPct: Schema.Number,
  throttleL: Schema.Number,
  throttleR: Schema.Number,
  gimbal: Schema.Number,
  fins: Schema.Number,
  targetAlt: Schema.Number,
  towerDx: Schema.Number,
  stacked: Schema.Boolean,
  maxAlt: Schema.Number,
  q: Schema.Number,
  warp: Schema.Number,
  quality: Schema.String,
  fps: Schema.Number,
  inWindow: Schema.Boolean,
  catchH: Schema.Number,
})
export type Telemetry = typeof Telemetry.Type

export const emptyTelemetry: Telemetry = {
  phase: 'Pad',
  met: 0,
  altitude: 0,
  speed: 0,
  vSpeed: 0,
  hSpeed: 0,
  tiltDeg: 0,
  fuelPct: 100,
  throttleL: 0,
  throttleR: 0,
  gimbal: 0,
  fins: 0,
  targetAlt: 4000,
  towerDx: 0,
  stacked: true,
  maxAlt: 0,
  q: 0,
  warp: 1,
  quality: 'HIGH',
  fps: 60,
  inWindow: false,
  catchH: 0,
}

export const Tone = Schema.Literals(['info', 'good', 'bad'])
export type Tone = typeof Tone.Type

export const Callout = Schema.Struct({ id: Schema.Number, text: Schema.String, tone: Tone })
export type Callout = typeof Callout.Type

export const OutcomeKind = Schema.Literals(['Caught', 'Touchdown', 'Crashed'])

export const Result = Schema.Struct({
  kind: OutcomeKind,
  reason: Schema.String,
  total: Schema.Number,
  altitudePts: Schema.Number,
  releasePts: Schema.Number,
  landingPts: Schema.Number,
  fuelPts: Schema.Number,
  targetAlt: Schema.Number,
  releaseAlt: Schema.NullOr(Schema.Number),
  releaseTilt: Schema.NullOr(Schema.Number),
  maxAlt: Schema.Number,
  met: Schema.Number,
  sinkRate: Schema.Number,
  dx: Schema.Number,
  tiltDeg: Schema.Number,
  isBest: Schema.Boolean,
})
export type Result = typeof Result.Type
