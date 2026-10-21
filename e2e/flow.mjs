// Drives the real app in Chrome against an in-memory API: read-only visitor, unlock with a wrong then the
// right token, the wizard's validation, create, remove with confirmation, and lock. Started by e2e/run.mjs.
import puppeteer from 'puppeteer-core'
const BASE = process.env.E2E_BASE || 'http://localhost:5199'
const TOKEN = process.env.E2E_TOKEN || 'abc123'
const API = process.env.E2E_API || 'http://localhost:8787'
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


  // 6. Open the draft project: locked steps, editing the Test Plan, a conflict with someone else, and the Task List.
  await page.evaluate(() => [...document.querySelectorAll('[data-tint]')].find((c) => c.innerText.startsWith('New patient intake')).click())
  await page.waitForFunction(() => /\/projects\/[0-9a-f-]{36}\/plan$/.test(location.pathname), { timeout: 8000 })
  await waitText('Test Plan')
  const projectId = page.url().match(/projects\/([0-9a-f-]{36})/)[1]
  ok('a draft project opens on its Test Plan', true)
  const navState = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cds--side-nav a')].filter((a) => a.getAttribute('href')?.startsWith('/projects/')).map((a) => [a.innerText.trim(), { disabled: a.getAttribute('aria-disabled') === 'true', hint: a.getAttribute('title') }])))
  ok('Plan steps are open and Analyze and Deliver steps are locked with a hint',
    !navState['Test Plan'].disabled && !navState['Task List'].disabled && !navState['Transcripts'].disabled && ['Themes', 'Journey Map', 'Priorities', 'Requirements', 'Stories'].every((k) => navState[k].disabled && navState[k].hint),
    JSON.stringify(navState['Themes']) + ' / ' + JSON.stringify(navState['Stories']))
  await page.waitForSelector('#project-name')
  ok('the plan loads the project’s data', await page.evaluate(() => document.querySelector('#project-name').value === 'New patient intake (draft)' && document.querySelector('#p-name-0').value === 'Riley Brooks'))
  ok('nothing is unsaved yet', (await text()).includes('All changes saved'))

  await retype('#project-name', 'Intake v2')
  await waitText('Unsaved changes')
  ok('editing shows Unsaved changes', true)
  await clickText('Save')
  await waitText('All changes saved at')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('#project-name')
  ok('a saved name survives a reload', await page.evaluate(() => document.querySelector('#project-name').value === 'Intake v2'))

  // Someone else saves while this page is open: the save is refused, then overwritten on purpose.
  const apiGet = async () => (await fetch(`${API}/api/v1/projects/${projectId}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
  const apiPutStudy = async (body) => { const cur = await apiGet(); return fetch(`${API}/api/v1/projects/${projectId}/study`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'if-match': String(cur.version) }, body: JSON.stringify({ name: cur.name, ...body }) }) }
  ok('someone else saves through the API', (await apiPutStudy({ what: 'Their wording' })).status === 200)
  await retype('#what', 'My wording')
  await clickText('Save')
  await waitText('Changed by someone else')
  ok('a stale save is refused with a conflict notice', (await text()).includes('Nothing was overwritten'))
  ok('their wording is still what is saved', (await apiGet()).study.what === 'Their wording')
  await clickText('Overwrite with mine')
  await waitText('All changes saved at')
  ok('Overwrite with mine saves my wording', (await apiGet()).study.what === 'My wording')

  // A second conflict, resolved the other way: reload their version.
  ok('someone else saves again', (await apiPutStudy({ what: 'Their second wording' })).status === 200)
  await retype('#what', 'My second wording')
  await clickText('Save')
  await waitText('Changed by someone else')
  await clickText('Reload their version')
  await page.waitForFunction(() => document.querySelector('#what')?.value === 'Their second wording', { timeout: 8000 })
  ok('Reload their version discards my edit and shows theirs', true)

  // Participants: add one, save, and the existing ones keep their identity.
  const before = (await apiGet()).participants.map((p) => p.id)
  await clickText('Add participant')
  await page.waitForSelector('#p-name-2')
  await page.type('#p-name-2', 'Zed Zeta')
  await page.type('#p-email-2', 'zed@example.com')
  await clickText('Save')
  await waitText('All changes saved at')
  const after = (await apiGet()).participants
  ok('a new participant is added and the others keep their ids', after.length === 3 && after[2].name === 'Zed Zeta' && before.every((id, i) => after[i].id === id))

  // Task List.
  await page.evaluate(() => [...document.querySelectorAll('.cds--side-nav a')].find((a) => a.innerText.trim() === 'Task List').click())
  await waitText('Task 1')
  ok('the Task List shows the template’s starter tasks', await page.evaluate(() => document.querySelector('#task-0').value.length > 0 && document.querySelector('#task-0-followup-0')?.value.length > 0))
  await clickText('Add task')
  await page.waitForSelector('#task-2')
  await page.type('#task-2', 'What would you do next?')
  await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Add follow-up').at(-1).click())
  await page.waitForSelector('#task-2-followup-0')
  await page.type('#task-2-followup-0', 'What made you choose that?')
  await clickText('Save')
  await waitText('All changes saved at')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('#task-2')
  ok('a new task and its follow-up survive a reload', await page.evaluate(() => document.querySelector('#task-2').value === 'What would you do next?' && document.querySelector('#task-2-followup-0').value === 'What made you choose that?'))

  // Locked, the same screens are read-only.
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Intake v2')

  // 7. Locking returns to read-only.
  await new Promise((r) => setTimeout(r, 800)) // let the closing dialog finish
  await clickText('Lock')
  await new Promise((r) => setTimeout(r, 500))
  await waitText('Read-only demo')
  ok('locking returns to read-only and clears the token', await page.evaluate(() => sessionStorage.getItem('signalflow.editToken') === null))
  await page.goto(`${BASE}/projects/${projectId}/plan`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('#project-name')
  ok('locked, the Test Plan is read-only and says how to unlock', await page.evaluate(() => document.querySelector('#project-name').readOnly === true && document.body.innerText.includes('Editing is locked')))
  
} catch (e) {
  ok('flow completes', false, e.message)
  await page.screenshot({ path: new URL('./failure.png', import.meta.url).pathname })
}
await browser.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
