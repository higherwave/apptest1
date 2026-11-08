// The welcome screen and the two guided tours, as a read-only visitor (no token): the welcome opens by itself the first time, "Take a tour"
// reopens it, every step finds what it points at, and the card never covers it (on a wide screen and on a tablet in portrait).
// Started by e2e/run.mjs against the main test API. TOUR_SHOTS=<dir> saves a screenshot of every step.
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
const BASE = process.env.E2E_BASE || 'http://localhost:5198'
const SHOTS = process.env.TOUR_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
let failed = 0
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1400,1000', ...(process.env.CI ? ['--no-sandbox'] : [])] })
const text = (page) => page.evaluate(() => document.body.innerText)
const waitText = (page, t, timeout = 10000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout }, t)
const click = (page, testid) => page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`).click(), testid)
// Where the card and the lit window are, and what the card says.
const stepState = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="tour"] [role="dialog"]')
  const root = document.querySelector('[data-testid="tour"]')
  const spot = root.querySelector('div:nth-child(2)')
  const c = card.getBoundingClientRect()
  const s = spot.getBoundingClientRect()
  const lit = root.dataset.spot === 'true'
  return {
    title: card.querySelector('h2').innerText, eyebrow: card.querySelector('p').innerText, mode: card.dataset.mode, status: card.dataset.status, lit,
    card: { x: c.left, y: c.top, w: c.width, h: c.height }, spot: { x: s.left, y: s.top, w: s.width, h: s.height },
    overlap: lit && c.left < s.right && s.left < c.right && c.top < s.bottom && s.top < c.bottom,
    inView: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
    spotVisible: lit && s.bottom > 0 && s.top < innerHeight,
  }
})

async function walk(page, label, tourId, expectSteps) {
  await click(page, `start-${tourId}`)
  await page.waitForSelector('[data-testid="tour"] [role="dialog"]:not([data-status="finding"])', { timeout: 15000 })
  const seen = []
  for (let i = 0; i < 20; i++) {
    await page.waitForFunction(() => document.querySelector('[data-testid="tour"] [role="dialog"]')?.dataset.status !== 'finding', { timeout: 15000 })
    await new Promise((r) => setTimeout(r, 250))
    const st = await stepState(page)
    seen.push(st)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-${tourId}-${String(i + 1).padStart(2, '0')}.png` })
    const done = (await page.$eval('[data-testid="tour-next"]', (b) => b.innerText.trim())) === 'Done'
    if (done) { await click(page, 'tour-next'); break }
    const before = st.title
    await click(page, 'tour-next')
    await page.waitForFunction((t) => document.querySelector('[data-testid="tour"] h2')?.innerText !== t, { timeout: 8000 }, before)
  }
  ok(`${label}: the ${tourId} tour has ${expectSteps} steps and ends`, seen.length === expectSteps && !(await page.$('[data-testid="tour"]')), `${seen.length} seen`)
  ok(`${label}: the ${tourId} tour counts its steps ("Step 1 of ${expectSteps}")`, /step 1 of /i.test(seen[0].eyebrow) && seen.at(-1).eyebrow.toLowerCase().includes(`step ${expectSteps} of ${expectSteps}`))
  const missing = seen.map((s, i) => [s, i + 1]).filter(([s, i]) => s.status === 'center' && i !== seen.length)
  ok(`${label}: every step of the ${tourId} tour finds what it points at`, missing.length === 0, missing.map(([s, i]) => `${i} "${s.title}"`).join('; '))
  const covered = seen.map((s, i) => [s, i + 1]).filter(([s]) => s.overlap)
  ok(`${label}: the card never covers what the ${tourId} tour points at`, covered.length === 0, covered.map(([s, i]) => `${i} ${JSON.stringify([s.card, s.spot])}`).join('; '))
  const off = seen.map((s, i) => [s, i + 1]).filter(([s]) => !s.inView || (s.lit && !s.spotVisible))
  ok(`${label}: the card and the lit window are on screen at every step of the ${tourId} tour`, off.length === 0, off.map(([s, i]) => `${i} ${JSON.stringify([s.card, s.spot])}`).join('; '))
  return seen
}

try {
  for (const [label, viewport] of [['wide', { width: 1400, height: 900 }], ['tablet', { width: 820, height: 1180 }]]) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport(viewport)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/insights/themes`, { waitUntil: 'networkidle0' })

    // First visit: the welcome screen opens by itself, with both tours.
    await waitText(page, 'Welcome to Signal Flow')
    const t = await text(page)
    ok(`${label}: a first-time visitor is welcomed, with both tours to pick from`, t.includes('The view from the top') && t.includes('From conversation to Jira ticket') && t.includes('Anchor CX'))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-welcome.png` })

    // Skipping it keeps it away on the next visit, and "Take a tour" brings it back.
    await click(page, 'welcome-skip')
    await new Promise((r) => setTimeout(r, 500))
    await page.reload({ waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 800))
    ok(`${label}: after "Explore on my own" the welcome does not open again by itself`, !(await text(page)).includes('Welcome to Signal Flow') || !(await page.$('.cds--modal.is-visible')))
    await click(page, 'take-a-tour')
    await page.waitForSelector('.cds--modal.is-visible', { timeout: 5000 })
    ok(`${label}: "Take a tour" in the header reopens the welcome`, (await text(page)).includes('Welcome to Signal Flow'))

    await walk(page, label, 'insights', 8)
    await click(page, 'take-a-tour')
    await page.waitForSelector('.cds--modal.is-visible', { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 400))
    ok(`${label}: a finished tour is marked on the welcome screen`, await page.evaluate(() => !!document.querySelector('.cds--modal.is-visible [aria-label="Finished"]')))
    await walk(page, label, 'project', 9)

    // Escape ends a tour at once.
    await click(page, 'take-a-tour')
    await new Promise((r) => setTimeout(r, 400))
    await click(page, 'start-insights')
    await page.waitForSelector('[data-testid="tour"] [role="dialog"]:not([data-status="finding"])', { timeout: 15000 })
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 300))
    ok(`${label}: Escape ends the tour`, !(await page.$('[data-testid="tour"]')))
    ok(`${label}: no page errors during the tours`, errors.length === 0, errors.join('; '))
    await context.close()
  }
} catch (err) {
  failed++
  console.log(`  FAIL tour flow did not finish — ${err.message}`)
}
await browser.close()
console.log(failed ? `\n${failed} failed` : '\nAll tour checks passed')
process.exit(failed ? 1 : 0)
