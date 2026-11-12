// Cloud screenshots at fixed moments of one deterministic flight (seed 7, autopilot), with frame timing.
// PREFIX=before|after  MOBILE=1 for an iPhone-landscape viewport. Uses Mesa llvmpipe (GL=swiftshader to override).
import { chromium } from 'playwright'
const prefix = process.env.PREFIX ?? 'after'
const mobile = !!process.env.MOBILE
const url = process.env.URL ?? `http://localhost:4173/?debug&tier=${process.env.TIER ?? (mobile ? 'medium' : 'high')}`
const gl = process.env.GL ?? 'llvmpipe'
const args = gl === 'swiftshader'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ args, env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' } })
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('pageerror', String(e)))
await page.goto(url)
await page.waitForSelector('.overlay-title', { timeout: 90000 })
await page.waitForTimeout(1500)
await page.click('button:has-text("LAUNCH")')
await page.waitForTimeout(500)
await page.evaluate(() => { const g = window.__game(); g.startMission(7); g.debugAutopilot(true) })
const frameMs = () => page.evaluate(() => new Promise(res => {
  const ts = []; const f = t => { ts.push(t); if (ts.length < 25) requestAnimationFrame(f); else { const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); res(d[Math.floor(d.length / 2)]) } }
  requestAnimationFrame(f)
}))
const stages = [
  ['1-pad', null, 2500],
  ['2-deck-punch', "s.booster.y > 2640", 250],
  ...(process.env.EXTRA ? [['2b-sea-of-clouds', "s.booster.y > 3400 && s.booster.vy < 40", 100]] : []),
  ['3-above-deck', "s.phase === 'Return' && s.booster.vy < 0 && s.booster.y < 3600", 1200],
  ['4-landing-approach', "s.phase === 'Return' && s.booster.y < 1150", 900],
]
const pfx = mobile ? 'mobile-' : ''
for (const [name, until, wait] of stages) {
  if (until) await page.evaluate(u => window.__game().debugFastForward(400, new Function('s', `return ${u}`)), until)
  await page.waitForTimeout(wait)
  const ms = await frameMs()
  const st = await page.evaluate(() => { const s = window.__game().debugState(); return `${s.phase} y=${s.booster.y.toFixed(0)}` })
  await page.screenshot({ path: `shots/clouds-${prefix}-${pfx}${name}.png` })
  console.log(`${prefix} ${pfx}${name}: ${st}, median frame ${ms.toFixed(1)} ms, tier ${await page.evaluate(() => window.__game().qualityName)}`)
}
await browser.close()
