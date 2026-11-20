// Pulse (preview): invisible until an owner switches it on in Admin, Previews; then an owner sees it in the menu and can add signals and notes, keep and dismiss them;
// a read-only visitor never sees it, and switching it off hides it again. Started by e2e/run.mjs against the main test API.
import puppeteer from 'puppeteer-core'
const BASE = process.env.E2E_BASE || 'http://localhost:5198'
const TOKEN = process.env.E2E_TOKEN || 'e2e-token'
let failed = 0
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1400,1000', ...(process.env.CI ? ['--no-sandbox'] : [])] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const text = (page) => page.evaluate(() => document.body.innerText)
const waitText = (page, t, timeout = 10000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout }, t)
// A button is clicked once it is enabled (one is briefly disabled while a change saves).
const click = async (page, testid) => {
  await page.waitForFunction((id) => { const el = document.querySelector(`[data-testid="${id}"]`); return !!el && !el.disabled }, { timeout: 8000 }, testid)
  await page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`); el.scrollIntoView({ block: 'center' }); el.click() }, testid)
}
const menu = (page) => page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Navigation"] a')].map((a) => a.getAttribute('data-label')))
const open = async (token, path) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1400, height: 1000 })
  await page.evaluateOnNewDocument((t) => {
    try { localStorage.setItem('signal-flow-tour', JSON.stringify({ welcomed: true, finished: [] })) } catch { /* ignore */ }
    if (t) { try { sessionStorage.setItem('signalflow.editToken', t) } catch { /* ignore */ } }
  }, token)
  page.on('pageerror', (e) => ok('no page errors', false, e.message))
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
  return page
}

try {
  // Off by default: not in the menu, and the address shows a page that does not exist.
  let page = await open(TOKEN, '/projects')
  ok('Pulse is not in the menu while the preview is off', !(await menu(page)).includes('Pulse'))
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  ok('and /pulse is a page that does not exist', (await text(page)).includes('Page not found'))

  // An owner switches it on in Admin, Previews.
  await page.goto(`${BASE}/settings/preview`, { waitUntil: 'networkidle0' })
  await waitText(page, 'Show Pulse (preview)')
  ok('Admin has a Previews tab with the Pulse switch, off', await page.evaluate(() => document.querySelector('[data-testid="preview-pulse"]').getAttribute('aria-checked') === 'false' && !!document.querySelector('[aria-label="Admin sections"]').innerText.includes('Previews')))
  await click(page, 'preview-pulse')
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-pulse"]')?.getAttribute('aria-checked') === 'true', { timeout: 8000 })
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  ok('with it on, Pulse is in the menu for the owner', (await menu(page)).includes('Pulse'))

  // The page: empty, then a signal typed in (kept at once), then notes (wait for review), then keep and dismiss.
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  await waitText(page, 'Nothing waiting for review')
  ok('Pulse opens with a preview tag and an empty review list', (await text(page)).includes('Preview · owners only') && !!(await page.$('[data-testid="pulse-empty"]')))
  await page.type('#signal-body', 'Our CSMs stopped trusting the health score after it dropped for no clear reason.')
  await page.type('#signal-said-by', 'Marcus Bell')
  await page.type('#signal-account', 'Northwind')
  await click(page, 'signal-save')
  await waitText(page, 'Signal added')
  await click(page, 'pulse-filter-kept')
  await waitText(page, 'stopped trusting the health score')
  ok('a signal typed in is kept, with who said it and the account', (await text(page)).includes('Marcus Bell') && (await text(page)).includes('Northwind'))

  await page.type('#notes-text', '- Reports take hours to build by hand every month.\n- Handoffs to support lose the context from success.\n- ok')
  await page.type('#notes-label', 'Renewal call')
  await click(page, 'notes-save')
  await waitText(page, '2 signals added for review')
  await waitText(page, 'Reports take hours')
  await page.waitForFunction(() => document.body.innerText.includes('To review · 2'), { timeout: 8000 })
  ok('pasted notes become signals waiting for review (a fragment too short is left out)', (await text(page)).includes('Reports take hours') && (await text(page)).includes('To review · 2'))
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="signal-"][data-status="new"]')].map((e) => e.getAttribute('data-testid').slice(7)))
  await click(page, `keep-${ids[0]}`)
  await page.waitForFunction((id) => !document.querySelector(`[data-testid="signal-${id}"]`), { timeout: 8000 }, ids[0])
  await click(page, `dismiss-${ids[1]}`)
  await page.waitForFunction(() => document.body.innerText.includes('Kept · 2') && document.body.innerText.includes('Dismissed · 1'), { timeout: 8000 })
  ok('keeping and dismissing moves signals between the lists', true)
  await click(page, 'pulse-filter-dismissed')
  await click(page, 'pulse-filter-dismissed')
  await waitText(page, 'Put back to review')
  ok('a dismissed signal can be put back', (await text(page)).includes('Handoffs to support') || (await text(page)).includes('Reports take hours'))
  await page.screenshot({ path: process.env.PULSE_SHOT || '/tmp/pulse.png' })

  // A read-only visitor never sees it.
  const visitor = await open(null, '/projects')
  ok('a read-only visitor has no Pulse in the menu', !(await menu(visitor)).includes('Pulse'))
  await visitor.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  ok('and the address is a page that does not exist for them', (await text(visitor)).includes('Page not found'))

  // Switched off again: gone for the owner too.
  await page.goto(`${BASE}/settings/preview`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-pulse"]')?.getAttribute('aria-checked') === 'true', { timeout: 8000 })
  await click(page, 'preview-pulse')
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-pulse"]')?.getAttribute('aria-checked') === 'false', { timeout: 8000 })
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  ok('switched off, Pulse leaves the menu again', !(await menu(page)).includes('Pulse'))
} catch (err) {
  failed++
  console.log('  FAIL ' + (err instanceof Error ? err.message : err))
}
await browser.close()
console.log(failed ? `\n${failed} failed` : '\nAll Pulse checks passed')
process.exit(failed ? 1 : 0)
