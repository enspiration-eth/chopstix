// Proves the failure mode and the fix: one NaN/Inf fragment + bloom => black frame, unless sanitized.
import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
await page.goto((process.env.URL ?? 'http://localhost:4173/') + '?debug&tier=high')
await page.waitForSelector('.overlay-title', { timeout: 60000 })
await page.waitForTimeout(1500)
const mean = () => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
  const c = document.querySelector('canvas'); const o = document.createElement('canvas'); o.width = 80; o.height = 50
  const x = o.getContext('2d'); x.drawImage(c, 0, 0, 80, 50); const d = x.getImageData(0, 0, 80, 50).data
  let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; res(s / (d.length / 4))
}))))
const run = async (label, on, sanitize) => {
  await page.evaluate(([a, b]) => window.__game().debugInjectNaN(a, b), [on, sanitize])
  await page.waitForTimeout(600)
  const m = await mean(); console.log(label, m.toFixed(1)); return m
}
const base = await run('clean frame', false, true)
const unsafe = await run('NaN quad, sanitize OFF', true, false)
await page.screenshot({ path: 'shots/nan-unsanitized.png' })
const safe = await run('NaN quad, sanitize ON ', true, true)
await page.screenshot({ path: 'shots/nan-sanitized.png' })
console.log(unsafe < base * 0.3 ? 'reproduced: NaN blackens frame without the guard' : 'NaN did not blacken frame in this renderer')
console.log(safe > base * 0.8 ? 'PASS sanitize keeps the frame' : 'FAIL sanitize')
await browser.close()
