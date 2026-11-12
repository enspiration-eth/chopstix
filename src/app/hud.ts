import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Model, Message } from './main'
import { formatMet } from './main'
import type { Telemetry } from './domain'
import { guideView } from './guide'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** 33-engine map (centre 3, inner 10, outer 20) — mirrors the renderer's layout. */
const ENGINES: Array<readonly [number, number, number]> = (() => {
  const out: Array<readonly [number, number, number]> = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2
    out.push([Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0])
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    out.push([Math.cos(a) * 2.45, Math.sin(a) * 2.45, 1])
  }
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.157
    out.push([Math.cos(a) * 3.75, Math.sin(a) * 3.75, 2])
  }
  return out
})()

const gauge = (h: HtmlBuilder<Message>, label: string, value: string, unit: string, frac: number, accent = false) => {
  const r = 40
  const c = 2 * Math.PI * r
  const arc = c * 0.75
  return h.div(
    [h.Class('gauge')],
    [
      h.svg(
        [h.Attribute('viewBox', '0 0 100 100'), h.Class('gauge-svg')],
        [
          h.circle([
            h.Attribute('cx', '50'),
            h.Attribute('cy', '50'),
            h.Attribute('r', String(r)),
            h.Attribute('class', 'gauge-track'),
            h.Attribute('stroke-dasharray', `${arc} ${c}`),
            h.Attribute('transform', 'rotate(135 50 50)'),
          ]),
          h.circle([
            h.Attribute('cx', '50'),
            h.Attribute('cy', '50'),
            h.Attribute('r', String(r)),
            h.Attribute('class', accent ? 'gauge-fill gauge-accent' : 'gauge-fill'),
            h.Attribute('stroke-dasharray', `${arc * clamp01(frac)} ${c}`),
            h.Attribute('transform', 'rotate(135 50 50)'),
          ]),
        ],
      ),
      h.div(
        [h.Class('gauge-read')],
        [h.span([h.Class('gauge-label')], [label]), h.strong([h.Class('gauge-value')], [value]), h.span([h.Class('gauge-unit')], [unit])],
      ),
    ],
  )
}

const engineMap = (h: HtmlBuilder<Message>, t: Telemetry) =>
  h.svg(
    [h.Attribute('viewBox', '-4.6 -4.6 9.2 9.2'), h.Class('engine-map')],
    ENGINES.map(([x, z, ring]) => {
      const lit = (ring < 2 || t.stacked) && (x < 0 ? t.throttleL : t.throttleR) > 0.35
      return h.circle([
        h.Attribute('cx', x.toFixed(2)),
        h.Attribute('cy', z.toFixed(2)),
        h.Attribute('r', '0.52'),
        h.Attribute('class', lit ? 'eng eng-on' : ring === 2 && !t.stacked ? 'eng eng-off-dim' : 'eng'),
      ])
    }),
  )

const tiltIndicator = (h: HtmlBuilder<Message>, t: Telemetry) => {
  const bad = Math.abs(t.tiltDeg) > (t.stacked ? 15 : 8)
  return h.div(
    [h.Class(`tilt ${bad ? 'is-bad' : ''}`)],
    [
      h.div([h.Class('tilt-wedge')], []),
      h.div([h.Class('tilt-ship'), h.Style({ transform: `rotate(${t.tiltDeg.toFixed(1)}deg)` })], [h.div([h.Class('tilt-body')], [])]),
      h.div(
        [h.Class('tilt-gimbal')],
        [h.div([h.Class('tilt-gimbal-dot'), h.Style({ left: `${50 + 45 * (t.stacked ? t.gimbal : t.fins)}%` })], [])],
      ),
      h.span([h.Class('tilt-read')], [`${t.tiltDeg >= 0 ? '+' : ''}${t.tiltDeg.toFixed(1)}°`]),
    ],
  )
}

const readout = (h: HtmlBuilder<Message>, label: string, value: string, cls = '') =>
  h.div([h.Class(`readout ${cls}`)], [h.span([h.Class('readout-label')], [label]), h.strong([h.Class('readout-value')], [value])])

const altLadder = (h: HtmlBuilder<Message>, t: Telemetry) => {
  const top = t.targetAlt * 1.6
  const pos = clamp01(t.altitude / top)
  const tgt = t.targetAlt / top
  const win = 500 / top
  return h.div(
    [h.Class('ladder')],
    [
      h.div([h.Class('ladder-window'), h.Style({ bottom: `${(tgt - win) * 100}%`, height: `${win * 200}%` })], []),
      h.div([h.Class('ladder-target'), h.Style({ bottom: `${tgt * 100}%` })], [h.span([], [`${(t.targetAlt / 1000).toFixed(2)} km`])]),
      h.div([h.Class('ladder-max'), h.Style({ bottom: `${clamp01(t.maxAlt / top) * 100}%` })], []),
      h.div([h.Class('ladder-pos'), h.Style({ bottom: `${pos * 100}%` })], []),
    ],
  )
}

const milestone = (h: HtmlBuilder<Message>, label: string, done: boolean, active: boolean) =>
  h.div([h.Class(`ms ${done ? 'ms-done' : ''} ${active ? 'ms-active' : ''}`)], [h.span([h.Class('ms-dot')], []), h.span([h.Class('ms-label')], [label])])

const timeline = (h: HtmlBuilder<Message>, t: Telemetry) => {
  const lifted = t.phase !== 'Pad'
  const sep = !t.stacked
  const descending = sep && t.vSpeed < 0
  const final = sep && t.catchH < 400 && t.vSpeed < 0
  const caught = t.phase === 'Caught'
  return h.div(
    [h.Class('timeline')],
    [
      h.div([h.Class('timeline-clock')], [h.span([], ['T+']), h.strong([], [formatMet(t.met)])]),
      h.div(
        [h.Class('timeline-track')],
        [
          milestone(h, 'LIFTOFF', lifted, !lifted),
          milestone(h, 'TARGET ALT', sep || t.altitude > t.targetAlt - 500, lifted && !sep),
          milestone(h, 'STAGE SEP', sep, false),
          milestone(h, 'RETURN', descending, sep && !descending),
          milestone(h, 'FINAL', final, descending && !final),
          milestone(h, 'CATCH', caught, final && !caught),
        ],
      ),
    ],
  )
}

export const hudView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const t = model.telemetry
  const kmh = t.speed * 3.6
  const fuelLow = !t.stacked && t.fuelPct < 12
  return h.div(
    [h.Class('hud')],
    [
      h.div(
        [h.Class('hud-top')],
        [
          h.div([h.Class('hud-mission')], [h.span([h.Class('live-dot')], []), h.span([h.Class('hud-mission-label')], [`FLIGHT ${String(model.attempts).padStart(3, '0')}`])]),
          h.div([h.Class('hud-phase')], [phaseLabel(t)]),
          ...(t.warp > 1.2 ? [h.div([h.Class('hud-warp')], [`▶▶ ${t.warp.toFixed(1)}×`])] : []),
        ],
      ),
      h.div(
        [h.Class('callouts')],
        model.callouts.map(c => h.div([h.Class(`callout callout-${c.tone}`), h.Key(String(c.id))], [c.text])),
      ),
      ...(t.stacked && t.phase !== 'Pad'
        ? [
            h.div(
              [h.Class(`prompt ${t.inWindow ? 'prompt-hot' : ''}`)],
              [
                t.inWindow
                  ? `RELEASE WINDOW · ${model.touch ? 'TAP STAGE' : 'PRESS SPACE'} · Δ ${Math.round(t.altitude - t.targetAlt) >= 0 ? '+' : ''}${Math.round(t.altitude - t.targetAlt)} m`
                  : `TARGET ${(t.targetAlt / 1000).toFixed(2)} km · ${t.altitude < t.targetAlt ? Math.round(t.targetAlt - t.altitude) + ' m TO GO' : 'ABOVE WINDOW'}`,
              ],
            ),
          ]
        : []),
      ...(t.phase === 'Pad'
        ? [h.div([h.Class('prompt prompt-hot')], [model.touch ? 'HOLD Q + P TO LIGHT BOTH BANKS' : 'HOLD  Q + P  TO LIGHT BOTH BANKS'])]
        : []),
      ...(t.guide && !t.stacked && t.phase === 'Return'
        ? [
            h.div(
              [h.Class(`guide-col ${t.catchH < 900 ? 'has-catch' : ''}`)],
              [
                guideView(h, t, model.touch),
                ...(t.catchH < 900
                  ? [
                      h.div(
                        [h.Class('catch-box')],
                        [
                          readout(h, 'TOWER Δ', `${t.towerDx >= 0 ? '+' : ''}${t.towerDx.toFixed(1)} m`, Math.abs(t.towerDx) < 5 ? 'ok' : 'warn'),
                          readout(h, 'SINK', `${(-t.vSpeed).toFixed(1)} m/s`, -t.vSpeed < 8 ? 'ok' : 'warn'),
                          readout(h, 'DRIFT', `${t.hSpeed.toFixed(1)} m/s`, Math.abs(t.hSpeed) < 4 ? 'ok' : 'warn'),
                          readout(h, 'ARMS', `${Math.max(0, t.catchH).toFixed(0)} m`, ''),
                        ],
                      ),
                    ]
                  : []),
              ],
            ),
          ]
        : []),
      h.div(
        [h.Class('hud-bottom')],
        [
          h.div(
            [h.Class('panel panel-left')],
            [
              h.div([h.Class('panel-title')], ['BOOSTER']),
              h.div(
                [h.Class('gauges')],
                [
                  gauge(h, 'SPEED', Math.round(kmh).toLocaleString('en-US'), 'KM/H', kmh / 1400),
                  gauge(h, 'ALTITUDE', (t.altitude / 1000).toFixed(t.altitude < 10000 ? 2 : 1), 'KM', t.altitude / (t.targetAlt * 1.6)),
                ],
              ),
              h.div(
                [h.Class('panel-row')],
                [
                  engineMap(h, t),
                  h.div(
                    [h.Class('fuel')],
                    [
                      h.span([h.Class('readout-label')], ['LOX/CH4']),
                      h.div([h.Class(`fuel-bar ${fuelLow ? 'is-low' : ''}`)], [h.div([h.Class('fuel-fill'), h.Style({ width: `${clamp01(t.fuelPct / 100) * 100}%` })], [])]),
                      h.strong([h.Class('readout-value')], [`${t.fuelPct.toFixed(0)}%`]),
                    ],
                  ),
                  tiltIndicator(h, t),
                ],
              ),
            ],
          ),
          timeline(h, t),
          h.div(
            [h.Class('panel panel-right')],
            [
              h.div([h.Class('panel-title')], [t.stacked ? 'STACK' : 'RETURN']),
              h.div(
                [h.Class('panel-row')],
                [
                  altLadder(h, t),
                  h.div(
                    [h.Class('readouts')],
                    [
                      readout(h, 'V/S', `${t.vSpeed >= 0 ? '+' : ''}${t.vSpeed.toFixed(0)} m/s`),
                      readout(h, 'H/S', `${t.hSpeed >= 0 ? '+' : ''}${t.hSpeed.toFixed(0)} m/s`),
                      readout(h, 'Q', `${(t.q / 1000).toFixed(1)} kPa`),
                      readout(h, 'TOWER', `${Math.abs(t.towerDx) < 1000 ? t.towerDx.toFixed(0) + ' m' : (t.towerDx / 1000).toFixed(1) + ' km'}`),
                    ],
                  ),
                ],
              ),
              h.div([h.Class('quality')], [`${t.quality} · ${Math.round(t.fps)} FPS`]),
            ],
          ),
        ],
      ),
    ],
  )
}

const phaseLabel = (t: Telemetry) => {
  switch (t.phase) {
    case 'Pad':
      return 'ON THE MOUNT'
    case 'Ascent':
      return 'ASCENT'
    case 'Return':
      return t.vSpeed > 0 ? 'COAST' : t.catchH < 400 ? 'FINAL APPROACH' : t.throttleL + t.throttleR > 0.6 ? 'BURN' : 'DESCENT'
    case 'Caught':
      return 'CAUGHT'
    case 'Touchdown':
      return 'TOUCHDOWN'
    case 'Crashed':
      return 'SIGNAL LOST'
  }
}

const pad = (h: HtmlBuilder<Message>, control: string, key: string, label: string, cls: string) =>
  h.div(
    [h.Class(`pad ${cls}`), h.DataAttribute('control', control)],
    [h.span([h.Class('pad-key')], [key]), h.span([h.Class('pad-label')], [label])],
  )

export const touchPadsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('pads')],
    [
      // swapped: keys stay where they are on the keyboard, their labels tell the truth about what they do
      pad(h, 'w', 'W', model.settings.swapNose ? 'NOSE ▶' : 'NOSE ◀', 'pad-w'),
      pad(h, 'q', 'Q', 'LEFT BANK', 'pad-q'),
      pad(h, 'o', 'O', model.settings.swapNose ? 'NOSE ◀' : 'NOSE ▶', 'pad-o'),
      pad(h, 'p', 'P', 'RIGHT BANK', 'pad-p'),
      ...(model.telemetry.stacked && model.telemetry.phase !== 'Pad'
        ? [pad(h, 'stage', model.touch ? '⇪' : 'SPACE', 'STAGE', `pad-stage ${model.telemetry.inWindow ? 'is-ready' : ''}`)]
        : []),
    ],
  )
