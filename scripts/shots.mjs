// Headless visual check: boots the built game, flies the autopilot and screenshots each act.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173/?debug'
const out = process.argv[3] ?? 'shots'
const viewport = process.env.MOBILE ? { width: 844, height: 390 } : { width: 1280, height: 720 }
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: !!process.env.MOBILE, isMobile: !!process.env.MOBILE })
const logs = []
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))
await page.goto(url)
await page.waitForSelector('.overlay-title', { timeout: 60000 })
await page.waitForTimeout(9000)
const prefix = process.env.MOBILE ? `${out}/mobile-` : `${out}/`
await page.screenshot({ path: `${prefix}01-title.png` })

const ff = async (sec, cond) =>
  page.evaluate(([s, c]) => {
    const g = window.__game()
    const until = c ? new Function('s', `return ${c}`) : undefined
    g.debugFastForward(s, until)
  }, [sec, cond])

await page.click('button:has-text("LAUNCH")')
await page.waitForTimeout(400)
await page.evaluate(() => { const g = window.__game(); g.startMission(7); g.debugAutopilot(true) })
await page.waitForTimeout(4500)
await page.screenshot({ path: `${prefix}02-liftoff.png` })

if (process.env.QUICK) { console.log(logs.join('\n')); await browser.close(); process.exit(0) }
await ff(40, "s.booster.y > 900")
await page.waitForTimeout(1500)
await page.screenshot({ path: `${prefix}03-clouds.png` })

await ff(60, "!s.stacked")
await page.waitForTimeout(1800)
await page.screenshot({ path: `${prefix}04-high-altitude-separation.png` })

await ff(200, "s.phase === 'Return' && s.booster.vy < 0 && s.booster.y < 700")
await page.waitForTimeout(2500)
await page.screenshot({ path: `${prefix}05-landing-burn.png` })

await ff(200, "s.phase === 'Return' && s.booster.y < 200")
await page.waitForTimeout(1200)
await page.screenshot({ path: `${prefix}06-final-approach.png` })

await ff(200, "s.phase !== 'Return'")
await page.waitForTimeout(2500)
await page.screenshot({ path: `${prefix}07-catch.png` })
await page.waitForTimeout(6000)
await page.screenshot({ path: `${prefix}08-result.png` })
const st = await page.evaluate(() => window.__game().debugState().phase)
console.log('final phase', st, await page.evaluate(() => document.querySelector('.quality')?.textContent))
console.log(logs.slice(0, 40).join('\n'))
await browser.close()
