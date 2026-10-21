// Drives the real app in Chrome against an in-memory API: read-only visitor, unlock with a wrong then the
// right token, the wizard's validation, create, remove with confirmation, and lock. Started by e2e/run.mjs.
import puppeteer from 'puppeteer-core'
const BASE = process.env.E2E_BASE || 'http://localhost:5199'
const TOKEN = process.env.E2E_TOKEN || 'abc123'
const results = []
const ok = (name, cond, extra = '') => { results.push([cond ? 'ok  ' : 'FAIL', name, extra]); console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1400,900'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
page.on('pageerror', (e) => ok('no page errors', false, e.message))
const text = async () => page.evaluate(() => document.body.innerText)
const waitText = (t, timeout = 8000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout }, t)
const clickText = async (t, tag = 'button') => {
  const handle = await page.evaluateHandle((t, tag) => [...document.querySelectorAll(tag)].find((el) => el.innerText.trim() === t || el.textContent.trim() === t), t, tag)
  if (!handle.asElement()) throw new Error(`no <${tag}> with text "${t}"`)
  await handle.asElement().click()
}
const retype = async (sel, value) => { await page.$eval(sel, (el) => el.select()); await page.keyboard.type(value) }
const cardNames = async () => page.evaluate(() => [...document.querySelectorAll('[data-tint]')].map((c) => c.innerText.split('\n')[0]))

try {
  // 1. A visitor without the token is a read-only viewer.
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Research Projects')
  await waitText('Read-only demo')
  ok('visitor sees the read-only badge', (await text()).includes('Read-only demo'))
  ok('four project cards load', (await cardNames()).length === 4, (await cardNames()).join(' | '))
  ok('New project is disabled for a visitor', await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New project')?.disabled === true))
  ok('no remove menu for a visitor', (await page.$$('.cds--overflow-menu')).length === 0)

  // 2. A wrong token is refused; the right one unlocks.
  await clickText('Unlock editing')
  await page.waitForSelector('#access-token', { visible: true })
  await page.type('#access-token', 'wrong-token')
  await clickText('Unlock')
  await waitText('Not unlocked')
  ok('a wrong token is refused with a message', (await text()).includes('Not unlocked'))
  await retype('#access-token', TOKEN)
  await clickText('Unlock')
  await waitText('Editing unlocked')
  ok('the right token unlocks editing', (await text()).includes('Editing unlocked'))
  ok('the token is in session storage only', await page.evaluate((token) => sessionStorage.getItem('signalflow.editToken') === token && localStorage.length === 0, TOKEN))
  ok('remove menus appear once unlocked', (await page.$$('.cds--overflow-menu')).length === 4)
  ok('each menu has its own accessible name', (await page.evaluate(() => [...document.querySelectorAll('.cds--overflow-menu svg')].map((s) => s.getAttribute('aria-label')))).every((l) => /^Actions for .+/.test(l ?? '')))

  // 3. The wizard validates each step.
  await clickText('New project')
  await waitText('Starting template')
  await clickText('Next')
  await waitText('Enter a project name.')
  ok('step 1 asks for a project name', true)
  await page.type('#project-name', 'E2E Study')
  await clickText('Next')
  await waitText('What are we testing?')
  ok('template defaults fill the test plan', await page.evaluate(() => document.querySelector('#what').value.startsWith('Whether first-time users')))
  await clickText('Next')
  await waitText('Participant 1')
  await clickText('Create project')
  await waitText('Add at least one participant.')
  ok('step 3 asks for a participant', true)
  await page.type('#p-name-0', 'Ada Lovelace')
  await page.type('#p-email-0', 'not-an-email')
  await clickText('Create project')
  await waitText('Enter a valid email address.')
  ok('a bad email is caught', true)
  await retype('#p-email-0', 'ada@example.com')
  await clickText('Create project')

  // 4. Create lands on the Task List, and the project is in the list as a draft.
  await page.waitForFunction(() => /\/projects\/[0-9a-f-]{36}\/tasks$/.test(location.pathname), { timeout: 10000 })
  ok('creating opens the new project’s Task List', true, page.url().replace(BASE, ''))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('E2E Study')
  const names = await cardNames()
  ok('the new project appears (5 cards)', names.length === 5 && names.includes('E2E Study'), names.join(' | '))
  const cardText = await page.evaluate(() => [...document.querySelectorAll('[data-tint]')].find((c) => c.innerText.startsWith('E2E Study')).innerText.replace(/\n/g, ' '))
  ok('it is a Draft with zeros', /Draft/.test(cardText) && /0\s*Sessions/.test(cardText), cardText)

  // 5. Remove asks for confirmation, then deletes.
  await page.click('[aria-label="Actions for E2E Study"]')
  await clickText('Remove project', 'button')
  await waitText('Remove this project?')
  ok('remove asks for confirmation and says it is permanent', (await text()).includes('permanently deletes'))
  await clickText('Cancel')
  await new Promise((r) => setTimeout(r, 400))
  ok('cancel keeps the project', (await cardNames()).includes('E2E Study'))
  await page.click('[aria-label="Actions for E2E Study"]')
  await clickText('Remove project', 'button')
  await waitText('Remove this project?')
  await clickText('Remove permanently')
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-tint]')].some((c) => c.innerText.startsWith('E2E Study')), { timeout: 8000 })
  ok('confirming deletes it', (await cardNames()).length === 4)

  // 6. Locking returns to read-only.
  await new Promise((r) => setTimeout(r, 800)) // let the closing dialog finish
  await clickText('Lock')
  await new Promise((r) => setTimeout(r, 500))
  await waitText('Read-only demo')
  ok('locking returns to read-only and clears the token', await page.evaluate(() => sessionStorage.getItem('signalflow.editToken') === null))
  
} catch (e) {
  ok('flow completes', false, e.message)
  await page.screenshot({ path: new URL('./failure.png', import.meta.url).pathname })
}
await browser.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
