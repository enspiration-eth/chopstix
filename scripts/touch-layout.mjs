// Checks the touch pads never cover HUD elements and that everything stays on screen.
import { chromium } from 'playwright'
const url = process.env.URL ?? 'http://localhost:4173/?debug&tier=low' // layout checks: the cheapest tier keeps SwiftShader fast
const sizes = [['landscape', 852, 393], ['portrait', 393, 852]]
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const HUD = '.hud-top, .hud-top > *, .panel-left .gauge, .panel-left .fuel, .panel-left .tilt, .panel-right .ladder, .panel-right .readout, .timeline-clock, .timeline-track, .callouts > *, .catch-box, .guide-col, .prompt, .corner-buttons'
const measure = page => page.evaluate(hud => {
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, name: el.className } }
  return {
    pads: [...document.querySelectorAll('.pad')].filter(vis).map(rect),
    hud: [...document.querySelectorAll(hud)].filter(vis).map(rect),
    vw: innerWidth, vh: innerHeight,
  }
}, HUD)
for (const [name, width, height] of sizes) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(url)
  await page.waitForSelector('.overlay-title', { timeout: 60000 })
  await page.waitForTimeout(1200)
  await page.tap('button:has-text("LAUNCH")')
  await page.waitForTimeout(600)
  await page.evaluate(() => { const g = window.__game(); g.startMission(7); g.debugAutopilot(true) })
  const stages = [
    ['pad', 300, null],
    ['ascent', 3500, null],
    ['final', 1800, "s.phase === 'Return' && s.booster.y < 700"],
  ]
  for (const [label, wait, until] of stages) {
    if (until) await page.evaluate(u => window.__game().debugFastForward(300, new Function('s', `return ${u}`)), until)
    await page.waitForTimeout(wait + 700)
    const m = await measure(page)
    const hits = []
    for (const p of m.pads) for (const h of m.hud) if (p.l < h.r && h.l < p.r && p.t < h.b && h.t < p.b) hits.push(`${p.name} × ${h.name}`)
    const off = [...m.pads, ...m.hud].filter(r => r.l < -0.5 || r.t < -0.5 || r.r > m.vw + 0.5 || r.b > m.vh + 0.5).map(r => r.name)
    console.log(`${name}/${label}: ${m.pads.length} pads, ${m.hud.length} HUD rects`)
    check(m.pads.length >= 4, `${name}/${label}: pads present`)
    check(hits.length === 0, `${name}/${label}: no pad overlaps HUD ${hits.join('; ')}`)
    check(off.length === 0, `${name}/${label}: all inside viewport ${off.join('; ')}`)
    const minPad = Math.min(...m.pads.filter(p => !p.name.includes('stage')).map(p => Math.min(p.r - p.l, p.b - p.t)))
    check(minPad >= 56, `${name}/${label}: thumb pads >= 56px (min ${minPad.toFixed(0)})`)
    await page.screenshot({ path: `shots/touch-${name}-${label}.png` })
  }
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
