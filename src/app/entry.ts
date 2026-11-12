import { Runtime } from 'foldkit'
import { Option } from 'effect'

import { Model, init, subscriptions, update, view } from './main'
import { getGame } from './gameHost'
import './styles.css'

// iOS: audio may only start inside a real user gesture, so unlock on the first touch/key directly.
const unlock = () => Option.map(getGame(), g => g.unlockAudio())
window.addEventListener('pointerdown', unlock, { capture: true })
window.addEventListener('keydown', unlock, { capture: true })
// stop iOS pinch / double-tap zoom and rubber-band scrolling
document.addEventListener('gesturestart', e => e.preventDefault())
document.addEventListener('dblclick', e => e.preventDefault())
// ...except inside overlay panels, which must scroll by touch
document.addEventListener(
  'touchmove',
  e => {
    if (e.target instanceof Element && e.target.closest('[data-scroll]')) return
    e.preventDefault()
  },
  { passive: false },
)

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById('root'),
})

Runtime.run(application)

if (new URLSearchParams(location.search).has('debug')) {
  ;(window as unknown as { __game: () => unknown }).__game = () => Option.getOrNull(getGame())
}
