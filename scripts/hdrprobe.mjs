import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
await page.goto('http://localhost:4173/?debug&tier=high')
await page.waitForSelector('.overlay-title', { timeout: 60000 })
await page.waitForTimeout(1500)
console.log('title', JSON.stringify(await page.evaluate(() => window.__game().debugHdrProbe())))
await page.click('button:has-text("LAUNCH")')
await page.waitForTimeout(800)
console.log('pad idle', JSON.stringify(await page.evaluate(() => window.__game().debugHdrProbe())))
await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyP')
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(1500)
  const r = await page.evaluate(() => ({ p: window.__game().debugHdrProbe(), y: window.__game().debugState().booster.y.toFixed(0) }))
  console.log('Q+P', JSON.stringify(r))
}
await browser.close()
