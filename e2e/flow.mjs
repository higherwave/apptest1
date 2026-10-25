// Drives the real app in Chrome against an in-memory API: read-only visitor, unlock with a wrong then the
// right token, the wizard's validation, create, remove with confirmation, and lock. Started by e2e/run.mjs.
import puppeteer from 'puppeteer-core'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
// Hidden dialogs keep their buttons in the page, so a dialog's own button is looked up inside the open one.
const clickInOpenDialog = async (t) => page.evaluate((t) => [...document.querySelectorAll('.cds--modal.is-visible button')].find((b) => b.innerText.trim() === t).click(), t)
const retype = async (sel, value) => { await page.$eval(sel, (el) => el.select()); await page.keyboard.type(value) }
const header = () => page.evaluate(() => document.querySelector('header')?.innerText ?? '')
const cardNames = async () => page.evaluate(() => [...document.querySelectorAll('[data-tint]')].map((c) => c.innerText.split('\n')[0]))

try {
  // 1. A visitor without the token is a read-only viewer.
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Research Projects')
  await waitText('Read-only demo')
  ok('the app bar shows the app’s name on the home screen, with no back link', (await header()).includes('Signal Flow') && !(await header()).includes('← Research Projects'))
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

  // 3. New test plan is one page; Save validates it.
  await clickText('New project')
  await waitText('New test plan')
  await page.waitForSelector('#item-0-description') // the form shows once the test methods have loaded
  ok('the app bar says New project and offers the way back', (await header()).includes('New project') && (await header()).includes('← Research Projects'))
  ok('one page holds the name, methods, test items and participants', await page.evaluate(() => ['#project-name', '#item-0-description', '#p-name-0', '#p-phone-0'].every((sel) => document.querySelector(sel)) && document.body.innerText.includes('Test methods') && !document.body.innerText.includes('Starting template')))
  ok('the project menu shows with only Test Plan open', await page.evaluate(() => { const l = [...document.querySelectorAll('[data-nav] a')]; return l.find((a) => a.dataset.label === 'Test Plan')?.getAttribute('aria-disabled') !== 'true' && l.filter((a) => a.getAttribute('aria-disabled') === 'true').length === 7 }))
  await clickText('Save test plan')
  await waitText('Enter a project name.')
  ok('Save asks for a project name', true)
  await page.type('#project-name', 'E2E Study')
  await clickText('Save test plan')
  await waitText('Add at least one participant.')
  ok('Save asks for a participant', true)
  await clickText('Card sort')
  ok('a test method toggles on when chosen', await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((b) => b.innerText.trim() === 'Card sort').getAttribute('aria-pressed') === 'true'))
  await page.type('#item-0-description', 'Whether first-time users can book')
  await page.type('#item-0-outcome-0', 'Most finish in under two minutes')
  await clickText('+ Add outcome')
  await page.waitForSelector('#item-0-outcome-1')
  await page.type('#item-0-outcome-1', 'Fewer calls to the clinic')
  await clickText('+ Add test item')
  await page.waitForSelector('#item-1-description')
  ok('a second test item can be added', await page.evaluate(() => document.querySelectorAll('[id^="item-"][id$="-description"]').length === 2 && !document.body.innerText.includes('Test Item')))
  await page.type('#p-name-0', 'Ada Lovelace')
  await page.type('#p-email-0', 'not-an-email')
  await page.type('#p-phone-0', '(555) 010-0000')
  await clickText('Save test plan')
  await waitText('Enter a valid email address.')
  ok('a bad email is caught', true)
  await retype('#p-email-0', 'ada@example.com')
  await clickText('Save test plan')

  // 4. Create lands on the Task List, and the project is in the list as a draft.
  await page.waitForFunction(() => /\/projects\/[0-9a-f-]{36}\/tasks$/.test(location.pathname), { timeout: 10000 })
  ok('creating opens the new project’s Task List', true, page.url().replace(BASE, ''))
  const createdId = page.url().match(/projects\/([0-9a-f-]{36})\//)[1]
  const created = await (await fetch(`${API}/api/v1/projects/${createdId}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
  ok('the plan was saved: one test item with both outcomes (the empty second one dropped), the method and the phone number',
    created.testItems.length === 1 && created.testItems[0].description === 'Whether first-time users can book' && created.testItems[0].outcomes.length === 2 && created.study.methods.join() === 'Card sort' && created.participants[0].phone === '(555) 010-0000',
    JSON.stringify(created.testItems))
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
  await clickInOpenDialog('Cancel')
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
  await page.waitForFunction(() => document.querySelector('[data-nav] a[aria-disabled="true"]'), { timeout: 8000 }) // the server's answer about which steps are open
  const navState = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-nav] a')].filter((a) => a.getAttribute('href')?.startsWith('/projects/')).map((a) => [a.dataset.label, { disabled: a.getAttribute('aria-disabled') === 'true', hint: a.getAttribute('title') }])))
  ok('Plan steps are open and Analyze and Deliver steps are locked with a hint',
    !navState['Test Plan'].disabled && !navState['Task List'].disabled && !navState['Transcripts'].disabled && ['Themes', 'Journey Map', 'Priorities', 'Requirements', 'Stories'].every((k) => navState[k].disabled && navState[k].hint),
    JSON.stringify(navState['Themes']) + ' / ' + JSON.stringify(navState['Stories']))
  await page.waitForSelector('#project-name')
  ok('the plan loads the project’s data', await page.evaluate(() => document.querySelector('#project-name').value === 'New patient intake (draft)' && document.querySelector('#p-name-0').value === 'Riley Brooks'))
  ok('nothing is unsaved yet', (await text()).includes('All changes saved'))

  await retype('#project-name', 'Intake v2')
  await waitText('Unsaved changes')
  ok('editing shows Unsaved changes', true)
  await clickText('Save test plan')
  await waitText('All changes saved at')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('#project-name')
  ok('the app bar shows the project’s name and status, and the new name after a save', (await header()).includes('Intake v2') && /Draft/.test(await header()) && (await header()).includes('← Research Projects'))
  ok('a saved name survives a reload', await page.evaluate(() => document.querySelector('#project-name').value === 'Intake v2'))

  // Someone else saves while this page is open: the save is refused, then overwritten on purpose.
  const apiGet = async () => (await fetch(`${API}/api/v1/projects/${projectId}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
  const apiPutStudy = async (body) => { const cur = await apiGet(); return fetch(`${API}/api/v1/projects/${projectId}/study`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'if-match': String(cur.version) }, body: JSON.stringify({ name: cur.name, methods: cur.study.methods, testItems: cur.testItems.map((i) => ({ description: i.description, outcomes: i.outcomes })), participants: cur.participants.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email, phone: p.phone, sessionDate: p.sessionDate })), ...body }) }) }
  ok('someone else saves through the API', (await apiPutStudy({ testItems: [{ description: 'Their wording', outcomes: [] }] })).status === 200)
  await retype('#item-0-description', 'My wording')
  await clickText('Save test plan')
  await waitText('Changed by someone else')
  ok('a stale save is refused with a conflict notice', (await text()).includes('Nothing was overwritten'))
  ok('their wording is still what is saved', (await apiGet()).testItems[0].description === 'Their wording')
  await clickText('Overwrite with mine')
  await waitText('All changes saved at')
  ok('Overwrite with mine saves my wording', (await apiGet()).testItems[0].description === 'My wording')

  // A second conflict, resolved the other way: reload their version.
  ok('someone else saves again', (await apiPutStudy({ testItems: [{ description: 'Their second wording', outcomes: [] }] })).status === 200)
  await retype('#item-0-description', 'My second wording')
  await clickText('Save test plan')
  await waitText('Changed by someone else')
  await clickText('Reload their version')
  await page.waitForFunction(() => document.querySelector('#item-0-description')?.value === 'Their second wording', { timeout: 8000 })
  ok('Reload their version discards my edit and shows theirs', true)

  // Participants: add one, save, and the existing ones keep their identity.
  const before = (await apiGet()).participants.map((p) => p.id)
  await clickText('+ Add participant')
  await page.waitForSelector('#p-name-2')
  await page.type('#p-name-2', 'Zed Zeta')
  await page.type('#p-email-2', 'zed@example.com')
  await clickText('Save test plan')
  await waitText('All changes saved at')
  const after = (await apiGet()).participants
  ok('a new participant is added and the others keep their ids', after.length === 3 && after[2].name === 'Zed Zeta' && before.every((id, i) => after[i].id === id))

  // Task List.
  await page.evaluate(() => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === 'Task List').click())
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

  // Transcripts: upload files, run the analysis, see the Analyze steps unlock, edit, then remove everything.
  const samples = JSON.parse(readFileSync(new URL('../db/seed/data/research.json', import.meta.url), 'utf8')).SAMPLES
  const dir = mkdtempSync(join(tmpdir(), 'sf-transcripts-'))
  const files = samples.map((smp) => { const f = join(dir, smp.name); writeFileSync(f, smp.text); return f })
  const navLocked = async (label) => page.evaluate((l) => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === l)?.getAttribute('aria-disabled') === 'true', label)
  await page.evaluate(() => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === 'Transcripts').click())
  await waitText('No file handy?')
  ok('a project with no transcripts says so', (await text()).includes('No transcripts yet'))
  ok('Themes is still locked before analysis', await navLocked('Themes'))
  await (await page.$('input[type=file]')).uploadFile(...files)
  await page.waitForSelector('[data-testid="transcript-2"]')
  ok('three uploaded files become three transcripts', await page.evaluate(() => document.querySelector('[data-testid="transcript-0"]').innerText.includes('Session 1')))
  ok('the button says Save and analyze', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Save and analyze')))
  await clickText('Save and analyze')
  await waitText('Analyzing transcripts')
  ok('a progress dialog shows the analysis steps', (await text()).includes('Clustering statements'))
  await page.waitForFunction(() => /\/themes$/.test(location.pathname), { timeout: 20000 })
  ok('when it finishes, the person lands on Themes', true)
  ok('Themes, Journey Map, Priorities and Requirements are now open; Stories is still locked',
    !(await navLocked('Themes')) && !(await navLocked('Journey Map')) && !(await navLocked('Priorities')) && !(await navLocked('Requirements')) && (await navLocked('Stories')))
  const apiProjects = async () => (await (await fetch(`${API}/api/v1/projects`)).json()).data
  const mine = async () => (await apiProjects()).find((p) => p.id === projectId)
  ok('the project is Analyzed with 3 sessions and 9 themes', await mine().then((p) => p.status === 'analyzed' && p.sessions === 3 && p.themes === 9))

  // Themes, Journey Map and Priorities, on the analysis just made.
  const apiThemes = async () => (await (await fetch(`${API}/api/v1/projects/${projectId}/themes`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).data
  const navTo = async (label) => { await page.evaluate((l) => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === l).click(), label) }
  const choose = async (id, option) => {
    await page.click(`#${id}`)
    await page.waitForSelector('[role=option]', { visible: true })
    await page.evaluate((o) => [...document.querySelectorAll('[role=option]')].find((x) => x.innerText.trim() === o).click(), option)
  }
  const dnd = (fromFn, toFn) => page.evaluate((a, b) => {
    const src = new Function(`return (${a})()`)(), dst = new Function(`return (${b})()`)()
    const dt = new DataTransfer()
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    fire(src, 'dragstart'); fire(dst, 'dragenter'); fire(dst, 'dragover'); fire(dst, 'drop'); fire(src, 'dragend')
  }, fromFn.toString(), toFn.toString())

  await waitText('Evidence')
  ok('Themes lists the 9 themes found, with an All count', (await text()).includes('All 9'))
  ok('the first theme is selected and its quotes show', await page.evaluate(() => document.querySelectorAll('blockquote').length > 0))
  await clickText('Delight 1')
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Themes"] li').length === 1, { timeout: 5000 })
  ok('the Delight filter shows only delight themes', true)
  await clickText('All 9')
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Themes"] li').length === 9, { timeout: 5000 })

  // Coming back to Themes with the data already loaded must still fill the name box (it was empty once).
  await navTo('Journey Map')
  await waitText('Journey Map')
  await navTo('Themes')
  await page.waitForFunction(() => document.querySelector('#theme-title')?.value.length > 0, { timeout: 8000 })
  ok('returning to Themes shows the selected theme’s name in the name box', true)
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Themes"] li').length === 9, { timeout: 8000 })

  // Choose the theme about availability; rename it and move it to another stage.
  await page.evaluate(() => [...document.querySelectorAll('ul[aria-label="Themes"] li')].find((li) => li.innerText.includes('Provider availability is hard to see')).querySelector('a, button').click())
  await waitText('Theme name')
  ok('there is no pin button: every theme goes on the map by itself', !(await text()).includes('Pin to journey map'))
  await retype('#theme-title', 'Hard to see who is free')
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => document.body.innerText.includes('Originally: Provider availability is hard to see'), { timeout: 8000 })
  // The page shows the new name at once and saves in the background, so wait for the save before checking the server.
  const renamed = async () => (await apiThemes()).some((t) => t.title === 'Hard to see who is free' && t.originalTitle === 'Provider availability is hard to see')
  for (let i = 0; i < 24 && !(await renamed()); i++) await new Promise((r) => setTimeout(r, 250))
  ok('renaming keeps the original visible', await renamed())
  await choose('theme-stage', 'Confirm & pay')
  await new Promise((r) => setTimeout(r, 600))
  ok('choosing a stage saves it', (await apiThemes()).find((t) => t.title === 'Hard to see who is free').stagePosition === 2)

  // Journey Map: every theme is already on it, with no pinning; drag the renamed one, then use its menu.
  await navTo('Journey Map')
  await page.waitForFunction(() => document.querySelectorAll('article').length > 0, { timeout: 8000 })
  const inStage = (name) => page.evaluate((n) => [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label').startsWith(n))?.querySelectorAll('article').length ?? -1, name)
  const stageHolds = (name, title) => page.evaluate((n, t) => [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label').startsWith(n))?.innerText.includes(t) ?? false, name, title)
  ok('the Journey Map shows all 9 themes without any being pinned', (await page.evaluate(() => document.querySelectorAll('article').length)) === 9)
  ok('the map has Themes, Pain points, Sentiment and Opportunity rows', await page.evaluate(() => ['THEMES', 'PAIN POINTS', 'SENTIMENT', 'OPPORTUNITY'].every((l) => [...document.querySelectorAll('div')].some((d) => d.children.length === 0 && d.innerText.trim().toUpperCase() === l))))
  ok('pain points list each pain-point theme with its participants and importance', await page.evaluate(() => /\d of \d participants · (High|Medium|Low)/.test(document.body.innerText)))
  ok('each stage has an opportunity, or says no themes are mapped', await page.evaluate(() => document.querySelectorAll('[class*="opportunity"], [class*="none"]').length >= 5))
  ok('sentiment draws a point for each stage that has themes', await page.evaluate(() => document.querySelectorAll('[class*="point"]').length >= 1 && !!document.querySelector('[role="img"][aria-label^="Sentiment by stage"]')))
  ok('the stage counts add up to 9', (await Promise.all(['Find a provider', 'Book a time', 'Confirm & pay', 'Prepare or change', 'Visit & follow-up'].map(inStage))).every((n) => n >= 0))
  ok('the renamed theme sits in Confirm & pay', await stageHolds('Confirm & pay', 'Hard to see who is free'))
  await dnd(() => [...document.querySelectorAll('article')].find((a) => a.innerText.includes('Hard to see who is free')), () => [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label').startsWith('Prepare or change')))
  await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label').startsWith('Prepare or change'))?.innerText.includes('Hard to see who is free'), { timeout: 8000 })
  ok('dragging a theme to another stage moves and saves it', (await apiThemes()).find((t) => t.title === 'Hard to see who is free').stagePosition === 3)
  await page.evaluate(() => [...document.querySelectorAll('article')].find((a) => a.innerText.includes('Hard to see who is free')).querySelector('.cds--overflow-menu').click())
  await clickText('Move to Find a provider', 'button')
  await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label').startsWith('Find a provider'))?.innerText.includes('Hard to see who is free'), { timeout: 8000 })
  ok('the menu moves it too, without dragging', (await apiThemes()).find((t) => t.title === 'Hard to see who is free').stagePosition === 0)
  ok('the menu has no unpin item', !(await text()).includes('Unpin'))

  // Priorities: change importance with the menu, move a chip by dragging, then reset.
  await navTo('Priorities')
  await waitText('Importance')
  const target = (await apiThemes()).find((t) => t.originalTitle === 'Reviews and ratings drive trust')
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Reviews and ratings drive trust').click())
  await waitText('Suggested:')
  ok('the panel shows the suggestion', (await text()).includes('Suggested: Medium importance, Low effort'))
  await choose('importance', 'High')
  await waitText('Edited')
  ok('changing importance saves it and marks the theme Edited', (await apiThemes()).find((t) => t.id === target.id).priority === 'high')
  await dnd(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Reviews and ratings drive trust'), () => document.querySelector('div[role=group][aria-label^="Importance Low, effort High"]'))
  await page.waitForFunction(() => document.querySelector('div[role=group][aria-label^="Importance Low, effort High"]')?.innerText.includes('Reviews and ratings drive trust'), { timeout: 8000 })
  const moved = (await apiThemes()).find((t) => t.id === target.id)
  ok('dragging a theme to a cell sets importance and effort', moved.priority === 'low' && moved.effort === 3)
  await clickText('Reset to suggestion')
  await page.waitForFunction(() => !document.body.innerText.includes('Edited'), { timeout: 8000 })
  const back = (await apiThemes()).find((t) => t.id === target.id)
  ok('Reset to suggestion puts it back', back.priority === 'medium' && back.effort === 1 && back.overrideVersion >= 0)
  await choose('importance', 'Low')
  await waitText('Edited')
  await clickText('Reset all')
  await page.waitForFunction(() => !document.body.innerText.includes('Edited'), { timeout: 8000 })
  ok('Reset all clears every importance and effort edit', (await apiThemes()).every((t) => !t.edited))

  // Requirements: open the project's one document, review the eight steps (redo, edit, exclude a theme), approve, publish, then start over.
  const apiSpecs = async () => (await (await fetch(`${API}/api/v1/specs?projectId=${projectId}`)).json()).data
  const apiSpec = async (id) => (await (await fetch(`${API}/api/v1/specs/${id}`)).json())
  const approvedCount = () => page.evaluate(() => document.querySelectorAll('article[data-state="approved"]').length)
  const waitApprove = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Approve' && !b.disabled), { timeout: 20000 })
  const approveNext = async () => { const n = await approvedCount(); await waitApprove(); await clickText('Approve'); await page.waitForFunction((k) => document.querySelectorAll('article[data-state="approved"]').length === k, { timeout: 10000 }, n + 1) }

  ok('before Requirements is opened there is no document', (await apiSpecs()).length === 0)
  await navTo('Requirements')
  await page.waitForFunction(() => /\/requirements\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 })
  const specId = page.url().match(/requirements\/([0-9a-f-]{36})/)[1]
  ok('opening Requirements drafts the project\'s one document and opens it, with no list in between', (await apiSpecs()).length === 1)
  await waitText('Agent reasoning')
  ok('the writer opens with step 1 under review and the rest waiting', await page.evaluate(() => [...document.querySelectorAll('article')].map((a) => a.dataset.state).join(',') === 'review,pending,pending,pending,pending,pending,pending,pending'))
  ok('the source line names the project, sessions and themes', (await text()).includes('Built from Intake v2 · 3 sessions · 9 themes'))
  await waitApprove()
  ok('the first step is being written, then offers Approve and Redo', (await text()).includes('Redo with instructions'))

  // Exclude a theme; then redo step 1 with instructions.
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Themes used"] button')].find((b) => b.innerText.trim() === 'Insurance coverage is unclear up front').click())
  await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label="Themes used"] button')].find((b) => b.innerText.trim() === 'Insurance coverage is unclear up front')?.getAttribute('aria-pressed') === 'false', { timeout: 8000 })
  ok('clicking a theme excludes it', (await apiSpec(specId)).themes.find((t) => t.title === 'Insurance coverage is unclear up front').included === false)
  await clickText('Redo with instructions')
  await page.waitForSelector('#redo-instructions', { visible: true })
  await page.type('#redo-instructions', 'Focus on rescheduling')
  await clickText('Submit')
  await page.waitForFunction(() => document.body.innerText.includes('Revised to account for: Focus on rescheduling.'), { timeout: 15000 })
  await waitText('Redone once')
  ok('redo redraws the step with the instructions', (await apiSpec(specId)).steps[0].revision === 1)

  // Edit step 1: it goes back under review and keeps my words.
  await waitApprove()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Edit' && !b.disabled), { timeout: 10000 })
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Edit' && !b.disabled).click()) // a real click can land under the fixed header
  await page.waitForSelector('#step-text-1')
  await retype('#step-text-1', 'Patients cannot reschedule without a phone call.')
  await clickText('Save edit')
  await waitText('Patients cannot reschedule without a phone call.')
  await waitText('Edited')
  ok('editing a step keeps my text and leaves it under review', await page.evaluate(() => document.querySelector('article[data-state="review"]') !== null) && (await apiSpec(specId)).steps[0].edited === true)

  await approveNext() // step 1
  // The approval is made first; step 2 starts only after it has gone through.
  await page.waitForFunction(() => [...document.querySelectorAll('article')].slice(0, 3).map((a) => a.dataset.state).join(',') === 'approved,review,pending', { timeout: 10000 }).catch(() => {})
  ok('approving step 1 starts step 2', await page.evaluate(() => [...document.querySelectorAll('article')].slice(0, 3).map((a) => a.dataset.state).join(',') === 'approved,review,pending'))
  await waitApprove()
  ok('the next step is brought into view and holds the focus', await page.evaluate(() => { const a = document.querySelector('article[aria-label^="Step 2"]'); const r = a.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2 && a.contains(document.activeElement) || document.activeElement === a }))
  ok('an approved step is folded to its title row, and opens again from its chevron', await page.evaluate(() => {
    const a = document.querySelector('article[aria-label^="Step 1"]')
    return a.dataset.state === 'approved' && !a.querySelector('p') && a.querySelector('button[aria-expanded="false"]') !== null
  }))
  await page.evaluate(() => document.querySelector('article[aria-label^="Step 1"] button[aria-expanded]').click())
  await page.waitForFunction(() => document.querySelector('article[aria-label^="Step 1"] button[aria-expanded="true"]') !== null)
  ok('opening it shows its text; closing folds it again', await page.evaluate(() => document.querySelector('article[aria-label^="Step 1"] p') !== null))
  await page.evaluate(() => document.querySelector('article[aria-label^="Step 1"] button[aria-expanded]').click())
  await approveNext() // step 2
  await approveNext() // step 3
  await waitText('Brief locked. Drafting begins.')
  ok('after steps 1 to 3 the product brief is locked and filled', (await text()).includes('Problem') && (await text()).includes('Goals'))
  for (let i = 4; i <= 8; i++) await approveNext()
  await waitText('Ready to publish')
  ok('with all eight approved, the document is ready to publish', (await text()).toLowerCase().includes('requirements document'))
  const preview = (await apiSpec(specId)).preview
  ok('and says what the board will get', (await text()).includes(`creates ${preview.requirements} requirements and ${preview.openQuestions} open questions`), JSON.stringify(preview))
  await clickText('Publish')
  await page.waitForFunction(() => /\/stories$/.test(location.pathname), { timeout: 15000 })
  ok('publishing opens Stories', true)
  ok('the project’s Stories step is now unlocked', !(await navLocked('Stories')))
  ok('the document is Published', (await apiSpec(specId)).status === 'published')

  // Stories: the board shows what the document created; move by menu, by drag, and in the card panel; Undo.
  const apiBoard = async () => (await fetch(`${API}/api/v1/projects/${projectId}/board`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()
  const storyOf = async (key) => (await apiBoard()).stories.find((s) => s.key === key)
  await page.waitForSelector('[data-testid^="card-"]')
  const board0 = await apiBoard()
  ok('the board shows every card the document created, all in To Do', board0.stories.length === preview.requirements + preview.openQuestions && board0.stories.every((s) => s.status === 'todo')
    && (await page.$$('[data-testid^="card-"]')).length === board0.stories.length)
  const firstKey = board0.stories[0].key
  const secondKey = board0.stories[1].key
  const thirdKey = board0.stories[2].key
  await page.click(`[data-testid="card-${firstKey}"] [aria-label="Move ${firstKey}"]`)
  await clickText('Move to In progress', 'li, button')
  await page.waitForFunction((k) => document.querySelector(`section[aria-label="In progress"] [data-testid="card-${k}"]`), { timeout: 8000 }, firstKey)
  await new Promise((r) => setTimeout(r, 600))
  ok('"Move to" in a card’s menu moves it to the other column', (await storyOf(firstKey)).status === 'in_progress')
  await waitText(`Undo move of ${firstKey}`)
  // Drag the second card onto the first, in In progress (dropped before it).
  await page.evaluate((a, b) => {
    const dt = new DataTransfer()
    const src = document.querySelector(`[data-testid="card-${a}"]`)
    const target = document.querySelector(`[data-testid="card-${b}"]`)
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, secondKey, firstKey)
  await page.waitForFunction((k) => document.querySelector(`section[aria-label="In progress"] [data-testid="card-${k}"]`), { timeout: 8000 }, secondKey)
  await new Promise((r) => setTimeout(r, 600))
  const dragged = await apiBoard()
  const inProgress = dragged.stories.filter((s) => s.status === 'in_progress').sort((a, b) => a.position - b.position).map((s) => s.key)
  ok('dragging a card onto another puts it just before that card', inProgress.join() === [secondKey, firstKey].join(), inProgress.join())
  await clickText(`Undo move of ${secondKey}`)
  await new Promise((r) => setTimeout(r, 800))
  ok('Undo puts the dragged card back in To Do', (await storyOf(secondKey)).status === 'todo' && (await storyOf(firstKey)).status === 'in_progress')
  // The panel on the right is always there, showing a selected card (the first in To Do until another is picked).
  ok('the detail panel is already showing a card on arrival', await page.evaluate(() => !!document.querySelector('aside[aria-label="Story details"] h2')))
  ok('it has a Create Jira Ticket button, which needs no function yet', await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Story details"] button')].some((b) => b.innerText.trim() === 'Create Jira Ticket')))
  // The card panel: details, move, and open-ended acceptance criteria. No owner or priority: it is context for a tracker.
  await page.click(`[data-testid="card-${thirdKey}"] button`)
  await page.waitForFunction(() => [...document.querySelectorAll('aside[aria-label="Story details"] button')].some((b) => b.innerText.trim() === '+ Add criterion'), { timeout: 8000 }) // the panel has loaded, not just opened
  ok('opening a card shows its details, acceptance criteria and the next stage', (await text()).toLowerCase().includes('acceptance criteria') && await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Story details"] button')].some((b) => b.innerText.trim() === 'In progress ›')))
  await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Story details"] button')].find((b) => b.innerText.trim() === 'In progress ›').click())
  await page.waitForFunction((k) => document.querySelector(`section[aria-label="In progress"] [data-testid="card-${k}"]`), { timeout: 8000 }, thirdKey)
  await new Promise((r) => setTimeout(r, 600))
  ok('the panel\'s next-stage button moves the open card', (await storyOf(thirdKey)).status === 'in_progress')
  ok('the move is announced for screen readers, and focus follows the card', await page.evaluate((k) => document.querySelector('[role="status"][aria-live="polite"]').innerText.includes(`${k} moved to In progress`) && document.activeElement?.closest('[data-testid]')?.dataset.testid === `card-${k}`, thirdKey))
  await page.waitForFunction(() => [...document.querySelectorAll('aside[aria-label="Story details"] button')].some((b) => b.innerText.trim() === '‹ To Do' && !b.disabled), { timeout: 8000 }) // the panel reloads the story after a move
  await page.evaluate(() => [...document.querySelectorAll('aside[aria-label="Story details"] button')].find((b) => b.innerText.trim() === '‹ To Do').click())
  await page.waitForFunction((k) => document.querySelector(`section[aria-label="To Do"] [data-testid="card-${k}"]`), { timeout: 8000 }, thirdKey)
  await new Promise((r) => setTimeout(r, 600))
  ok('and its back button returns it', (await storyOf(thirdKey)).status === 'todo')
  ok('the panel has no owner, owner team or priority', await page.evaluate(() => { const t = document.querySelector('aside[aria-label="Story details"]').innerText; return !/^(owner( team)?|priority)$/im.test(t) && !/\b(high|medium|low) priority\b/i.test(t) && !t.includes('Save owner') && !document.querySelector('#story-owner') && !document.querySelector('#story-priority') }))
  ok('criteria have no Criterion/Task switch', await page.evaluate(() => ![...document.querySelectorAll('aside[aria-label="Story details"] button')].some((b) => ['Criterion', 'Task', 'Add item'].includes(b.innerText.trim()))))
  await clickText('+ Add criterion')
  await page.waitForFunction(() => document.activeElement?.id?.startsWith('criterion-'), { timeout: 4000 })
  await page.keyboard.type('Works with a screen reader')
  await page.keyboard.press('Tab') // leaving the field saves it
  await new Promise((r) => setTimeout(r, 800))
  ok('adding a criterion saves it', (await (await fetch(`${API}/api/v1/stories/${(await storyOf(thirdKey)).id}`)).json()).checklist.some((c) => c.text === 'Works with a screen reader'))
  ok('the panel follows the selected card', await page.evaluate((k) => document.querySelector('aside[aria-label="Story details"] h2')?.innerText.startsWith(k), thirdKey))
  await page.type('#story-search', thirdKey)
  await new Promise((r) => setTimeout(r, 300))
  ok('searching narrows the board to matching cards', (await page.$$('[data-testid^="card-"]')).length >= 1 && !(await page.$(`[data-testid="card-${firstKey}"]`)) && !!(await page.$(`[data-testid="card-${thirdKey}"]`)))
  ok('the Stories toolbar has search and priority only, no theme filters', !(await page.$('[aria-label="Filter by theme"]')) && !!(await page.$('#story-filter-priority')))
  await page.goto(`${BASE}/projects/${projectId}/stories`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid^="card-"]')

  // Platform Insights: themes across projects, where one comes from, case studies, onboarding.
  await page.evaluate(() => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === 'Platform Insights').click())
  await page.waitForSelector('[data-testid^="platform-theme-"]')
  const insights = await (await fetch(`${API}/api/v1/insights/themes`)).json()
  const shown = await page.$$eval('[data-testid^="platform-theme-"]', (els) => els.map((e) => e.innerText))
  ok('Platform Insights lists every platform theme with "N of M participants"',
    shown.length === insights.themes.length && insights.themes.every((t, i) => shown[i].includes(t.title) && shown[i].includes(`${t.participantCount} of ${insights.totalParticipants} participants`)))
  ok('the demo projects and the one analysed in this test all count', insights.projects.length >= 3 && insights.projects.some((p) => p.name === 'Intake v2'), insights.projects.map((p) => p.name).join(', '))
  const bodyText = await text()
  ok('every recommendation is shown, with its theme and project counts', insights.recommendations.length === 4 && insights.recommendations.every((r) => bodyText.includes(r.title) && bodyText.includes(`${r.projectCount} project`)))
  const second = insights.themes[1]
  await page.click(`[data-testid="platform-theme-${second.id}"]`)
  await page.waitForFunction((t) => document.querySelector('aside[aria-label="Where this comes from"]')?.innerText.includes(t), { timeout: 8000 }, second.title)
  ok('picking a theme shows where it comes from, with quotes', (await page.$$eval('aside[aria-label="Where this comes from"] blockquote', (q) => q.length)) >= 1 && (await text()).includes(`Raised by ${second.participantCount} of ${insights.totalParticipants} participants`))
  ok('the choice is in the address, so it can be shared', await page.evaluate((id) => location.search === `?theme=${id}`, second.id))
  await page.evaluate(() => [...document.querySelectorAll('[data-nav] a, [data-label]')].find((a) => a.dataset.label === 'Case studies').click())
  await page.waitForSelector('[data-testid="case-study"]')
  const cases = (await (await fetch(`${API}/api/v1/insights/case-studies`)).json()).data
  ok('Case Studies shows each study with its outcome and owner', (await page.$$('[data-testid="case-study"]')).length === cases.length && (await text()).includes(cases[0].outcome) && (await text()).includes('Sep 2026'))
  const chip = cases[1].themes[0]
  await clickText(chip.title)
  await page.waitForFunction((id) => location.pathname === '/insights/themes' && location.search === `?theme=${id}`, { timeout: 8000 }, chip.id)
  await page.waitForFunction((t) => document.querySelector('aside[aria-label="Where this comes from"]')?.innerText.includes(t), { timeout: 8000 }, chip.title)
  ok('a case study’s theme chip opens that theme', true)
  await page.evaluate(() => [...document.querySelectorAll('[data-label]')].find((a) => a.dataset.label === 'Onboarding').click())
  await waitText('Onboarding content coming soon')
  ok('Onboarding is a placeholder, as in the prototype', true)
  await page.goto(`${BASE}/projects/${projectId}/stories`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid^="card-"]')

  // Requirements opens the one document directly. A published document can be reopened: edit, approve, change themes, update the board.
  await navTo('Requirements')
  await waitText('Agent reasoning')
  ok('Requirements opens the published document directly, with no list', (await text()).includes('Published') && !(await text()).includes('New document from these themes') && (await apiSpecs()).length === 1)
  // Approved steps are folded to their title rows; open step 2 to reach its Edit button.
  await page.evaluate(() => document.querySelector('article[aria-label^="Step 2"] button[aria-expanded="false"]').click())
  await page.waitForFunction(() => document.querySelector('article[aria-label^="Step 2"] button[aria-expanded="true"]') !== null)
  ok('a published document can be edited again: Edit is offered on its steps', await page.evaluate(() => [...document.querySelectorAll('article[aria-label^="Step 2"] button')].some((b) => b.innerText.trim() === 'Edit')))
  ok('a project document has no back-to-list button', !(await text()).includes('← Requirements'))
  // Long sections are cut to a few lines; when a section is cut, Show more reveals it and Show less folds it again.
  const more = await page.evaluate(() => { const b = [...document.querySelectorAll('aside[aria-label="Output"] button')].find((x) => x.innerText.trim() === 'Show more'); if (!b) return false; b.click(); return true })
  if (more) await page.waitForFunction(() => [...document.querySelectorAll('aside[aria-label="Output"] button')].some((x) => x.innerText.trim() === 'Show less'), { timeout: 5000 })
  ok(more ? 'a cut section opens with Show more and offers Show less' : 'no section is long enough to be cut (nothing to check)', true)
  // Reopen step 2: edit it, see it go back to review and the later steps marked, approve it again.
  await page.evaluate(() => [...document.querySelectorAll('article[aria-label^="Step 2"] button')].find((b) => b.innerText.trim() === 'Edit').click())
  await page.waitForSelector('#step-text-2', { visible: true })
  await page.click('#step-text-2', { clickCount: 3 })
  await page.type('#step-text-2', 'Edited after publishing')
  await clickText('Save edit')
  await page.waitForFunction(() => document.querySelector('article[aria-label^="Step 2"]')?.dataset.state === 'review', { timeout: 8000 })
  await page.evaluate(() => document.querySelector('article[aria-label^="Step 3"] button[aria-expanded="false"]')?.click()) // the "behind" note sits inside the folded step
  await waitText('An earlier step changed after this one was written')
  ok('editing a published step sends it back to review and marks the later steps as behind', (await apiSpec(specId)).status === 'published' && (await text()).includes('Redo it if it should follow the change'))
  await waitApprove()
  await clickText('Approve')
  await page.waitForFunction(() => document.querySelector('article[aria-label^="Step 2"]')?.dataset.state === 'approved', { timeout: 10000 })
  ok('and it can be approved again', true)
  // Exclude a theme: the board no longer matches until Update board is confirmed.
  await page.waitForFunction(() => { const b = document.querySelector('section[aria-label="Themes used"] button'); return b && !b.disabled }, { timeout: 15000 }) // the step shows approved at once, before the save finishes
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Themes used"] button')].find((b) => b.getAttribute('aria-pressed') === 'true').click())
  await waitText('The board no longer matches this document')
  await clickText('Update board')
  await waitText('Update the board?')
  ok('Update board shows what it will change first', (await text()).includes('Stories that have been moved, edited or given criteria are never removed'))
  await clickInOpenDialog('Update board')
  await waitText('The board matches this document.')
  ok('confirming brings the board back in line with the document', true)
  const oldSpec = (await apiSpecs())[0].id
  await page.waitForFunction(() => !document.querySelector('.cds--modal.is-visible'), { timeout: 5000 }) // the Update board dialog has finished closing
  await new Promise((r) => setTimeout(r, 600)) // a closing dialog keeps catching clicks for a moment while it fades
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Start over').click())
  await waitText('and removes the requirements and stories it created on the board')
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible button.cds--btn--danger').click())
  await page.waitForFunction((old) => /\/requirements\/[0-9a-f-]{36}$/.test(location.pathname) && !location.pathname.includes(old), { timeout: 20000 }, oldSpec)
  await waitText('Agent reasoning')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === 'Stories')?.getAttribute('aria-disabled') === 'true', { timeout: 8000 }).catch(() => undefined) // the stage refetches after the delete
  const afterSpecs = await apiSpecs()
  ok('Start over replaces the published document with a new draft and locks Stories again', afterSpecs.length === 1 && afterSpecs[0].id !== oldSpec && afterSpecs[0].status === 'draft' && await navLocked('Stories'))

  await page.evaluate(() => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === 'Transcripts').click())
  await page.waitForSelector('[data-testid="transcript-2"]')
  await waitText('All changes saved')
  ok('saved transcripts show line counts and matched speakers', /\d+ lines · \d+ participants?/.test(await text()))
  ok('and nothing is out of date', !(await text()).includes('Analysis is out of date'))

  // Edit one transcript's text: the page is dirty, the analysis re-runs on save.
  await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Edit text')[1].click())
  await page.waitForSelector('#transcript-text-1')
  await page.focus('#transcript-text-1')
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control')
  await page.keyboard.type('\n00:09:00 Daniel Ortiz: I still cannot see the calendar for all providers at once.')
  await waitText('Unsaved changes')
  await clickText('Save and analyze')
  await page.waitForFunction(() => /\/themes$/.test(location.pathname), { timeout: 20000 })
  ok('editing a transcript and saving re-analyzes and returns to Themes', await mine().then((p) => p.themes === 9))
  await page.evaluate(() => [...document.querySelectorAll('[data-nav] a')].find((a) => a.dataset.label === 'Transcripts').click())
  await page.waitForSelector('[data-testid="transcript-2"]')
  ok('the edited transcript kept its place and gained a line', await page.evaluate(() => document.querySelector('[data-testid="transcript-1"]').innerText.includes('Session 2')))

  // Remove them all: the analysis is retired, the project is a draft, and the steps lock again.
  for (let i = 0; i < 3; i++) await page.evaluate(() => [...document.querySelector('[data-testid="transcript-0"]').querySelectorAll('button')].at(-1).click())
  await waitText('No transcripts yet')
  ok('with nothing to analyze the button just says Save', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Save')))
  await clickText('Save')
  await waitText('All changes saved at')
  ok('removing every transcript makes the project a Draft again', await mine().then((p) => p.status === 'draft' && p.sessions === 0 && p.themes === 0))
  ok('and the Analyze steps lock again', await navLocked('Themes'))

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
  ok('flow completes', false, e.message + ' at ' + String(e.stack).split('\n').filter((l) => l.includes('flow.mjs')).slice(0, 2).join(' '))
  await page.screenshot({ path: new URL('./failure.png', import.meta.url).pathname })
}
await browser.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
