import { Duration, Effect, Option, Queue, Schema, Stream } from 'effect'
import { Command, Mount, Runtime, Subscription, type Update } from 'foldkit'
import * as Dom from 'foldkit/dom'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Callout, Result, Screen, Telemetry, Tone, emptyTelemetry } from './domain'
import { getGame, setGame } from './gameHost'
import { hudView, touchPadsView } from './hud'

export const GAME_NAME = 'CHOPSTIX'
const BEST_KEY = 'chopstix.best.v1'

// MODEL

export const Model = Schema.Struct({
  screen: Screen,
  maybeError: Schema.Option(Schema.String),
  telemetry: Telemetry,
  callouts: Schema.Array(Callout),
  calloutSeq: Schema.Number,
  maybeResult: Schema.Option(Result),
  best: Schema.Number,
  muted: Schema.Boolean,
  touch: Schema.Boolean,
  attempts: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededMountGame: {},
  FailedMountGame: { reason: Schema.String },
  GotTelemetry: { telemetry: Telemetry },
  GotCallout: { text: Schema.String, tone: Tone },
  ExpiredCallout: { id: Schema.Number },
  EndedMission: { result: Result },
  ClickedLaunch: {},
  ClickedHowTo: {},
  ClickedBackToTitle: {},
  ClickedRetry: {},
  ClickedPause: {},
  ClickedResume: {},
  ClickedMute: {},
  PressedKey: { key: Schema.String },
  LoadedBest: { best: Schema.Number },
  CompletedGameCommand: {},
})
export type Message = typeof Message.Type

// COMMAND

const withGame = (f: (g: NonNullable<ReturnType<typeof getGame> extends Option.Option<infer G> ? G : never>) => void) =>
  Effect.sync(() => {
    Option.map(getGame(), f)
    return Message.CompletedGameCommand()
  })

export const StartMission = Command.define('StartMission', {
  args: { seed: Schema.Number },
  messages: [Message.CompletedGameCommand],
  execute: ({ seed }) => withGame(g => g.startMission(seed)),
})

export const ReturnToAttract = Command.define('ReturnToAttract', {
  messages: [Message.CompletedGameCommand],
  execute: withGame(g => g.startAttract()),
})

export const SetPaused = Command.define('SetPaused', {
  args: { paused: Schema.Boolean },
  messages: [Message.CompletedGameCommand],
  execute: ({ paused }) => withGame(g => g.setPaused(paused)),
})

export const SetMuted = Command.define('SetMuted', {
  args: { muted: Schema.Boolean },
  messages: [Message.CompletedGameCommand],
  execute: ({ muted }) =>
    Effect.sync(() => {
      try {
        localStorage.setItem('chopstix.muted', muted ? '1' : '0')
      } catch {
        /* private mode */
      }
      Option.map(getGame(), g => g.setMuted(muted))
      return Message.CompletedGameCommand()
    }),
})

export const LoadBest = Command.define('LoadBest', {
  messages: [Message.LoadedBest],
  execute: Effect.try({
    try: () => Number(localStorage.getItem(BEST_KEY) ?? 0) || 0,
    catch: () => 0,
  }).pipe(
    Effect.orElseSucceed(() => 0),
    Effect.map(best => Message.LoadedBest({ best })),
  ),
})

export const SaveBest = Command.define('SaveBest', {
  args: { best: Schema.Number },
  messages: [Message.CompletedGameCommand],
  execute: ({ best }) =>
    Effect.sync(() => {
      try {
        localStorage.setItem(BEST_KEY, String(best))
      } catch {
        /* private mode */
      }
      return Message.CompletedGameCommand()
    }),
})

export const ExpireCallout = Command.define('ExpireCallout', {
  args: { id: Schema.Number },
  messages: [Message.ExpiredCallout],
  execute: ({ id }) => Effect.sleep(Duration.millis(2600)).pipe(Effect.as(Message.ExpiredCallout({ id }))),
})

// MOUNT: the three.js game is a scoped resource bound to its host element

type GameMessage =
  | typeof Message.SucceededMountGame.Type
  | typeof Message.FailedMountGame.Type
  | typeof Message.GotTelemetry.Type
  | typeof Message.GotCallout.Type
  | typeof Message.EndedMission.Type

const mountGame = (element: Element) =>
  Stream.callback<GameMessage>(queue =>
    Effect.gen(function* () {
      if (!(element instanceof HTMLElement)) {
        Queue.offerUnsafe(queue, Message.FailedMountGame({ reason: 'Game host is not an HTMLElement' }))
        return yield* Effect.never
      }
      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const { Game } = await import('../engine/game')
            const game = new Game(element, {
              onTelemetry: t => Queue.offerUnsafe(queue, Message.GotTelemetry({ telemetry: t })),
              onCallout: (text, tone) => Queue.offerUnsafe(queue, Message.GotCallout({ text, tone })),
              onMissionEnd: r =>
                Queue.offerUnsafe(
                  queue,
                  Message.EndedMission({
                    result: {
                      kind: r.outcome.kind,
                      reason: r.outcome.reason,
                      total: r.score.total,
                      altitudePts: r.score.altitude,
                      releasePts: r.score.release,
                      landingPts: r.score.landing,
                      fuelPts: r.score.fuel,
                      targetAlt: r.targetAlt,
                      releaseAlt: r.releaseAlt,
                      releaseTilt: r.releaseTilt,
                      maxAlt: r.maxAlt,
                      met: r.met,
                      sinkRate: -r.outcome.vy,
                      dx: r.outcome.dx,
                      tiltDeg: r.outcome.tiltDeg,
                      isBest: false,
                    },
                  }),
                ),
            })
            try {
              game.setMuted(localStorage.getItem('chopstix.muted') === '1')
            } catch {
              /* ignore */
            }
            setGame(game)
            return game
          },
          catch: e => (e instanceof Error ? e : new Error(String(e))),
        }),
        game =>
          Effect.sync(() => {
            setGame(null)
            game.dispose()
          }),
      )
      Queue.offerUnsafe(queue, Message.SucceededMountGame())
      return yield* Effect.never
    }).pipe(
      Effect.catch(error =>
        Effect.sync(() =>
          Queue.offerUnsafe(
            queue,
            Message.FailedMountGame({ reason: error instanceof Error ? error.message : String(error) }),
          ),
        ),
      ),
    ),
  )

export const MountGame = Mount.defineStream('MountGame', {
  messages: [
    Message.SucceededMountGame,
    Message.FailedMountGame,
    Message.GotTelemetry,
    Message.GotCallout,
    Message.EndedMission,
  ],
  execute: ({ element }) => mountGame(element),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const launch = (model: Model): UpdateReturn => ({
  model: modifyFields(model, {
    screen: () => 'Playing' as const,
    maybeResult: () => Option.none(),
    callouts: () => [],
    telemetry: () => emptyTelemetry,
    attempts: n => n + 1,
  }),
  commands: [StartMission({ seed: Math.floor(Math.random() * 1_000_000) })],
})

const toTitle = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { screen: () => 'Title' as const, callouts: () => [] }),
  commands: [ReturnToAttract()],
})

const pause = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { screen: () => 'Paused' as const }),
  commands: [SetPaused({ paused: true })],
})

const resume = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { screen: () => 'Playing' as const }),
  commands: [SetPaused({ paused: false })],
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededMountGame: () => ({
      model: modifyFields(model, { screen: s => (s === 'Booting' ? ('Title' as const) : s) }),
    }),
    FailedMountGame: ({ reason }) => ({
      model: modifyFields(model, { maybeError: () => Option.some(reason) }),
    }),
    GotTelemetry: ({ telemetry }) => ({
      model: modifyFields(model, { telemetry: () => telemetry }),
    }),
    GotCallout: ({ text, tone }) => {
      const id = model.calloutSeq + 1
      return {
        model: modifyFields(model, {
          calloutSeq: () => id,
          callouts: cs => [...cs.slice(-2), { id, text, tone }],
        }),
        commands: [ExpireCallout({ id })],
      }
    },
    ExpiredCallout: ({ id }) => ({
      model: modifyFields(model, { callouts: cs => cs.filter(c => c.id !== id) }),
    }),
    EndedMission: ({ result }) => {
      const isBest = result.total > model.best
      const best = Math.max(model.best, result.total)
      return {
        model: modifyFields(model, {
          screen: () => 'Result' as const,
          maybeResult: () => Option.some({ ...result, isBest }),
          best: () => best,
        }),
        commands: isBest ? [SaveBest({ best })] : [],
      }
    },
    ClickedLaunch: () => launch(model),
    ClickedRetry: () => launch(model),
    ClickedHowTo: () => ({ model: modifyFields(model, { screen: () => 'HowTo' as const }) }),
    ClickedBackToTitle: () => toTitle(model),
    ClickedPause: () => (model.screen === 'Playing' ? pause(model) : { model }),
    ClickedResume: () => (model.screen === 'Paused' ? resume(model) : { model }),
    ClickedMute: () => {
      const muted = !model.muted
      return { model: modifyFields(model, { muted: () => muted }), commands: [SetMuted({ muted })] }
    },
    PressedKey: ({ key }) => {
      const k = key.toLowerCase()
      switch (model.screen) {
        case 'Title':
          if (k === 'enter' || k === ' ') return launch(model)
          if (k === 'h') return { model: modifyFields(model, { screen: () => 'HowTo' as const }) }
          break
        case 'HowTo':
          if (k === 'enter' || k === ' ') return launch(model)
          if (k === 'escape') return { model: modifyFields(model, { screen: () => 'Title' as const }) }
          break
        case 'Playing':
          if (k === 'escape') return pause(model)
          if (k === 'r') return launch(model)
          break
        case 'Paused':
          if (k === 'escape' || k === 'enter') return resume(model)
          if (k === 'r') return launch(model)
          break
        case 'Result':
          if (k === 'r' || k === 'enter' || k === ' ') return launch(model)
          if (k === 'escape') return toTitle(model)
          break
        case 'Booting':
          break
      }
      if (k === 'm') {
        const muted = !model.muted
        return { model: modifyFields(model, { muted: () => muted }), commands: [SetMuted({ muted })] }
      }
      return { model }
    },
    LoadedBest: ({ best }) => ({ model: modifyFields(model, { best: () => best }) }),
    CompletedGameCommand: () => ({ model }),
  })

// INIT

const detectTouch = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1)

const detectMuted = () => {
  try {
    return localStorage.getItem('chopstix.muted') === '1'
  } catch {
    return false
  }
}

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    screen: 'Booting',
    maybeError: Option.none(),
    telemetry: emptyTelemetry,
    callouts: [],
    calloutSeq: 0,
    maybeResult: Option.none(),
    best: 0,
    muted: detectMuted(),
    touch: detectTouch(),
    attempts: 0,
  },
  commands: [LoadBest()],
})

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message>()(_entry => ({
  keyboard: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: window,
      type: 'keydown',
      filterMapEvent: (e: KeyboardEvent) =>
        e.repeat ? Option.none() : Option.some(Message.PressedKey({ key: e.key })),
    }),
  ),
  visibility: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: document,
      type: 'visibilitychange',
      filterMapEvent: () => (document.hidden ? Option.some(Message.ClickedPause()) : Option.none()),
    }),
  ),
}))

// VIEW

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

const button = (h: HtmlBuilder<Message>, label: string, msg: Message, primary = false, hint = '') =>
  h.button(
    [h.Class(`btn ${primary ? 'btn-primary' : ''}`), h.OnClick(msg), h.Type('button')],
    [h.span([h.Class('btn-label')], [label]), ...(hint ? [h.span([h.Class('btn-hint')], [hint])] : [])],
  )

const logo = (h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class('logo')],
    [
      h.div([h.Class('logo-mark')], [h.span([], ['╫'])]),
      h.h1([h.Class('logo-word')], [GAME_NAME]),
      h.p([h.Class('logo-tag')], ['LAUNCH IT · STAGE IT · CATCH IT']),
    ],
  )

const titleView = (model: Model, h: HtmlBuilder<Message>): Html =>
  overlay(h, 'overlay-title', Option.none(), [
      logo(h),
      h.p(
        [h.Class('blurb')],
        [
          'A deliberately unfair rocket game. Four keys, two engine banks, one gimbal, ',
          h.em([], ['zero']),
          ' autopilot. Fly to the target altitude, release the payload, then bring the booster home into the tower\u2019s arms.',
        ],
      ),
      h.div(
        [h.Class('row')],
        [
          button(h, 'LAUNCH', Message.ClickedLaunch(), true, model.touch ? '' : 'ENTER'),
          button(h, 'HOW TO FLY', Message.ClickedHowTo(), false, model.touch ? '' : 'H'),
        ],
      ),
      h.p([h.Class('best')], [model.best > 0 ? `PERSONAL BEST  ${fmt(model.best)}` : 'NO FLIGHTS LOGGED YET']),
      h.p([h.Class('fineprint')], ['Fan-made homage. Not affiliated with any launch company.']),
  ])

const keyCap = (h: HtmlBuilder<Message>, k: string) => h.kbd([h.Class('kbd')], [k])

// Every overlay renders its content in one scrollable panel. When it can be dismissed it also gets
// a backdrop (a sibling, so taps inside the panel never reach it) and a sticky close button.
const overlay = (h: HtmlBuilder<Message>, cls: string, maybeClose: Option.Option<Message>, children: ReadonlyArray<Html>): Html =>
  h.div(
    [h.Class(`overlay ${cls}`)],
    [
      ...Option.match(maybeClose, {
        onNone: () => [],
        onSome: close => [h.div([h.Class('overlay-backdrop'), h.OnClick(close)], [])],
      }),
      h.div(
        [h.Class('panel-scroll'), h.DataAttribute('scroll', '')],
        [
          ...Option.match(maybeClose, {
            onNone: () => [],
            onSome: close => [
              h.button([h.Class('panel-close'), h.OnClick(close), h.Type('button'), h.AriaLabel('Close')], ['\u2715']),
            ],
          }),
          ...children,
        ],
      ),
    ],
  )

const howToView = (model: Model, h: HtmlBuilder<Message>): Html =>
  overlay(h, 'overlay-howto', Option.some(Message.ClickedBackToTitle()), [
      h.h2([h.Class('h2')], ['FLIGHT MANUAL']),
      h.div(
        [h.Class('howto-grid')],
        [
          h.div(
            [h.Class('howto-card')],
            [
              h.div([h.Class('keys')], [keyCap(h, 'Q'), keyCap(h, 'P')]),
              h.p([], [h.strong([], ['Engine banks. ']), 'Q lights the left half of the cluster, P the right. Both to climb. One alone spins you — that is also how you steer.']),
            ],
          ),
          h.div(
            [h.Class('howto-card')],
            [
              h.div([h.Class('keys')], [keyCap(h, 'W'), keyCap(h, 'O')]),
              h.p([], [h.strong([], ['Gimbal & grid fins. ']), 'W swings the nose left, O swings it right. The actuators keep moving while held and sag back slowly. Gimbal needs thrust; grid fins need air.']),
            ],
          ),
          h.div(
            [h.Class('howto-card')],
            [
              h.div([h.Class('keys')], [keyCap(h, model.touch ? 'STAGE' : 'SPACE')]),
              h.p([], [h.strong([], ['Stage. ']), 'Release the payload inside the window around the target altitude. The closer and straighter, the more points.']),
            ],
          ),
          h.div(
            [h.Class('howto-card')],
            [
              h.div([h.Class('keys')], [keyCap(h, 'CATCH')]),
              h.p([], [h.strong([], ['The catch. ']), 'Bring the booster down beside the tower, slow (< 8 m/s), centred (< 5 m), upright (< 8°). Approach from the open side — not through the tower.']),
            ],
          ),
        ],
      ),
      h.ol(
        [h.Class('steps')],
        [
          h.li([], ['Hold Q+P to lift off. Tap one off to correct the tilt before it runs away — the stack is aerodynamically unstable.']),
          h.li([], ['Ease off near the target so you coast into the window, then stage.']),
          h.li([], ['Steer the falling booster with the fins (it is fast: time warps while you coast).']),
          h.li([], ['Light the landing burn late, kill your speed and drift into the arms.']),
        ],
      ),
      model.touch
        ? h.p([h.Class('fineprint')], ['On touch: left thumb Q (low) and W (high), right thumb P (low) and O (high). STAGE is centre-bottom. Landscape plays best.'])
        : h.p([h.Class('fineprint')], ['Esc pauses · R restarts · M mutes']),
      h.div(
        [h.Class('row')],
        [button(h, 'LAUNCH', Message.ClickedLaunch(), true, model.touch ? '' : 'ENTER'), button(h, 'BACK', Message.ClickedBackToTitle(), false, model.touch ? '' : 'ESC')],
      ),
  ])

const resultTitle = (r: Result) =>
  r.kind === 'Caught' ? 'CAUGHT!' : r.kind === 'Touchdown' ? 'TOUCHDOWN' : 'RAPID UNSCHEDULED DISASSEMBLY'

const resultView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(model.maybeResult, {
    onNone: () => h.div([], []),
    onSome: r =>
      overlay(h, `overlay-result result-${r.kind.toLowerCase()}`, Option.some(Message.ClickedBackToTitle()), [
          h.p([h.Class('result-kicker')], [`MISSION ${String(model.attempts).padStart(3, '0')} · T+${formatMet(r.met)}`]),
          h.h2([h.Class('result-title')], [resultTitle(r)]),
          h.p([h.Class('result-reason')], [r.reason]),
          h.div(
            [h.Class('score-table')],
            [
              scoreRow(h, 'MAX ALTITUDE', `${(r.maxAlt / 1000).toFixed(2)} km`, r.altitudePts),
              scoreRow(
                h,
                'PAYLOAD RELEASE',
                r.releaseAlt === null
                  ? 'never staged'
                  : `${signed(Math.round(r.releaseAlt - r.targetAlt))} m · ${(r.releaseTilt ?? 0).toFixed(1)}°`,
                r.releasePts,
              ),
              scoreRow(
                h,
                'LANDING',
                r.kind === 'Crashed' ? '—' : `${r.sinkRate.toFixed(1)} m/s · ${signed(Number(r.dx.toFixed(1)))} m · ${r.tiltDeg.toFixed(1)}°`,
                r.landingPts,
              ),
              scoreRow(h, 'FUEL BONUS', '', r.fuelPts),
              h.div([h.Class('score-total')], [h.span([], ['SCORE']), h.strong([], [fmt(r.total)])]),
            ],
          ),
          h.p([h.Class('best')], [r.isBest ? 'NEW PERSONAL BEST' : `PERSONAL BEST  ${fmt(model.best)}`]),
          h.div(
            [h.Class('row')],
            [button(h, 'FLY AGAIN', Message.ClickedRetry(), true, model.touch ? '' : 'R'), button(h, 'MENU', Message.ClickedBackToTitle(), false, model.touch ? '' : 'ESC')],
          ),
      ]),
  })

const scoreRow = (h: HtmlBuilder<Message>, label: string, detail: string, pts: number) =>
  h.div(
    [h.Class('score-row')],
    [h.span([h.Class('score-label')], [label]), h.span([h.Class('score-detail')], [detail]), h.span([h.Class('score-pts')], [fmt(pts)])],
  )

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export const formatMet = (met: number) => {
  const t = Math.max(0, met)
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const pausedView = (h: HtmlBuilder<Message>): Html =>
  overlay(h, 'overlay-paused', Option.some(Message.ClickedResume()), [
      h.h2([h.Class('h2')], ['HOLD HOLD HOLD']),
      h.div(
        [h.Class('row')],
        [button(h, 'RESUME', Message.ClickedResume(), true), button(h, 'RESTART', Message.ClickedRetry()), button(h, 'MENU', Message.ClickedBackToTitle())],
      ),
  ])

const topRight = (model: Model, h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class('corner-buttons')],
    [
      ...(model.screen === 'Playing'
        ? [h.button([h.Class('icon-btn'), h.OnClick(Message.ClickedPause()), h.Type('button'), h.AriaLabel('Pause')], ['❚❚'])]
        : []),
      h.button(
        [h.Class('icon-btn'), h.OnClick(Message.ClickedMute()), h.Type('button'), h.AriaLabel(model.muted ? 'Unmute' : 'Mute')],
        [model.muted ? '🔇' : '🔊'],
      ),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const flying = model.screen === 'Playing' || model.screen === 'Paused'
  return {
    title: model.screen === 'Playing' ? `${GAME_NAME} · T+${formatMet(model.telemetry.met)}` : `${GAME_NAME} — catch the booster`,
    body: h.div(
      [h.Class(`app screen-${model.screen.toLowerCase()} ${model.touch ? 'is-touch' : 'is-desktop'}`)],
      [
        h.div([h.Class('stage'), h.OnMount(MountGame())], []),
        h.div([h.Class('scrim')], []),
        ...(flying ? [hudView(model, h)] : []),
        ...(model.screen === 'Playing' ? [touchPadsView(model, h)] : []),
        ...(model.screen === 'Booting'
          ? [
              h.div(
                [h.Class('overlay overlay-boot')],
                [
                  logo(h),
                  h.p(
                    [h.Class('boot-status')],
                    [Option.getOrElse(model.maybeError, () => 'Fuelling the stack…')],
                  ),
                ],
              ),
            ]
          : []),
        ...(model.screen === 'Title' ? [titleView(model, h)] : []),
        ...(model.screen === 'HowTo' ? [howToView(model, h)] : []),
        ...(model.screen === 'Result' ? [resultView(model, h)] : []),
        ...(model.screen === 'Paused' ? [pausedView(h)] : []),
        ...(model.screen !== 'Booting' ? [topRight(model, h)] : []),
        h.div([h.Class('rotate-hint')], ['Rotate to landscape for the full view']),
      ],
    ),
  }
}
