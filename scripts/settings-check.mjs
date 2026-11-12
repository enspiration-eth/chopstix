// Settings overlay: opens/closes (button, gear, S key, close button, backdrop, Esc), scrolls on phones,
// persists across reloads, a forced tier sticks while the adaptive one would step down, and Swap W/O
// mirrors the nose input. Runs on Mesa llvmpipe; no ?tier= pin so the setting is in charge.
import { chromium } from 'playwright'
const base = process.env.URL ?? 'http://localhost:4173/?debug'
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
  env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' },
})
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const sizes = [['desktop', 1440, 900, false], ['landscape', 852, 393, true], ['portrait', 393, 852, true]]
for (const [name, width, height, touch] of sizes) {
  const ctx = await browser.newContext(touch
    ? { viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width, height } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('pageerror', String(e)))
  const press = sel => (touch ? page.tap(sel) : page.click(sel))
  const visible = sel => page.isVisible(sel)
  const ready = async () => { await page.waitForSelector('.overlay-title', { timeout: 90000 }); await page.waitForTimeout(800) }
  await page.goto(base); await ready()
  await page.evaluate(() => localStorage.clear()); await page.reload(); await ready()

  // open from the title, close three ways
  await press('button:has-text("SETTINGS")'); await page.waitForTimeout(400)
  check(await visible('.overlay-settings'), `${name}: SETTINGS button opens the panel`)
  check(await page.$eval('[data-quality="Auto"]', e => e.getAttribute('aria-checked')) === 'true', `${name}: Auto is the default`)
  // scrolls/fits: the DONE row can be reached
  const sc = await page.$eval('.overlay-settings .panel-scroll', el => { const before = { sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }; el.scrollTop = el.scrollHeight; return before })
  await page.waitForTimeout(200)
  const doneIn = await page.$eval('.overlay-settings .row', el => { const r = el.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0 })
  check((sc.sh <= sc.ch + 1 || sc.oy === 'auto') && doneIn, `${name}: panel fits or scrolls, DONE reachable ${JSON.stringify(sc)}`)
  await page.$eval('.overlay-settings .panel-scroll', el => { el.scrollTop = 0 })
  await page.screenshot({ path: `shots/settings-${name}.png` })
  await press('.overlay-settings .panel-close'); await page.waitForTimeout(400)
  check(await visible('.overlay-title') && !(await visible('.overlay-settings')), `${name}: close button returns to title`)
  await press('button:has-text("SETTINGS")'); await page.waitForTimeout(400)
  if (touch) await page.touchscreen.tap(3, Math.round(height / 2)); else await page.mouse.click(3, Math.round(height / 2))
  await page.waitForTimeout(400)
  check(await visible('.overlay-title') && !(await visible('.overlay-settings')), `${name}: backdrop tap closes`)
  await page.keyboard.press('s'); await page.waitForTimeout(400)
  check(await visible('.overlay-settings'), `${name}: S key opens`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  check(await visible('.overlay-title') && !(await visible('.overlay-settings')), `${name}: Esc closes`)

  // change both settings, reload, check they stuck
  await press('button:has-text("SETTINGS")'); await page.waitForTimeout(300)
  await press('[data-quality="High"]'); await page.waitForTimeout(200)
  await press('[data-setting="swap-nose"]'); await page.waitForTimeout(900)
  await page.screenshot({ path: `shots/settings-${name}-changed.png` })
  await page.reload(); await ready()
  await press('button:has-text("SETTINGS")'); await page.waitForTimeout(300)
  const st = await page.evaluate(() => ({
    high: document.querySelector('[data-quality="High"]')?.getAttribute('aria-checked'),
    swap: document.querySelector('[data-setting="swap-nose"]')?.getAttribute('aria-checked'),
    tier: window.__game().qualityName, pinned: window.__game().qualityPinned,
  }))
  check(st.high === 'true' && st.swap === 'true' && st.tier === 'HIGH' && st.pinned === true, `${name}: settings persist after reload ${JSON.stringify(st)}`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // flight with swap ON: W should push the gimbal the way O normally does
  const noseDelta = async key => {
    await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyP'); await page.waitForTimeout(1800)
    const g0 = await page.evaluate(() => window.__game().debugState().gimbal)
    await page.keyboard.down(key); await page.waitForTimeout(500)
    const g1 = await page.evaluate(() => window.__game().debugState().gimbal)
    await page.keyboard.up(key); await page.keyboard.up('KeyQ'); await page.keyboard.up('KeyP')
    return g1 - g0
  }
  await press('button:has-text("LAUNCH")'); await page.waitForTimeout(800)
  const wLabelOn = await page.$eval('.pad-w .pad-label', e => e.textContent)
  const dOn = await noseDelta('KeyW')
  await page.waitForTimeout(6000)
  const t1 = await page.evaluate(() => ({ tier: window.__game().qualityName, fps: Math.round(1000 / window.__game().debugState?.().frameMs || 0) }))
  check(t1.tier === 'HIGH', `${name}: forced HIGH stays HIGH after ~9 s of slow software-GL frames (${t1.tier})`)
  check(wLabelOn === 'NOSE ▶', `${name}: swapped W pad is labelled NOSE ▶ (${wLabelOn})`)
  await page.screenshot({ path: `shots/settings-${name}-swapped-pads.png` })
  const clash = await page.evaluate(() => {
    const R = el => el.getBoundingClientRect()
    const corner = R(document.querySelector('.corner-buttons'))
    return [...document.querySelectorAll('.hud-top > *')].filter(el => { const r = R(el); return r.width > 0 && r.left < corner.right && corner.left < r.right && r.top < corner.bottom && corner.top < r.bottom }).map(el => el.className)
  })
  check(clash.length === 0, `${name}: gear/pause/mute clear of the HUD top bar ${clash.join(' ')}`)

  // gear in the HUD: swap OFF, back to Auto, restart, W again
  await press('[aria-label="Settings"]'); await page.waitForTimeout(400)
  check(await visible('.overlay-settings') && await visible('.hud'), `${name}: HUD gear opens settings over the paused flight`)
  await press('[data-setting="swap-nose"]'); await page.waitForTimeout(150)
  await press('[data-quality="Auto"]'); await page.waitForTimeout(300)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  check(await visible('.overlay-paused'), `${name}: Esc from in-flight settings returns to the pause menu`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.keyboard.press('r'); await page.waitForTimeout(800)
  const wLabelOff = await page.$eval('.pad-w .pad-label', e => e.textContent)
  const dOff = await noseDelta('KeyW')
  console.log(`${name}: gimbal change from W  swap on ${dOn.toFixed(3)}  swap off ${dOff.toFixed(3)}`)
  check(Math.abs(dOn) > 0.005 && Math.abs(dOff) > 0.005 && Math.sign(dOn) === -Math.sign(dOff), `${name}: Swap W/O mirrors the W input`)
  check(wLabelOff === 'NOSE ◀', `${name}: unswapped W pad is labelled NOSE ◀ (${wLabelOff})`)
  await page.waitForTimeout(6000)
  const t2 = await page.evaluate(() => ({ tier: window.__game().qualityName, pinned: window.__game().qualityPinned }))
  console.log(`${name}: Auto after ~9 s on software GL: ${JSON.stringify(t2)}`)
  check(t2.pinned === false, `${name}: Auto hands the tier back to the governor`)
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
