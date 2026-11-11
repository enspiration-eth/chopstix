import * as THREE from 'three'
import {
  BOOSTER,
  DT,
  MISSION,
  WORLD,
  airDensity,
  autopilot,
  basePoint,
  initialState,
  score,
  step,
  telemetry,
  windAt,
} from '../sim'
import type { Outcome, ScoreBreakdown, SimEvent, SimState, Telemetry } from '../sim'
import { Audio } from './audio'
import { createCloudDeck, createCloudPuffs } from './clouds'
import { createEarth } from './earth'
import { buildEnvMap } from './envmap'
import { Input } from './input'
import { Particles } from './particles'
import { createGlow } from './plume'
import { Post } from './post'
import { QualityGovernor, TIERS, isMobile } from './quality'
import { createBooster, createShip, setBellHeat } from './rocket'
import { createSky } from './sky'
import { createLaunchSite } from './tower'

export type Mode = 'attract' | 'play'

export interface LiveTelemetry extends Telemetry {
  readonly warp: number
  readonly quality: string
  readonly fps: number
  readonly inWindow: boolean
  readonly catchH: number
}

export interface MissionResult {
  readonly outcome: Outcome
  readonly score: ScoreBreakdown
  readonly targetAlt: number
  readonly releaseAlt: number | null
  readonly releaseTilt: number | null
  readonly maxAlt: number
  readonly met: number
}

export type CalloutTone = 'info' | 'good' | 'bad'

export interface GameCallbacks {
  readonly onTelemetry: (t: LiveTelemetry) => void
  readonly onCallout: (text: string, tone: CalloutTone) => void
  readonly onMissionEnd: (r: MissionResult) => void
}

const SUN = new THREE.Vector3(-0.62, 0.3, 0.55).normalize()
const tmpV = new THREE.Vector3()
const tmpV2 = new THREE.Vector3()

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

interface Debris {
  p: THREE.Vector3
  v: THREE.Vector3
  r: THREE.Euler
  w: THREE.Vector3
  s: number
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly post: Post
  private readonly governor: QualityGovernor
  private readonly input = new Input()
  readonly audio = new Audio()
  private readonly cb: GameCallbacks
  private readonly container: HTMLElement

  private readonly sky
  private readonly earth
  private readonly puffs
  private readonly deck
  private readonly site
  private readonly booster
  private readonly ship
  private readonly smoke: Particles
  private readonly fire: Particles
  private readonly baseGlow
  private readonly shipGlow
  private readonly flashLight: THREE.PointLight
  private readonly debrisMesh: THREE.InstancedMesh
  private debris: Debris[] = []

  private mode: Mode = 'attract'
  private autopilotInPlay = false
  private paused = false
  private state: SimState
  private prev: SimState
  private acc = 0
  private warp = 1
  private slowmo = 0
  private endTimer = -1
  private ended = false
  private attractRestart = -1
  private shake = 0
  private flash = 0
  private landingBurnCalled = false
  private windowCalled = false
  private holes: THREE.Vector4[]
  private holeCursor = 0
  private lastHoleLayer = -1
  private telemetryTimer = 0
  private sortTimer = 0
  private raf = 0
  private last = performance.now()
  private time = 0
  private camPos = new THREE.Vector3(120, 40, 260)
  private camLook = new THREE.Vector3(0, 60, 0)
  private anchor = new THREE.Vector3(0, 60, 0)
  private offset = new THREE.Vector3(120, -20, 260)
  private orbit = 0
  private disposed = false
  private readonly onResize: () => void

  constructor(container: HTMLElement, cb: GameCallbacks) {
    this.container = container
    this.cb = cb
    const mobile = isMobile()
    this.governor = new QualityGovernor(mobile ? 1 : 2)
    const tier = TIERS[this.governor.tier]!

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxDpr))
    this.renderer.domElement.className = 'game-canvas'
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(55, 1, 1.5, 900_000)
    this.scene.environment = buildEnvMap(this.renderer, SUN)

    const sunLight = new THREE.DirectionalLight(0xfff0dd, 3.2)
    sunLight.position.copy(SUN).multiplyScalar(1000)
    this.scene.add(sunLight)
    this.scene.add(sunLight.target)
    this.scene.add(new THREE.HemisphereLight(0x9ab8e8, 0x4a4035, 0.7))

    this.sky = createSky(SUN)
    this.scene.add(this.sky.mesh)
    this.earth = createEarth(SUN, mobile ? 160 : 256)
    this.scene.add(this.earth.mesh)
    this.puffs = createCloudPuffs(SUN, TIERS[2]!.clouds, 3)
    this.puffs.mesh.geometry instanceof THREE.InstancedBufferGeometry &&
      (this.puffs.mesh.geometry.instanceCount = tier.clouds)
    this.scene.add(this.puffs.mesh)
    this.deck = createCloudDeck(SUN, 2700)
    this.scene.add(this.deck.mesh)
    this.holes = this.puffs.uniforms.uHoles.value
    this.deck.uniforms.uHoles.value = this.holes

    this.site = createLaunchSite()
    this.scene.add(this.site.group)

    const seg = mobile ? 32 : 48
    this.booster = createBooster(seg, mobile ? 10 : 16)
    this.scene.add(this.booster.group)
    this.ship = createShip(seg, mobile ? 10 : 14)
    this.scene.add(this.ship.group)

    this.smoke = new Particles(TIERS[2]!.smoke, false, SUN)
    this.fire = new Particles(TIERS[2]!.fire, true, SUN)
    this.smoke.budget = tier.smoke
    this.fire.budget = tier.fire
    this.scene.add(this.smoke.mesh)
    this.scene.add(this.fire.mesh)

    this.baseGlow = createGlow(new THREE.Color(1.0, 0.55, 0.25), 30)
    this.scene.add(this.baseGlow.mesh)
    this.shipGlow = createGlow(new THREE.Color(0.75, 0.6, 1.0), 40)
    this.scene.add(this.shipGlow.mesh)
    this.flashLight = new THREE.PointLight(0xffaa66, 0, 2500, 1.2)
    this.scene.add(this.flashLight)

    const dGeo = new THREE.BoxGeometry(1, 1, 1)
    this.debrisMesh = new THREE.InstancedMesh(
      dGeo,
      new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.9, roughness: 0.45 }),
      48,
    )
    this.debrisMesh.count = 0
    this.debrisMesh.frustumCulled = false
    this.scene.add(this.debrisMesh)

    this.post = new Post(this.renderer, this.scene, this.camera, tier.bloom && !mobile ? 4 : 0)
    this.post.enabled = tier.bloom

    this.state = initialState(1)
    this.prev = this.state

    this.onResize = () => this.resize()
    window.addEventListener('resize', this.onResize)
    window.visualViewport?.addEventListener('resize', this.onResize)
    window.addEventListener('orientationchange', this.onResize)
    this.resize()
    this.startAttract()
    this.raf = requestAnimationFrame(this.frame)
  }

  // ---------------------------------------------------------------- public API

  startAttract() {
    this.mode = 'attract'
    this.input.enabled = false
    this.reset(1 + Math.floor(Math.random() * 1000))
  }

  startMission(seed: number) {
    this.mode = 'play'
    this.input.reset()
    this.input.enabled = true
    this.paused = false
    this.reset(seed)
  }

  setPaused(p: boolean) {
    this.paused = p
    this.input.enabled = !p && this.mode === 'play'
    if (p) this.input.reset()
  }

  setMuted(m: boolean) {
    this.audio.setMuted(m)
  }

  unlockAudio() {
    this.audio.unlock()
  }

  /** test hooks (enabled with ?debug): let the autopilot fly a real mission and skip ahead */
  debugAutopilot(on: boolean) {
    this.autopilotInPlay = on
  }

  debugFastForward(seconds: number, until?: (s: SimState) => boolean) {
    const n = Math.round(seconds / DT)
    for (let i = 0; i < n; i++) {
      if (until && until(this.state)) break
      this.prev = this.state
      const r = step(this.state, autopilot(this.state))
      this.state = r.state
      for (const e of r.events) this.onEvent(e)
    }
    this.prev = this.state
  }

  debugState() {
    return this.state
  }

  get qualityName() {
    return TIERS[this.governor.tier]!.name
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    window.visualViewport?.removeEventListener('resize', this.onResize)
    window.removeEventListener('orientationchange', this.onResize)
    this.input.dispose()
    this.audio.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ---------------------------------------------------------------- internals

  private reset(seed: number) {
    this.state = initialState(seed)
    this.prev = this.state
    this.acc = 0
    this.warp = 1
    this.slowmo = 0
    this.endTimer = -1
    this.ended = false
    this.attractRestart = -1
    this.shake = 0
    this.flash = 0
    this.landingBurnCalled = false
    this.windowCalled = false
    this.lastHoleLayer = -1
    for (const h of this.holes) h.set(0, 0, 0, 0)
    this.smoke.clear()
    this.fire.clear()
    this.debris = []
    this.debrisMesh.count = 0
    this.booster.group.visible = true
    this.ship.group.visible = true
    this.site.setArms(0, 0)
    this.orbit = Math.random() * Math.PI * 2
    this.camPos.set(140, 45, 300)
    this.camLook.set(0, 70, 0)
    this.anchor.set(-6, 70, 0)
    this.offset.set(110, -30, 230)
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    const tier = TIERS[this.governor.tier]!
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxDpr))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w < h ? 68 : 52
    this.camera.updateProjectionMatrix()
    this.post.setSize(w, h, tier.bloomScale)
  }

  private applyTier() {
    const tier = TIERS[this.governor.tier]!
    this.post.enabled = tier.bloom
    this.smoke.budget = tier.smoke
    this.fire.budget = tier.fire
    const g = this.puffs.mesh.geometry as THREE.InstancedBufferGeometry
    g.instanceCount = tier.clouds
    this.resize()
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const frameMs = now - this.last
    const dtReal = Math.min(0.1, frameMs / 1000)
    this.last = now
    if (document.hidden) return
    if (this.governor.sample(frameMs, dtReal)) this.applyTier()

    if (!this.paused) this.simulate(dtReal)
    this.render(dtReal)
  }

  private simulate(dtReal: number) {
    const s = this.state
    const coasting =
      s.phase === 'Return' && s.throttleL < 0.05 && s.throttleR < 0.05 && basePoint(s).y > 1400 && s.booster.vy < 40
    const targetWarp = this.slowmo > 0 ? 0.3 : coasting ? 2.5 : 1
    this.warp += (targetWarp - this.warp) * (1 - Math.exp(-dtReal * (targetWarp < this.warp ? 8 : 1.5)))
    if (this.slowmo > 0) this.slowmo -= dtReal
    const dt = dtReal * this.warp
    this.time += dt
    this.acc += dt
    let steps = 0
    while (this.acc >= DT && steps < 48) {
      const controls = this.mode === 'attract' || this.autopilotInPlay ? autopilot(this.state) : this.input.read()
      this.prev = this.state
      const r = step(this.state, controls)
      this.state = r.state
      for (const e of r.events) this.onEvent(e)
      this.acc -= DT
      steps++
    }
    if (steps >= 48) this.acc = 0
    this.derivedCallouts()
    this.updateEffects(dt)

    if (this.endTimer > 0) {
      this.endTimer -= dtReal
      if (this.endTimer <= 0 && !this.ended) {
        this.ended = true
        if (this.mode === 'play') this.cb.onMissionEnd(this.result())
        else this.attractRestart = 3
      }
    }
    if (this.attractRestart > 0) {
      this.attractRestart -= dtReal
      if (this.attractRestart <= 0) this.startAttract()
    }

    this.telemetryTimer -= dtReal
    if (this.telemetryTimer <= 0) {
      this.telemetryTimer = 0.05
      const t = telemetry(this.state)
      const pins = this.pinsHeight()
      this.cb.onTelemetry({
        ...t,
        warp: this.warp,
        quality: TIERS[this.governor.tier]!.name,
        fps: 1000 / this.governor.frameMs,
        inWindow: this.state.stacked && Math.abs(t.altitude - this.state.targetAlt) <= MISSION.releaseWindow,
        catchH: pins,
      })
    }
  }

  private pinsHeight() {
    const b = basePoint(this.state)
    return b.y + Math.cos(this.state.booster.theta) * WORLD.pinsAboveBase - WORLD.armY
  }

  private result(): MissionResult {
    const s = this.state
    return {
      outcome: s.outcome!,
      score: score(s),
      targetAlt: s.targetAlt,
      releaseAlt: s.release?.alt ?? null,
      releaseTilt: s.release?.tiltDeg ?? null,
      maxAlt: s.maxAlt,
      met: s.met,
    }
  }

  private callout(text: string, tone: CalloutTone) {
    if (this.mode === 'play') this.cb.onCallout(text, tone)
  }

  private derivedCallouts() {
    const s = this.state
    const alt = basePoint(s).y
    if (s.stacked && !this.windowCalled && Math.abs(alt - s.targetAlt) <= MISSION.releaseWindow) {
      this.windowCalled = true
      this.callout('RELEASE WINDOW OPEN — STAGE NOW', 'info')
      this.audio.beep(1320, 0.18)
    }
    if (s.phase === 'Return' && !this.landingBurnCalled && alt < 2600 && s.throttleL + s.throttleR > 1.2 && s.booster.vy < -20) {
      this.landingBurnCalled = true
      this.callout('LANDING BURN', 'info')
    }
  }

  private onEvent(e: SimEvent) {
    const s = this.state
    switch (e._tag) {
      case 'Liftoff':
        this.callout('LIFTOFF', 'good')
        this.shake = Math.max(this.shake, 1)
        break
      case 'MaxQ':
        this.callout('MAX-Q', 'info')
        break
      case 'Separation': {
        const err = Math.round(e.release.alt - s.targetAlt)
        this.callout(
          e.inWindow ? `STAGE SEP · PAYLOAD DEPLOYED (${err >= 0 ? '+' : ''}${err} m)` : `STAGE SEP · OUTSIDE WINDOW (${err >= 0 ? '+' : ''}${err} m)`,
          e.inWindow ? 'good' : 'bad',
        )
        this.hotStage()
        this.audio.beep(660, 0.25)
        break
      }
      case 'LowFuel':
        this.callout('BINGO FUEL', 'bad')
        this.audio.beep(330, 0.3)
        break
      case 'Caught':
        this.callout('TOWER CATCH CONFIRMED', 'good')
        this.slowmo = 2.2
        this.shake = Math.max(this.shake, 0.8)
        this.audio.clang()
        this.catchSparks()
        this.endTimer = 4.2
        break
      case 'Touchdown':
        this.callout('TOUCHDOWN — NO CATCH', 'info')
        this.endTimer = 2.5
        break
      case 'Crashed':
        this.callout(e.outcome.reason.toUpperCase(), 'bad')
        this.explode()
        this.endTimer = 3.2
        break
    }
  }

  // ---------------------------------------------------------------- effects

  private boosterFrame(s: SimState) {
    const b = basePoint(s)
    const th = s.booster.theta
    return { x: b.x, y: b.y, ux: Math.sin(th), uy: Math.cos(th), th }
  }

  private hotStage() {
    const f = this.boosterFrame(this.state)
    const y = f.y + f.uy * BOOSTER.length
    const x = f.x + f.ux * BOOSTER.length
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 25 + Math.random() * 45
      this.fire.emit({
        x, y, z: 0,
        vx: Math.cos(a) * sp + this.state.booster.vx, vy: (Math.random() - 0.3) * 20 + this.state.booster.vy * 0.9, vz: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.7, size0: 4, size1: 16,
        r: 2.5, g: 1.3, b: 0.6, alpha: 0.9, drag: 1.5, heat: 1,
      })
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      this.smoke.emit({
        x, y, z: 0,
        vx: Math.cos(a) * 30 + this.state.booster.vx * 0.8, vy: this.state.booster.vy * 0.8, vz: Math.sin(a) * 30,
        life: 2.5, size0: 6, size1: 28, r: 0.95, g: 0.95, b: 0.97, alpha: 0.5, drag: 1.2,
      })
    }
    this.shake = Math.max(this.shake, 0.6)
    this.flash = 0.25
  }

  private catchSparks() {
    const f = this.boosterFrame(this.state)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 60; i++) {
        this.fire.emit({
          x: f.x + (Math.random() - 0.5) * 3, y: WORLD.armY + 0.5, z: side * (BOOSTER.radius + 1),
          vx: (Math.random() - 0.5) * 30, vy: Math.random() * 25, vz: side * Math.random() * 25,
          life: 0.6 + Math.random() * 0.8, size0: 0.6, size1: 0.2,
          r: 3, g: 2.2, b: 1.2, alpha: 1, drag: 0.4, gravity: 18, heat: 1,
        })
      }
    }
    for (let i = 0; i < 30; i++) {
      this.smoke.emit({
        x: f.x, y: WORLD.armY - 2, z: (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 12, vy: Math.random() * 6, vz: (Math.random() - 0.5) * 12,
        life: 4, size0: 4, size1: 18, r: 0.9, g: 0.9, b: 0.92, alpha: 0.45, drag: 0.8, buoyancy: 2,
      })
    }
  }

  private explode() {
    const s = this.state
    const f = this.boosterFrame(s)
    const len = s.stacked ? BOOSTER.length + 50 : BOOSTER.length
    const cx = f.x + f.ux * len * 0.4
    const cy = Math.max(2, f.y + f.uy * len * 0.4)
    const big = s.stacked ? 1.6 : 1
    this.booster.group.visible = false
    if (s.stacked) this.ship.group.visible = false
    for (let i = 0; i < 220 * big; i++) {
      const a = Math.random() * Math.PI * 2
      const e = Math.random() * Math.PI - Math.PI / 2
      const sp = Math.pow(Math.random(), 0.5) * 70 * big
      this.fire.emit({
        x: cx + (Math.random() - 0.5) * 10, y: cy + (Math.random() - 0.5) * len * 0.6, z: (Math.random() - 0.5) * 10,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp * 0.7 + 12, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0.8 + Math.random() * 2.2, size0: 8 * big, size1: (30 + Math.random() * 40) * big,
        r: 3.0, g: 1.6, b: 0.7, alpha: 0.85, drag: 2.2, buoyancy: 14, heat: 1,
      })
    }
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 60 + Math.random() * 120
      this.fire.emit({
        x: cx, y: cy, z: 0,
        vx: Math.cos(a) * sp, vy: Math.random() * sp, vz: Math.sin(a) * sp,
        life: 1 + Math.random() * 2, size0: 1.2, size1: 0.3,
        r: 3, g: 2, b: 1, alpha: 1, drag: 0.6, gravity: 9.8, heat: 1,
      })
    }
    for (let i = 0; i < 140 * big; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = Math.random() * 40 * big
      this.smoke.emit({
        x: cx + (Math.random() - 0.5) * 20, y: cy + (Math.random() - 0.3) * 30, z: (Math.random() - 0.5) * 20,
        vx: Math.cos(a) * sp, vy: 5 + Math.random() * 25, vz: Math.sin(a) * sp,
        life: 6 + Math.random() * 7, size0: 14 * big, size1: (60 + Math.random() * 70) * big,
        r: 0.16, g: 0.15, b: 0.14, alpha: 0.85, drag: 0.9, buoyancy: 6, heat: 0.8,
      })
    }
    this.debris = []
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 20 + Math.random() * 80
      this.debris.push({
        p: new THREE.Vector3(cx + (Math.random() - 0.5) * 8, cy + (Math.random() - 0.5) * len * 0.5, (Math.random() - 0.5) * 8),
        v: new THREE.Vector3(Math.cos(a) * sp, Math.random() * sp + 10, Math.sin(a) * sp),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
        s: 1 + Math.random() * 4,
      })
    }
    this.flash = 1
    this.shake = 2.5
    this.flashLight.position.set(cx, cy, 20)
    this.audio.boom(big)
  }

  private updateEffects(dt: number) {
    const s = this.state
    const f = this.boosterFrame(s)
    const alt = Math.max(0, f.y)
    const dens = airDensity(alt)
    const thrust = (s.throttleL + s.throttleR) / 2
    const alive = s.phase !== 'Crashed'
    const wind = windAt(s.seed, s.windDir, alt, s.t)

    // pad deluge steam & ground smoke while the engines are near the ground
    const nearGround = alive && thrust > 0.05 && f.y < 160
    if (nearGround) {
      const n = Math.ceil(thrust * dt * (s.stacked ? 120 : 50) * (1 - f.y / 160))
      const gy = Math.abs(f.x - WORLD.catchX) < WORLD.mountHalfWidth ? 2 : 1
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 18 + Math.random() * 34
        this.smoke.emit({
          x: f.x + Math.cos(a) * 8, y: gy + Math.random() * 6, z: Math.sin(a) * 8,
          vx: Math.cos(a) * sp, vy: 2 + Math.random() * 8, vz: Math.sin(a) * sp,
          life: 4 + Math.random() * 5, size0: 7, size1: 26 + Math.random() * 26,
          r: 0.82, g: 0.82, b: 0.83, alpha: 0.42, drag: 0.75, buoyancy: 3, heat: Math.random() < 0.2 ? 0.35 : 0,
        })
      }
    }
    // exhaust trail / contrail
    if (alive && thrust > 0.1 && alt < 6000) {
      const n = Math.ceil(dt * 70 * thrust * dens)
      const tail = s.stacked ? 26 : 16
      for (let i = 0; i < n; i++) {
        const k = Math.random()
        this.smoke.emit({
          x: f.x - f.ux * (tail + k * 20), y: f.y - f.uy * (tail + k * 20), z: (Math.random() - 0.5) * 6,
          vx: s.booster.vx * 0.25 + (Math.random() - 0.5) * 6, vy: s.booster.vy * 0.25 + (Math.random() - 0.5) * 6, vz: (Math.random() - 0.5) * 6,
          life: 3 + Math.random() * 4 * dens, size0: 6, size1: 26 + 30 * (1 - dens),
          r: 0.88, g: 0.88, b: 0.87, alpha: (s.stacked ? 0.3 : 0.08) * dens + 0.03, drag: 0.4, heat: 0.05,
        })
      }
    }
    // cloud punch-through holes
    const layer = f.y > 750 && f.y < 1650 ? 0 : f.y > 2550 && f.y < 2850 ? 1 : -1
    if (layer >= 0 && layer !== this.lastHoleLayer && alive) {
      const h = this.holes[this.holeCursor % this.holes.length]!
      h.set(f.x, 0, 90, 1)
      this.holeCursor++
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2
        this.smoke.emit({
          x: f.x + Math.cos(a) * 20, y: f.y, z: Math.sin(a) * 20,
          vx: Math.cos(a) * 40, vy: (Math.random() - 0.5) * 10, vz: Math.sin(a) * 40,
          life: 4, size0: 20, size1: 70, r: 1, g: 1, b: 1, alpha: 0.5, drag: 0.8,
        })
      }
    }
    if (layer >= 0) this.lastHoleLayer = layer
    else if (f.y < 700 || (f.y > 1700 && f.y < 2500)) this.lastHoleLayer = -1
    for (const h of this.holes) if (h.w > 0) h.z = Math.min(170, h.z + dt * 6)

    this.smoke.update(dt, wind)
    this.fire.update(dt, wind * 0.3)

    // debris
    if (this.debris.length) {
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      this.debris.forEach((d, i) => {
        d.v.y -= 9.8 * dt
        d.v.multiplyScalar(Math.exp(-0.15 * dt))
        d.p.addScaledVector(d.v, dt)
        if (d.p.y < 0.5) {
          d.p.y = 0.5
          d.v.y = Math.abs(d.v.y) * 0.25
          d.v.x *= 0.6
          d.v.z *= 0.6
          d.w.multiplyScalar(0.6)
        }
        d.r.x += d.w.x * dt
        d.r.y += d.w.y * dt
        d.r.z += d.w.z * dt
        q.setFromEuler(d.r)
        m.compose(d.p, q, tmpV.set(d.s, d.s * 0.3, d.s * 1.6))
        this.debrisMesh.setMatrixAt(i, m)
        if (Math.random() < dt * 6 && d.p.y > 1)
          this.smoke.emit({
            x: d.p.x, y: d.p.y, z: d.p.z, vx: 0, vy: 2, vz: 0, life: 2.5, size0: 2, size1: 9,
            r: 0.2, g: 0.2, b: 0.2, alpha: 0.6, drag: 1, heat: 0.6,
          })
      })
      this.debrisMesh.count = this.debris.length
      this.debrisMesh.instanceMatrix.needsUpdate = true
    }

    // catch arms
    if (s.phase === 'Caught') {
      const sag = Math.sin(Math.min(1, s.arms) * Math.PI) * 1.6
      this.site.setArms(1, sag)
    } else if (s.phase === 'Return' && this.pinsHeight() < 400) {
      // arms swing open and ready as the booster comes home
      this.site.setArms(0.15, 0)
    }

    this.shake = Math.max(0, this.shake - dt * 1.4)
    this.flash = Math.max(0, this.flash - dt * 2.5)

    // audio
    const camDist = this.camPos.distanceTo(tmpV.set(f.x, f.y, 0))
    this.audio.update(alive ? thrust : 0, Math.min(1, dens * 1.4), Math.max(0, 1 - camDist / 2000), Math.hypot(s.booster.vx, s.booster.vy))
  }

  // ---------------------------------------------------------------- rendering

  private render(dt: number) {
    const s = this.state
    const p = this.prev
    const alpha = this.paused ? 1 : Math.min(1, this.acc / DT)
    const smooth = p.stacked === s.stacked && p.phase === s.phase
    const fs = this.boosterFrame(s)
    const fp = smooth ? this.boosterFrame(p) : fs
    const bx = fp.x + (fs.x - fp.x) * alpha
    const by = fp.y + (fs.y - fp.y) * alpha
    const th = lerpAngle(fp.th, fs.th, alpha)
    const ux = Math.sin(th)
    const uy = Math.cos(th)

    // booster + (stacked) ship
    this.booster.group.position.set(bx, by, 0)
    this.booster.group.rotation.set(0, 0, -th)
    const alive = s.phase !== 'Crashed'
    const dens = airDensity(Math.max(0, by))
    const pu = this.booster.plumes.uniforms
    pu.uThrottleL.value = alive ? s.throttleL : 0
    pu.uThrottleR.value = alive ? s.throttleR : 0
    pu.uDensity.value = dens
    pu.uTime.value = this.time
    pu.uAllLit.value = s.stacked ? 1 : 0
    pu.uGimbal.value = s.gimbal
    const thrust = alive ? (s.throttleL + s.throttleR) / 2 : 0
    setBellHeat(thrust)
    this.booster.engineLight.intensity = thrust * (s.stacked ? 1.6e4 : 7e3) * (0.85 + 0.15 * Math.random())
    this.booster.fins.forEach((fin, i) => {
      fin.rotation.x = (i < 2 ? 1 : -1) * s.fins * 0.45
    })

    if (s.stacked) {
      this.ship.group.position.set(bx + ux * BOOSTER.length, by + uy * BOOSTER.length, 0)
      this.ship.group.rotation.set(0, 0, -th)
      this.ship.plumes.uniforms.uThrottleL.value = 0
      this.ship.plumes.uniforms.uThrottleR.value = 0
      this.shipGlow.uniforms.uIntensity.value = 0
    } else {
      const sh = s.ship
      const shp = p.ship.active ? p.ship : sh
      const sx = shp.x + (sh.x - shp.x) * alpha
      const sy = shp.y + (sh.y - shp.y) * alpha
      const sth = sh.theta
      this.ship.group.position.set(sx - Math.sin(sth) * 25, sy - Math.cos(sth) * 25, 0)
      this.ship.group.rotation.set(0, 0, -sth)
      const sb = sh.burn > 0.25 ? sh.burn : 0
      const su = this.ship.plumes.uniforms
      su.uThrottleL.value = sb
      su.uThrottleR.value = sb
      su.uDensity.value = airDensity(sy)
      su.uTime.value = this.time
      tmpV.set(sx - Math.sin(sth) * 32, sy - Math.cos(sth) * 32, 0)
      this.shipGlow.mesh.position.copy(tmpV)
      this.shipGlow.uniforms.uIntensity.value = sb * 1.6
    }

    // base glow sprite
    this.baseGlow.mesh.position.set(bx - ux * 10, by - uy * 10, 0)
    this.baseGlow.uniforms.uIntensity.value = thrust * (s.stacked ? 0.8 : 0.55) * (0.9 + 0.1 * Math.random())

    this.updateCamera(dt, bx, by, ux, uy)

    // shared uniforms
    const camAlt = this.camera.position.y
    this.sky.mesh.position.copy(this.camera.position)
    this.sky.uniforms.uAltitude.value = camAlt
    this.sky.uniforms.uTime.value = this.time
    this.earth.uniforms.uAltitude.value = camAlt
    this.earth.uniforms.uCamPos.value.copy(this.camera.position)
    this.earth.uniforms.uTime.value = this.time
    this.earth.uniforms.uScorch.value = s.phase === 'Pad' ? 0 : 1
    for (const u of [this.puffs.uniforms, this.deck.uniforms]) {
      u.uAltitude.value = camAlt
      u.uCamPos.value.copy(this.camera.position)
      u.uTime.value = this.time
      u.uRocket.value.set(bx + ux * 35, by + uy * 35, 0)
    }
    this.smoke.uniforms.uGlowPos.value.set(bx - ux * 20, by - uy * 20, 0)
    this.smoke.uniforms.uGlow.value = thrust * (s.stacked ? 0.6 : 0.12)
    this.sortTimer -= dt
    if (this.sortTimer <= 0) {
      this.sortTimer = 0.25
      this.puffs.sort(this.camera.position)
    }
    this.site.lights[0]!.visible = Math.sin(this.time * 3) > 0

    this.flashLight.intensity = this.flash * 4e7
    this.renderer.toneMappingExposure = 1.0 + this.flash * 0.6

    if (this.post.enabled) {
      const film = this.post.film.uniforms as Record<string, THREE.IUniform>
      film['uTime']!.value = this.time
      film['uFlash']!.value = this.flash * 0.35
      this.post.bloom.strength = 0.55 + thrust * 0.25 + this.flash
      this.post.render(dt)
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }

  private updateCamera(dt: number, bx: number, by: number, ux: number, uy: number) {
    const s = this.state
    const speed = Math.hypot(s.booster.vx, s.booster.vy)
    const center = tmpV.set(bx + ux * (s.stacked ? 55 : 35), by + uy * (s.stacked ? 55 : 35), 0)
    const desiredLook = tmpV2.copy(center)
    const desired = new THREE.Vector3()
    const portrait = this.camera.aspect < 1
    const zoom = portrait ? 1.45 : 1
    let k = 2.5

    if (this.mode === 'attract') this.orbit += dt * 0.05

    if (s.phase === 'Pad' || (s.phase === 'Ascent' && by < 140)) {
      // establishing shot of the stack on the mount, tower in frame
      const a = this.mode === 'attract' ? this.orbit : 0.38
      desired.set(Math.sin(a) * 250 * zoom + 30, 36, Math.cos(a) * 250 * zoom)
      desiredLook.set(this.mode === 'attract' ? -45 : -6, 70 + Math.max(0, by - 20) * 0.6, 0)
      k = 1.5
    } else if (s.phase === 'Caught') {
      const a = 0.95 + this.time * 0.03
      desired.set(WORLD.catchX + Math.sin(a) * 175 * zoom, WORLD.armY - 30, Math.cos(a) * 175 * zoom)
      desiredLook.set(WORLD.catchX - 6, WORLD.armY - 18, 0)
      k = 1.2
    } else if (s.phase === 'Crashed' || s.phase === 'Touchdown') {
      const o = s.outcome
      const cx = o ? bx : 0
      desired.set(cx + 120, Math.max(30, by * 0.6 + 40), 420 * zoom)
      desiredLook.set(cx, Math.max(10, by * 0.5), 0)
      k = 0.8
    } else {
      const pins = this.pinsHeight()
      const homing = !s.stacked && s.booster.vy < 0 && pins < 700
      if (homing) {
        // frame booster and the catch arms together
        const mid = new THREE.Vector3((bx + WORLD.catchX) / 2, (by + 40 + WORLD.armY) / 2, 0)
        const span = Math.max(Math.abs(bx - WORLD.catchX), by - WORLD.armY + 80)
        const dist = Math.max(170, span * 1.25) * zoom
        desired.set(mid.x + dist * 0.35, mid.y + dist * 0.05, dist)
        desiredLook.copy(mid)
      } else {
        const dist = (140 + Math.min(speed * 0.45, 220) + Math.min(by * 0.02, 160)) * zoom
        const above = s.stacked ? -0.18 : s.booster.vy < 0 ? 0.25 : 0.05
        const az = this.mode === 'attract' ? Math.sin(this.orbit) * 0.6 : 0.25
        desired.set(center.x + Math.sin(az) * dist, center.y + dist * above, Math.cos(az) * dist)
        if (!s.stacked && s.ship.active && s.met - (s.release?.t ?? 0) < 6) {
          // keep the departing payload in frame for a moment
          const shipY = s.ship.y
          desiredLook.set((center.x + s.ship.x) / 2, (center.y + shipY) / 2, 0)
          desired.z += Math.abs(shipY - center.y) * 0.8
        }
      }
    }
    // smooth the anchor (what we look at) tightly and the framing offset loosely, so a fast
    // rocket never outruns the camera but cuts between shots still glide
    const chase = s.phase === 'Ascent' || s.phase === 'Return'
    const kA = chase && by > 140 ? 14 : 2.2
    this.anchor.lerp(desiredLook, 1 - Math.exp(-dt * kA))
    this.offset.lerp(desired.sub(desiredLook), 1 - Math.exp(-dt * k))
    this.camLook.copy(this.anchor)
    this.camPos.copy(this.anchor).add(this.offset)
    if (this.camPos.y < 3) this.camPos.y = 3

    // shake: engines close to the camera in thick air, plus impulses
    const thrust = (s.throttleL + s.throttleR) / 2
    const near = Math.max(0, 1 - this.camPos.distanceTo(center) / 700)
    const amp = (thrust * airDensity(by) * near * (s.stacked ? 1.6 : 0.8) + this.shake) * 0.9
    const t = this.time * 32
    const sx = (Math.sin(t * 1.3) + Math.sin(t * 2.7 + 1.3) * 0.5) * amp
    const sy = (Math.sin(t * 1.7 + 0.5) + Math.sin(t * 3.1 + 2.1) * 0.5) * amp
    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z)
    this.camera.lookAt(this.camLook)
    this.camera.rotateZ(Math.sin(t * 0.9) * amp * 0.004)
  }
}
