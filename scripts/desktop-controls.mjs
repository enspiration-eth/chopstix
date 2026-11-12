// Desktop (no touch): control strip visible, below the HUD, lights up for keys and works with the mouse.
import { chromium } from 'playwright'
const url = process.env.URL ?? 'http://localhost:4173/?debug&tier=high'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'], env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' } })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
await page.goto(url)
await page.waitForSelector('.overlay-title', { timeout: 60000 })
await page.waitForTimeout(1500)
await page.click('button:has-text("LAUNCH")')
await page.waitForSelector('.pads .pad')
await page.waitForTimeout(800)
const held = () => page.$$eval('.pad.is-held', els => els.map(e => e.dataset.control).sort().join(','))
const HUD = '.hud-top, .panel-left .gauge, .panel-left .fuel, .panel-left .tilt, .panel-left .engine-map, .panel-right .ladder, .panel-right .readout, .timeline-clock, .timeline-track, .callouts > *, .prompt, .corner-buttons'
const overlaps = () => page.evaluate(hud => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' }
  const R = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, n: el.className } }
  const pads = [...document.querySelectorAll('.pad')].filter(vis).map(R)
  const hudR = [...document.querySelectorAll(hud)].filter(vis).map(R)
  const hits = []
  for (const p of pads) for (const h of hudR) if (p.l < h.r && h.l < p.r && p.t < h.b && h.t < p.b) hits.push(`${p.n} x ${h.n}`)
  const off = pads.filter(p => p.l < 0 || p.t < 0 || p.r > innerWidth || p.b > innerHeight).map(p => p.n)
  return { pads: pads.length, labels: [...document.querySelectorAll('.pad-key')].map(e => e.textContent), hits, off }
}, HUD)
const o = await overlaps()
console.log(JSON.stringify(o))
check(o.pads >= 4, 'desktop pads visible')
check(o.hits.length === 0 && o.off.length === 0, 'pads below HUD, nothing overlapping, inside viewport')
await page.screenshot({ path: 'shots/desktop-controls.png' })
await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyP')
await page.waitForTimeout(500)
check((await held()) === 'p,q', `Q+P keys light the Q and P pads (${await held()})`)
await page.waitForTimeout(5000)
check((await page.$$('.pad-stage')).length === 1, 'STAGE pad appears after liftoff')
await page.keyboard.down('KeyW'); await page.waitForTimeout(300)
check((await held()) === 'p,q,w', `W key lights W (${await held()})`)
await page.screenshot({ path: 'shots/desktop-qp-held-midflight.png' })
const o2 = await overlaps()
check(o2.hits.length === 0 && o2.off.length === 0 && o2.pads === 5, `mid-flight: 5 pads, no overlap ${o2.hits.join('; ')}`)
await page.keyboard.up('KeyW')
await page.keyboard.down('Space'); await page.waitForTimeout(250)
check((await held()).includes('stage'), 'Space lights STAGE')
await page.keyboard.up('Space')
await page.keyboard.up('KeyQ'); await page.keyboard.up('KeyP'); await page.waitForTimeout(300)
check((await held()) === '', 'pads go dark when keys are released')
// mouse: press and hold the O pad
const box = await (await page.$('.pad-o')).boundingBox()
const g0 = await page.evaluate(() => window.__game().debugState().gimbal)
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down(); await page.waitForTimeout(600)
const g1 = await page.evaluate(() => window.__game().debugState().gimbal)
check((await held()) === 'o', `mouse press lights O (${await held()})`)
console.log('gimbal before/after mouse O', g0, g1)
check(typeof g1 === "number" && g1 !== g0, 'mouse press on O drives the gimbal')
await page.mouse.up(); await page.waitForTimeout(300)
check((await held()) === '', 'mouse release clears O')
await browser.close()
process.exit(failed ? 1 : 0)
