// Descent-guidance map: screenshots mid-descent at desktop / phone landscape / phone portrait,
// plus overlap checks against the rest of the HUD and the control strip.
import { chromium } from 'playwright'
const base = process.env.URL ?? 'http://localhost:4173/?debug'
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
  env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' },
})
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const sizes = [
  ['desktop', 1440, 900, false, 'high'],
  ['landscape', 852, 393, true, 'medium'],
  ['portrait', 393, 852, true, 'medium'],
]
const OTHERS = '.hud-top, .panel-left .gauge, .panel-left .fuel, .panel-left .tilt, .panel-right .ladder, .panel-right .readout, .timeline-clock, .timeline-track, .corner-buttons, .pad, .prompt, .callouts > *, .rotate-hint'
const measure = page => page.evaluate(sel => {
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, name: el.className.baseVal ?? el.className } }
  const g = document.querySelector('.guide-col')
  return {
    guide: g && vis(g) ? rect(g) : null,
    status: document.querySelector('.guide-status')?.textContent ?? '',
    others: [...document.querySelectorAll(sel)].filter(vis).map(rect),
    vw: innerWidth, vh: innerHeight,
  }
}, OTHERS)
for (const [name, width, height, touch, tier] of sizes) {
  const ctx = await browser.newContext(touch
    ? { viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width, height } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('pageerror', String(e)))
  await page.goto(`${base}&tier=${tier}`)
  await page.waitForSelector('.overlay-title', { timeout: 90000 })
  await page.waitForTimeout(1000)
  await (touch ? page.tap('button:has-text("LAUNCH")') : page.click('button:has-text("LAUNCH")'))
  await page.waitForTimeout(500)
  await page.evaluate(() => { const g = window.__game(); g.startMission(7); g.debugAutopilot(true) })
  const stages = [
    ['ascent', "s.booster.y > 1500", false],
    ['boostback', "!s.stacked && s.phase === 'Return' && s.booster.vy > 5", true],
    ['descent', "!s.stacked && s.phase === 'Return' && s.booster.vy < 0 && s.booster.y < 2200", true],
    ['final', "s.phase === 'Return' && s.booster.y < 500", true],
  ]
  for (const [label, until, expectGuide] of stages) {
    await page.evaluate(u => window.__game().debugFastForward(400, new Function('s', `return ${u}`)), until)
    await page.waitForTimeout(350)
    const m = await measure(page)
    check(!!m.guide === expectGuide, `${name}/${label}: guidance ${expectGuide ? 'shown' : 'hidden'} ${m.status}`)
    if (m.guide) {
      const g = m.guide
      const hits = m.others.filter(o => o.l < g.r && g.l < o.r && o.t < g.b && g.t < o.b).map(o => o.name)
      check(hits.length === 0, `${name}/${label}: guidance overlaps nothing ${hits.join('; ')}`)
      check(g.l >= 0 && g.t >= 0 && g.r <= m.vw && g.b <= m.vh, `${name}/${label}: guidance inside viewport`)
    }
    if (expectGuide) await page.screenshot({ path: `shots/guide-${name}-${label}.png` })
  }
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
