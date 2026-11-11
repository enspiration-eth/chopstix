import { chromium } from 'playwright'
const url = process.env.URL ?? 'https://enspiration-eth.github.io/chopstix/'
const mobile = !!process.env.MOBILE
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage(mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const res = await page.goto(url)
console.log('status', res.status())
await page.waitForTimeout(9000)
await page.screenshot({ path: `shots/live-${mobile ? 'mobile-' : ''}title.png` })
await page.click('button:has-text("LAUNCH")')
await page.keyboard.down('KeyQ'); await page.keyboard.down('KeyP')
await page.waitForTimeout(5000)
await page.screenshot({ path: `shots/live-${mobile ? 'mobile-' : ''}flight.png` })
console.log('errors', JSON.stringify(errors))
await browser.close()
