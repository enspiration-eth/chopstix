import type { Controls } from '../sim'

type Key = 'q' | 'w' | 'o' | 'p'

/**
 * Keyboard + multi-touch input. Touch pads are plain DOM elements rendered by the UI
 * with `data-control="q|w|o|p|stage"`; each finger is tracked by pointerId so chords work.
 */
export class Input {
  private readonly held = new Set<Key>()
  private readonly touch = new Map<number, string>()
  private stageLatch = false
  enabled = false
  private readonly cleanups: Array<() => void> = []

  constructor() {
    const keyMap: Record<string, Key | 'stage'> = {
      KeyQ: 'q',
      KeyW: 'w',
      KeyO: 'o',
      KeyP: 'p',
      Space: 'stage',
    }
    const down = (e: KeyboardEvent) => {
      const k = keyMap[e.code]
      if (!k || !this.enabled) return
      e.preventDefault()
      if (k === 'stage') {
        if (!e.repeat) this.stageLatch = true
      } else this.held.add(k)
    }
    const up = (e: KeyboardEvent) => {
      const k = keyMap[e.code]
      if (!k) return
      if (k !== 'stage') this.held.delete(k)
    }
    const blur = () => {
      this.held.clear()
      this.touch.clear()
      this.syncPads()
    }
    const controlAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)
      const pad = el instanceof Element ? el.closest('[data-control]') : null
      return pad instanceof HTMLElement ? pad.dataset['control'] ?? null : null
    }
    const pdown = (e: PointerEvent) => {
      if (!this.enabled) return
      const c = controlAt(e.clientX, e.clientY)
      if (!c) return
      e.preventDefault()
      if (c === 'stage') {
        this.stageLatch = true
        this.touch.set(e.pointerId, 'stage')
      } else this.touch.set(e.pointerId, c)
      this.syncPads()
    }
    const pmove = (e: PointerEvent) => {
      if (!this.touch.has(e.pointerId)) return
      const c = controlAt(e.clientX, e.clientY)
      const prev = this.touch.get(e.pointerId)
      if (c && c !== prev && c !== 'stage') {
        this.touch.set(e.pointerId, c)
        this.syncPads()
      }
    }
    const pup = (e: PointerEvent) => {
      if (this.touch.delete(e.pointerId)) this.syncPads()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('pointerdown', pdown, { passive: false })
    document.addEventListener('pointermove', pmove, { passive: true })
    document.addEventListener('pointerup', pup)
    document.addEventListener('pointercancel', pup)
    this.cleanups.push(
      () => window.removeEventListener('keydown', down),
      () => window.removeEventListener('keyup', up),
      () => window.removeEventListener('blur', blur),
      () => document.removeEventListener('pointerdown', pdown),
      () => document.removeEventListener('pointermove', pmove),
      () => document.removeEventListener('pointerup', pup),
      () => document.removeEventListener('pointercancel', pup),
    )
  }

  private isHeld(k: Key) {
    if (this.held.has(k)) return true
    for (const v of this.touch.values()) if (v === k) return true
    return false
  }

  /** light up pads directly (no UI round-trip) so feedback is instant */
  private syncPads() {
    const active = new Set(this.touch.values())
    document.querySelectorAll<HTMLElement>('[data-control]').forEach(el => {
      el.classList.toggle('is-held', active.has(el.dataset['control'] ?? ''))
    })
  }

  read(): Controls {
    const stage = this.stageLatch
    this.stageLatch = false
    if (!this.enabled) return { q: false, w: false, o: false, p: false, stage: false }
    return { q: this.isHeld('q'), w: this.isHeld('w'), o: this.isHeld('o'), p: this.isHeld('p'), stage }
  }

  reset() {
    this.held.clear()
    this.touch.clear()
    this.stageLatch = false
    this.syncPads()
  }

  dispose() {
    this.cleanups.forEach(f => f())
  }
}
