import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Message } from './main'
import type { Telemetry } from './domain'

/*
 * Descent guidance: a side-profile map (altitude over distance from the tower) on log scales, so the
 * last hundred metres open up as the booster closes in. Shows the engines-off coast prediction, where it
 * crosses catch height, a velocity arrow, the approach funnel and an on-track cue.
 */

const W = 220
const H = 128
const GROUND = 116
const TOP = 10
const ALT_K = 60
const ALT_MAX = 5200
const DX_K = 25
const DX_MAX = 3500
/** sim constants mirrored here so the app bundle doesn't pull the sim in */
const TOWER_DX = -27
const TOWER_H = 146
const ARM_Y = 92
const CATCH_BASE_Y = 30

const fy = (alt: number) => Math.min(1, Math.log1p(Math.max(0, alt) / ALT_K) / Math.log1p(ALT_MAX / ALT_K))
const fx = (dx: number) => Math.sign(dx) * Math.min(1, Math.log1p(Math.abs(dx) / DX_K) / Math.log1p(DX_MAX / DX_K))
const X = (dx: number) => W / 2 + fx(dx) * (W / 2 - 8)
const Y = (alt: number) => GROUND - fy(alt) * (GROUND - TOP)
const pt = (dx: number, alt: number) => `${X(dx).toFixed(1)},${Y(alt).toFixed(1)}`
const fmtDist = (m: number) => (Math.abs(m) < 1000 ? `${Math.abs(m).toFixed(0)} m` : `${(Math.abs(m) / 1000).toFixed(2)} km`)
const signed = (m: number) => `${m >= 0 ? '+' : '−'}${fmtDist(m)}`

export type GuideStatus = 'green' | 'amber' | 'red'

export const guideStatus = (t: Telemetry): { status: GuideStatus; label: string; burn: string } => {
  const g = t.guide
  if (!g) return { status: 'green', label: '', burn: '' }
  const sink = Math.max(0, -t.vSpeed)
  const above = t.altitude - CATCH_BASE_Y
  const tol = Math.max(6, Math.min(60, t.altitude * 0.04))
  const lat = Math.abs(g.impactDx)
  const late = sink > 15 && above < g.stopAlt * 0.95
  const tight = sink > 15 && above < g.stopAlt * 1.2
  const burnIn = sink > 1 ? (above - g.stopAlt * 1.2) / sink : Infinity
  const firing = Math.max(t.throttleL, t.throttleR) > 0.3
  const burn = sink < 1 ? '—' : late ? 'LATE' : firing && tight ? 'ON' : tight ? 'NOW' : burnIn > 99 ? '—' : `${burnIn.toFixed(1)} s`
  if (late) return { status: 'red', label: firing ? 'TOO FAST' : 'BURN NOW', burn }
  if (lat > tol * 5) return { status: 'red', label: 'OFF TRACK', burn }
  if (lat > tol || tight) return { status: 'amber', label: tight && lat <= tol && !firing ? 'BURN' : 'CORRECT', burn }
  return { status: 'green', label: 'ON TRACK', burn }
}

const funnel = () => {
  const alts = [0, 40, 120, 300, 700, 1500, 3000, ALT_MAX]
  const half = (a: number) => 6 + a * 0.22
  const left = alts.map(a => pt(-half(a), a))
  const right = [...alts].reverse().map(a => pt(half(a), a))
  return [...left, ...right].join(' ')
}
const FUNNEL = funnel()

const polyline = (flat: ReadonlyArray<number>) => {
  const out: string[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(pt(flat[i]!, flat[i + 1]!))
  return out.join(' ')
}

const attr = (h: HtmlBuilder<Message>, k: string, v: string | number) => h.Attribute(k, typeof v === 'number' ? v.toFixed(1) : v)

export const guideView = (h: HtmlBuilder<Message>, t: Telemetry, compact: boolean): Html => {
  const g = t.guide!
  const { status, label, burn } = guideStatus(t)
  const bx = X(t.towerDx)
  const by = Y(t.altitude)
  // velocity arrow: direction in map space of where the booster will be in 2 s
  const ax = X(t.towerDx + t.hSpeed * 2) - bx
  const ay = Y(t.altitude + t.vSpeed * 2) - by
  const al = Math.hypot(ax, ay)
  const k = al > 0.01 ? Math.min(18, 6 + al) / al : 0
  const ix = X(g.impactDx)
  const iy = Y(CATCH_BASE_Y)
  const grid = [100, 1000].map(a =>
    h.g([], [
      h.line([attr(h, 'x1', 6), attr(h, 'x2', W - 6), attr(h, 'y1', Y(a)), attr(h, 'y2', Y(a)), attr(h, 'class', 'gd-grid')]),
      h.text([attr(h, 'x', 4), attr(h, 'y', Y(a) - 2), attr(h, 'class', 'gd-tick')], [a >= 1000 ? `${a / 1000}k` : String(a)]),
    ]),
  )
  const ticks = [-1000, -100, 100, 1000].map(d =>
    h.line([attr(h, 'x1', X(d)), attr(h, 'x2', X(d)), attr(h, 'y1', GROUND), attr(h, 'y2', GROUND + 4), attr(h, 'class', 'gd-grid')]),
  )
  return h.div(
    [h.Class(`guide is-${status} ${t.vSpeed < 0 ? 'is-descent' : 'is-boostback'}`)],
    [
      h.div(
        [h.Class('guide-head')],
        [h.span([h.Class('guide-title')], [compact ? 'GUIDANCE' : 'DESCENT GUIDANCE']), h.span([h.Class('guide-status')], [label])],
      ),
      h.svg(
        [attr(h, 'viewBox', `0 0 ${W} ${H}`), h.Class('guide-svg')],
        [
          ...grid,
          h.polygon([attr(h, 'points', FUNNEL), attr(h, 'class', 'gd-funnel')]),
          h.line([attr(h, 'x1', 2), attr(h, 'x2', W - 2), attr(h, 'y1', GROUND), attr(h, 'y2', GROUND), attr(h, 'class', 'gd-ground')]),
          ...ticks,
          // tower and arms
          h.line([attr(h, 'x1', X(TOWER_DX)), attr(h, 'x2', X(TOWER_DX)), attr(h, 'y1', GROUND), attr(h, 'y2', Y(TOWER_H)), attr(h, 'class', 'gd-tower')]),
          h.line([attr(h, 'x1', X(TOWER_DX)), attr(h, 'x2', X(6)), attr(h, 'y1', Y(ARM_Y)), attr(h, 'y2', Y(ARM_Y)), attr(h, 'class', 'gd-arms')]),
          h.rect([attr(h, 'x', X(-5)), attr(h, 'y', Y(ARM_Y) - 3), attr(h, 'width', X(5) - X(-5)), attr(h, 'height', 6), attr(h, 'class', 'gd-zone')]),
          h.polyline([attr(h, 'points', polyline(g.track)), attr(h, 'class', 'gd-track')]),
          h.polyline([attr(h, 'points', polyline(g.path)), attr(h, 'class', 'gd-path')]),
          h.path([attr(h, 'd', `M${(ix - 4).toFixed(1)},${(iy - 4).toFixed(1)}l8,8m0,-8l-8,8`), attr(h, 'class', 'gd-impact')]),
          h.line([attr(h, 'x1', bx), attr(h, 'y1', by), attr(h, 'x2', bx + ax * k), attr(h, 'y2', by + ay * k), attr(h, 'class', 'gd-vel')]),
          h.circle([attr(h, 'cx', bx), attr(h, 'cy', by), attr(h, 'r', 3.4), attr(h, 'class', 'gd-booster')]),
        ],
      ),
      h.div(
        [h.Class('guide-reads')],
        [
          read(h, 'DIST', fmtDist(t.towerDx)),
          read(h, 'V/S', `${t.vSpeed >= 0 ? '+' : '−'}${Math.abs(t.vSpeed).toFixed(0)} m/s`),
          read(h, 'IMPACT', signed(g.impactDx), Math.abs(g.impactDx) < Math.max(6, Math.min(60, t.altitude * 0.04)) ? 'ok' : 'warn'),
          read(h, 'BURN', burn, burn === 'LATE' ? 'bad' : burn === 'NOW' ? 'warn' : ''),
        ],
      ),
    ],
  )
}

const read = (h: HtmlBuilder<Message>, label: string, value: string, cls = '') =>
  h.div([h.Class(`gread ${cls}`)], [h.span([h.Class('gread-label')], [label]), h.strong([h.Class('gread-value')], [value])])
