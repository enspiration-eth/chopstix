// Look straight-ish down on the clouds from high altitude with the debug camera, to expose tiling.
// PREFIX=before|after. Writes shots/highalt-{prefix}-{alt}km.png. Mesa llvmpipe, HIGH tier.
import { chromium } from 'playwright'
const prefix = process.env.PREFIX ?? 'after'
const url = process.env.URL ?? 'http://localhost:4173/?debug&tier=high'
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
  env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe' },
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('pageerror', String(e)))
await page.goto(url)
await page.waitForSelector('.overlay-title', { timeout: 90000 })
await page.waitForTimeout(1000)
// hide the UI so only the scene is in the frame
await page.addStyleTag({ content: '.overlay, .corner-buttons, .rotate-hint, .scrim { display: none !important; }' })
for (const km of [10, 25, 60]) {
  const h = km * 1000
  // slightly tilted down-look, offset so the view sweeps over open country and sea
  await page.evaluate(h => window.__game().debugCamera([3000, h, h * 0.35], [3000, 0, -h * 0.05]), h)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `shots/highalt-${prefix}-${km}km.png` })
  console.log(`${prefix} ${km} km done`)
}
await browser.close()
