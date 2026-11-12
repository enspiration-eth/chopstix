// Holds Q+P on desktop and samples frames to detect black (or NaN-flooded) output.
import { chromium } from 'playwright'
const url = process.env.URL ?? 'http://localhost:4173/?debug&tier=high'
const secs = Number(process.env.SECS ?? 12)
const gl = process.env.GL ?? 'swiftshader'
// GL=llvmpipe uses Mesa through ANGLE's GL backend, which keeps IEEE NaN/Inf semantics like a real GPU
// (SwiftShader quietly flushes them, so it can't reproduce the black frames).
const args = gl === 'swiftshader'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ args, env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' } })
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) } })
const logs = []
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', e => logs.push(`pageerror: ${e}`))
await page.goto(url)
await page.waitForSelector('.overlay-title', { timeout: 60000 })
await page.waitForTimeout(2500)
// pin the HIGH tier (bloom on) even though software GL is slow, on old builds too
const pin = () => page.evaluate(() => { const g = window.__game(); g.governor.tier = 2; g.governor.settle = 1e9; g.applyTier() })
await pin()
if (process.env.NOSAN) await page.evaluate(() => window.__game().debugInjectNaN(false, false))
console.log('renderer', await page.evaluate(() => { const g = document.querySelector('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL) }))
// sample the WebGL canvas centre region by copying it into a 2D canvas right after a frame renders
const sample = () => page.evaluate(() => new Promise(res => requestAnimationFrame(() => {
  const c = document.querySelector('canvas')
  const lost = c.getContext('webgl2')?.isContextLost?.() ?? null
  const o = document.createElement('canvas'); o.width = 96; o.height = 60
  const x = o.getContext('2d'); x.drawImage(c, 0, 0, 96, 60)
  const d = x.getImageData(0, 0, 96, 60).data
  let sum = 0, black = 0
  for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; if (l < 6) black++ }
  res({ mean: sum / (d.length / 4), blackFrac: black / (d.length / 4), lost, display: getComputedStyle(c).display, opacity: getComputedStyle(c).opacity })
})))
console.log('title', JSON.stringify(await sample()))
await page.click('button:has-text("LAUNCH")')
await page.waitForTimeout(800)
await pin()
const tier = await page.evaluate(() => window.__game().qualityName)
console.log('tier', tier)
await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyP')
let bad = 0, n = 0
const t0 = Date.now()
while (Date.now() - t0 < secs * 1000) {
  const s = await sample(); n++
  const st = await page.evaluate(() => { const s = window.__game().debugState(); return { met: s.met.toFixed(1), phase: s.phase, y: s.booster.y.toFixed(0), th: s.booster.theta.toFixed(2), nan: !Number.isFinite(s.booster.y + s.booster.x + s.booster.theta + s.booster.vx + s.booster.vy) } })
  if (s.mean < 12 || s.blackFrac > 0.6) bad++
  console.log(((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(s), JSON.stringify(st))
  if (n === 6) await page.screenshot({ path: 'shots/desktop-qp-held.png' })
}
await page.screenshot({ path: 'shots/desktop-qp-held-end.png' })
console.log(`black frames ${bad}/${n}`)
console.log(logs.filter(l => !l.startsWith('log')).slice(0, 15).join('\n'))
await browser.close()
process.exit(bad ? 1 : 0)
