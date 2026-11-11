/** Procedural WebAudio: engine roar, crackle, explosion, catch clang. No samples shipped. */
export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private roarGain: GainNode | null = null
  private roarFilter: BiquadFilterNode | null = null
  private crackleGain: GainNode | null = null
  private windGain: GainNode | null = null
  private muted = false

  /** must be called from a user gesture (iOS) */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    const comp = ctx.createDynamicsCompressor()
    this.master.connect(comp).connect(ctx.destination)

    const noise = this.noiseBuffer(ctx, 4, true)
    const roar = ctx.createBufferSource()
    roar.buffer = noise
    roar.loop = true
    this.roarFilter = ctx.createBiquadFilter()
    this.roarFilter.type = 'lowpass'
    this.roarFilter.frequency.value = 200
    this.roarGain = ctx.createGain()
    this.roarGain.gain.value = 0
    roar.connect(this.roarFilter).connect(this.roarGain).connect(this.master)
    roar.start()

    const white = this.noiseBuffer(ctx, 3, false)
    const crackle = ctx.createBufferSource()
    crackle.buffer = white
    crackle.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1400
    bp.Q.value = 0.7
    this.crackleGain = ctx.createGain()
    this.crackleGain.gain.value = 0
    crackle.connect(bp).connect(this.crackleGain).connect(this.master)
    crackle.start()

    const wind = ctx.createBufferSource()
    wind.buffer = white
    wind.loop = true
    const wf = ctx.createBiquadFilter()
    wf.type = 'bandpass'
    wf.frequency.value = 500
    wf.Q.value = 0.4
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    wind.connect(wf).connect(this.windGain).connect(this.master)
    wind.start()
  }

  private noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean) {
    const len = ctx.sampleRate * seconds
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else d[i] = w
    }
    return buf
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  /** thrust 0..1, density 0..1 (sound fades in vacuum), proximity 0..1 (camera close to engines), speed m/s */
  update(thrust: number, density: number, proximity: number, speed: number) {
    const ctx = this.ctx
    if (!ctx || !this.roarGain || !this.roarFilter || !this.crackleGain || !this.windGain) return
    const t = ctx.currentTime
    const air = 0.15 + 0.85 * density
    this.roarGain.gain.setTargetAtTime(thrust * air * (0.5 + 0.5 * proximity) * 0.9, t, 0.08)
    this.roarFilter.frequency.setTargetAtTime(140 + 500 * thrust * proximity, t, 0.1)
    const crack = thrust * density * proximity * (0.6 + 0.4 * Math.random())
    this.crackleGain.gain.setTargetAtTime(crack * 0.22, t, 0.02)
    this.windGain.gain.setTargetAtTime(Math.min(1, (speed / 300) * density) * 0.12, t, 0.2)
  }

  boom(size = 1) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(ctx, 3, true)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(1800, t)
    f.frequency.exponentialRampToValueAtTime(80, t + 2.5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(1.6 * size, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 3)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
    const thump = ctx.createOscillator()
    thump.frequency.setValueAtTime(70, t)
    thump.frequency.exponentialRampToValueAtTime(28, t + 0.8)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(1.2 * size, t)
    tg.gain.exponentialRampToValueAtTime(0.001, t + 1)
    thump.connect(tg).connect(this.master)
    thump.start(t)
    thump.stop(t + 1.1)
  }

  clang() {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    for (const [freq, amp, dec] of [
      [180, 0.5, 2.2],
      [427, 0.3, 1.6],
      [893, 0.18, 1.1],
      [1517, 0.1, 0.7],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq
      const g = ctx.createGain()
      g.gain.setValueAtTime(amp, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + dec)
      o.connect(g).connect(this.master)
      o.start(t)
      o.stop(t + dec + 0.1)
    }
  }

  beep(freq = 880, dur = 0.12) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  dispose() {
    void this.ctx?.close()
    this.ctx = null
  }
}
