import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const pages = ctx ? await ctx.pages() : []
console.log('pages:', pages.length)
for (const p of pages) {
  console.log(' - title:', await p.title())
  console.log('   url:', p.url())
}
if (!pages.length) {
  console.log('STATUS: NO_PAGES')
  process.exit(1)
}

let page =
  pages.find((p) => /TrueDeck/i.test(p.url()) || p.url().includes('index.html')) ||
  null
if (!page) {
  for (const p of pages) {
    if (/TrueDeck/i.test(await p.title())) {
      page = p
      break
    }
  }
}
page = page || pages[0]

await page.bringToFront().catch(() => {})
await page.evaluate(() => {
  try {
    window.focus()
  } catch {
    /* ignore */
  }
})

const title = await page.title()
const launch = await page.getByRole('button', { name: /Launch agent|New agent/i }).count()
const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500)
const hasDemo = /demo-project|PulseBoard/i.test(text)
console.log('activeTitle:', title)
console.log('launchButtons:', launch)
console.log('mentionsDemoProject:', hasDemo)
console.log('body:', text)
console.log(launch > 0 ? 'STATUS: READY' : 'STATUS: UI_LOADING')
process.exit(0)
