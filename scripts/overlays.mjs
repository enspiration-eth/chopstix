// Touch-emulated check that every dismissible overlay scrolls inside its panel and can be closed.
import { chromium } from 'playwright'
const url = process.env.URL ?? 'http://localhost:4173/?debug&tier=low' // layout checks: the cheapest tier keeps SwiftShader fast
const sizes = [['landscape', 852, 393], ['portrait', 393, 852]]
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
for (const [name, width, height] of sizes) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await page.goto(url)
  await page.waitForSelector('.overlay-title', { timeout: 60000 })
  await page.waitForTimeout(1500)
  await page.tap('button:has-text("HOW TO FLY")')
  await page.waitForSelector('.overlay-howto .panel-scroll')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `shots/howto-${name}-top.png` })
  const m = await page.$eval('.overlay-howto .panel-scroll', el => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  console.log(name, 'panel', JSON.stringify(m))
  // real touch drag via CDP (goes through touchmove + native scrolling)
  const box = await page.$eval('.overlay-howto .panel-scroll', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height } })
  // real finger drags (touchstart/touchmove/touchend), so the global touchmove guard is exercised
  for (let i = 0; i < 4 && m.sh > m.ch; i++) {
    const x = Math.round(box.x), y0 = Math.round(box.y + box.h * 0.3)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
    for (let k = 1; k <= 15; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - Math.round((box.h * 0.5 * k) / 15) }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(250)
  }
  const after = await page.$eval('.overlay-howto .panel-scroll', el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }))
  console.log(name, 'after touch scroll', JSON.stringify(after))
  check(m.sh <= m.ch || after.top >= after.max - 2, `${name}: how-to panel reaches the bottom by touch`)
  const backVisible = await page.$eval('.overlay-howto .row', el => el.getBoundingClientRect().bottom <= innerHeight + 1)
  await page.screenshot({ path: `shots/howto-${name}-bottom.png` })
  check(backVisible, `${name}: BACK button visible at bottom`)
  // the sticky close button is still on screen after scrolling
  const closeIn = await page.$eval('.panel-close', el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth })
  check(closeIn, `${name}: close button stays in view`)
  await page.waitForTimeout(600)
  await page.tap('.panel-close')
  await page.waitForTimeout(500)
  check(await page.isVisible('.overlay-title'), `${name}: close button returns to title`)
  // backdrop tap
  await page.tap('button:has-text("HOW TO FLY")'); await page.waitForTimeout(500)
  await page.touchscreen.tap(4, Math.round(height / 2)); await page.waitForTimeout(400)
  check(await page.isVisible('.overlay-title'), `${name}: backdrop tap returns to title`)
  // Esc
  await page.tap('button:has-text("HOW TO FLY")'); await page.waitForTimeout(400)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  check(await page.isVisible('.overlay-title'), `${name}: Esc returns to title`)
  // title panel itself must fit or scroll
  const t = await page.$eval('.overlay-title .panel-scroll', el => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }))
  check(t.sh <= t.ch + 1 || t.oy === 'auto', `${name}: title panel fits or scrolls ${JSON.stringify(t)}`)
  // pause overlay
  await page.tap('button:has-text("LAUNCH")'); await page.waitForTimeout(1500)
  await page.tap('[aria-label="Pause"]'); await page.waitForTimeout(500)
  await page.screenshot({ path: `shots/paused-${name}.png` })
  const p = await page.$eval('.overlay-paused .panel-scroll', el => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  check(p.sh <= p.ch + 1, `${name}: pause panel fits ${JSON.stringify(p)}`)
  await page.tap('.panel-close'); await page.waitForTimeout(400)
  check(await page.isVisible('.hud-bottom'), `${name}: close on pause resumes`)
  // result overlay: fast-forward a crash
  await page.evaluate(() => { const g = window.__game(); g.debugAutopilot(true); g.debugFastForward(400, s => s.phase === 'Crashed' || s.phase === 'Caught' || s.phase === 'Touchdown') })
  await page.waitForSelector('.overlay-result', { timeout: 30000 })
  await page.waitForTimeout(600)
  const r = await page.$eval('.overlay-result .panel-scroll', el => { el.scrollTop = 1e6; return { sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop } })
  await page.screenshot({ path: `shots/result-${name}.png` })
  check(r.sh <= r.ch + 1 || r.top > 0, `${name}: result panel fits or scrolls ${JSON.stringify(r)}`)
  check(await page.isVisible('.overlay-result button:has-text("MENU")'), `${name}: result MENU reachable`)
  await page.tap('.overlay-result .panel-close'); await page.waitForTimeout(400)
  check(await page.isVisible('.overlay-title'), `${name}: result close returns to title`)
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
