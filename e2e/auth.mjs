// Sign-in and roles in the browser, against an in-memory API with the stand-in sign-in service (AUTH_TEST=true): the
// sign-in screen, an owner's header menu and Members page (invite, change role, remove), the not-invited screen, and what
// a viewer sees. Started by e2e/run.mjs, after the main flow.
import puppeteer from 'puppeteer-core'
const BASE = process.env.E2E_AUTH_BASE || 'http://localhost:5199'
const API = process.env.E2E_AUTH_API || 'http://localhost:8792'
const results = []
const ok = (name, cond, extra = '') => { results.push([cond ? 'ok  ' : 'FAIL', name, extra]); console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1400,900', ...(process.env.CI ? ['--no-sandbox'] : [])] })
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('signal-flow-tour', JSON.stringify({ welcomed: true, finished: [] })) } catch { /* ignore */ } }) // the welcome screen is tested in tour.mjs; here it would only be in the way
await page.setViewport({ width: 1400, height: 900 })
page.on('pageerror', (e) => ok('no page errors', false, e.message))
const text = () => page.evaluate(() => document.body.innerText)
const waitText = (t, timeout = 8000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout }, t)
const clickText = async (t, tag = 'button') => {
  const handle = await page.evaluateHandle((t, tag) => [...document.querySelectorAll(tag)].find((el) => el.innerText.trim() === t || el.textContent.trim() === t), t, tag)
  if (!handle.asElement()) throw new Error(`no <${tag}> with text "${t}"`)
  await handle.asElement().click()
}
const clickInOpenDialog = async (t) => page.evaluate((t) => [...document.querySelectorAll('.cds--modal.is-visible button')].find((b) => b.innerText.trim() === t).click(), t)
const signInAs = async (email, id = 'g-' + email) => {
  await page.deleteCookie({ name: 'sf_test_user', url: BASE })
  if (email) await page.setCookie({ name: 'sf_test_user', value: encodeURIComponent(JSON.stringify({ id, email, name: email.split('@')[0] })), url: BASE })
}
const members = async () => (await (await fetch(`${API}/api/v1/members`, { headers: { 'x-test-user': JSON.stringify({ id: 'g-david@demo.signalflow.example', email: 'david@demo.signalflow.example' }) } })).json()).data

try {
  // Signed out, with public viewing off: the sign-in screen, not the app.
  await fetch(`${API}/__test/public-view/false`, { method: 'POST' })
  await signInAs(null)
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Continue with Google')
  ok('signed out, with public viewing off, the sign-in screen is shown instead of the app', (await text()).includes('invite-only') && !(await text()).includes('Projects'))

  // The privacy page is public, even when signing in is required, and the notice is at the foot of the sign-in screen.
  ok('the sign-in screen carries the privacy notice', (await text()).includes('development, testing, and demonstration environment'))
  const policy = await (await fetch(`${BASE}/privacy.html`)).text()
  ok('the privacy policy is plain HTML with real content, readable without running scripts', /<h1>Privacy Policy<\/h1>/.test(policy) && policy.includes('Google API Services User Data Policy') && policy.includes('do not use real personal data'))
  const about = await (await fetch(`${BASE}/about.html`)).text()
  ok('the home page is plain HTML and links to the privacy policy', /<h1>.*Signal Flow<\/h1>/.test(about) && about.includes('href="/privacy"'))

  const landing = await (await fetch(`${BASE}/landing.html`)).text()
  ok('the landing page is plain HTML with a Sign in link and a link to the read-only demo', landing.includes('href="/sign-in"') && landing.includes('href="/insights/themes"') && landing.includes('Explore the read-only demo') && landing.includes('href="/privacy"'))

  // Signed out, with public viewing on: the app, read-only, with a Sign in button.
  await fetch(`${API}/__test/public-view/true`, { method: 'POST' })
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Projects')
  const visitor = await page.evaluate(() => document.querySelector('header')?.innerText ?? '')
  ok('a visitor can look around: projects load, the header says read-only and offers Sign in', visitor.includes('Read-only demo') && visitor.includes('Sign in') && (await page.$$('[data-status]')).length >= 3)
  ok('a visitor cannot start a project or remove one', await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New project')?.disabled === true) && (await page.$$('.cds--overflow-menu')).length === 0)
  const first = (await (await fetch(`${API}/api/v1/projects`)).json()).data[0]
  await page.goto(`${BASE}/projects/${first.id}/plan`, { waitUntil: 'networkidle0' })
  await waitText('Editing is locked')
  ok('a project opens read-only and says how to get editing access', (await text()).includes('Sign in') && (await page.evaluate(() => document.querySelector('#project-name').readOnly === true)))

  // A visitor sees every Platform Insights tab and a project's pages with the sample data, never an error banner
  // (once a visitor's lookup failed with "The demo data is not loaded yet.").
  const errorShown = async () => { const t = await text(); return t.includes('Something went wrong') || t.includes('not loaded yet') }
  let clean = true
  for (const key of ['themes', 'personas', 'journey', 'case-studies']) {
    await page.goto(`${BASE}/insights/${key}`, { waitUntil: 'networkidle0' })
    await waitText('Platform Insights')
    clean = clean && !(await errorShown())
  }
  ok('a visitor sees Platform Themes, Personas, Workflows and Case studies without an error', clean)
  const pagesClean = []
  for (const step of ['plan', 'themes']) {
    await page.goto(`${BASE}/projects/${first.id}/${step}`, { waitUntil: 'networkidle0' })
    pagesClean.push(!(await errorShown()))
  }
  ok('a visitor can open a project\'s pages without an error', pagesClean.every(Boolean))
  // The app menu rests as a dark icon strip and opens over the page; the project's steps are a rail, neutral once every step is open.
  await page.setViewport({ width: 1400, height: 900 })
  await page.goto(`${BASE}/projects/${first.id}/plan`, { waitUntil: 'networkidle0' })
  await page.mouse.move(900, 500)
  await new Promise((r) => setTimeout(r, 400))
  const menu = () => page.evaluate(() => { const a = document.querySelector('aside[aria-label="Main menu"]'); const r = a.getBoundingClientRect(); return { w: Math.round(r.width), bg: getComputedStyle(a).backgroundColor, op: getComputedStyle(a.querySelector('[class*="label"]')).opacity, pageLeft: Math.round(document.querySelector('h1').getBoundingClientRect().left) } })
  const rest = await menu()
  ok('the app menu rests as a 68px near-black icon strip with its names hidden', rest.w === 68 && rest.bg === 'rgb(24, 29, 38)' && rest.op === '0', JSON.stringify(rest))
  await page.hover('aside[aria-label="Main menu"] a')
  await new Promise((r) => setTimeout(r, 600))
  const open = await menu()
  ok('hovering opens it to 240px over the page, names showing, and the page does not move', open.w === 240 && open.op === '1' && open.pageLeft === rest.pageLeft, JSON.stringify(open))
  ok('the open menu sits above the app bar and the project bar', await page.evaluate(() => [[150, 30], [150, 85], [200, 300]].every(([x, y]) => !!document.elementFromPoint(x, y)?.closest('aside[aria-label="Main menu"]'))))
  await page.mouse.move(900, 500)
  await new Promise((r) => setTimeout(r, 600))
  ok('moving away closes it again', (await menu()).w === 68)
  const states = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Project steps"] a')].map((a) => a.dataset.state))
  ok('the steps are a vertical rail of ten, and with every step open they all read neutral', states.length === 10 && (states.every((x) => x === 'done') || states.includes('locked')), states.join())

  // /sign-in sends someone who is already signed in straight to the projects.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => location.pathname === '/insights/themes', { timeout: 8000 })
  ok('/sign-in takes a signed-in person to Platform Insights, the home page', true)
  await signInAs(null)

  // A signed-in owner: the app, with their name and role and an account menu.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Projects')
  const header = await page.evaluate(() => document.querySelector('header')?.innerText ?? '')
  ok('an owner sees no token controls in the header (the role is in the account panel)', !header.includes('Editing unlocked') && !header.includes('Unlock editing') && !header.includes('Lock'))
  // AI status is a link in the account menu (a canned live status stands in for the always-simulated test API).
  await page.setRequestInterception(true)
  const canned = (req) => new URL(req.url()).pathname === '/api/v1/ai/status' ? req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'live', enabled: true, budgetUsd: 10, spentUsd: 1, spendLevel: 'ok', month: '2026-11' }) }) : req.continue()
  page.on('request', canned)
  await page.reload({ waitUntil: 'networkidle0' })
  await waitText('Projects')
  ok('the AI badge sits at the left of the header, the account picture at the right', await page.evaluate(() => {
    const bar = document.querySelector('header').getBoundingClientRect()
    const badge = [...document.querySelectorAll('header .cds--tag')].find((t) => t.innerText.startsWith('AI:'))?.getBoundingClientRect()
    const account = document.querySelector('[data-testid="account-button"]')?.getBoundingClientRect()
    return !!badge && !!account && badge.left < bar.left + bar.width / 3 && account.right > bar.right - bar.width / 4 && !document.querySelector('header .cds--overflow-menu')
  }))
  ok('the header shows a picture (initials here) instead of the name', await page.evaluate(() => !!document.querySelector('[data-testid="account-button"] [data-testid="avatar"]') && !document.querySelector('header').innerText.includes('David')))
  await page.click('[aria-label="Account"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="account-panel"]')?.innerText.includes('david@demo.signalflow.example'), { timeout: 5000 })
  ok('the picture opens a panel with a larger picture, the name, the email and Sign out, and no Members or AI status links', await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="account-panel"]')
    const big = panel.querySelector('[data-testid="avatar"]').getBoundingClientRect().width
    const small = document.querySelector('[data-testid="account-button"] [data-testid="avatar"]').getBoundingClientRect().width
    const links = [...document.querySelectorAll('.cds--popover-content button')].map((b) => b.innerText.trim())
    return big > small * 2 && panel.innerText.toLowerCase().includes('owner') && links.includes('Sign out') && !links.includes('Members') && !links.includes('AI status')
  }))
  ok('the account panel offers My approvals, the launches a person can see and where their answer waits', await page.evaluate(() => [...document.querySelectorAll('.cds--popover-content button')].some((b) => b.innerText.trim() === 'My approvals')))
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}/settings/status`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.body.innerText.includes('$1.00 of $10.00'), { timeout: 5000 })
  ok('AI usage and costs is an Admin tab with the AI mode, the spend against the budget and the recent problems', await page.evaluate(() => { const t = document.body.innerText; return document.querySelector('nav[aria-label="Admin sections"] [data-label="AI usage and costs"]')?.dataset.current === 'true' && /AI: live/.test(t) && /Recent problems/i.test(t) && /No problems in the past 30 days/.test(t) }))
  await new Promise((r) => setTimeout(r, 600))
  await page.evaluate(() => document.querySelector('nav[aria-label="Admin sections"] [data-label="System usage"]').click())
  await page.waitForSelector('[data-testid="usage-database"]', { timeout: 8000 })
  ok('System usage is an Admin tab with the database size against its limit, read from the database itself', await page.evaluate(() => { const card = document.querySelector('[data-testid="usage-database"]'); return location.pathname === '/settings/usage' && /Database size/.test(card.innerText) && /\d+ (KB|MB|GB) of 1\.00 GB \(\d+%\)/.test(card.innerText) && !!card.querySelector('[role="progressbar"]') }))
  page.off('request', canned)
  await page.setRequestInterception(false)
  await page.reload({ waitUntil: 'networkidle0' })
  await waitText('Projects')
  await page.goto(`${BASE}/members`, { waitUntil: 'networkidle0' })
  ok('the old Members address lands on the Admin People tab', await page.evaluate(() => location.pathname === '/settings/people' && document.querySelector('nav[aria-label="Admin sections"] [data-label="People"]')?.dataset.current === 'true'))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' })
  await waitText('Experience')
  await page.evaluate(() => document.querySelector('nav[aria-label="Admin sections"] [data-label="People"]').click())
  await page.waitForSelector('[data-testid="people-table"]', { timeout: 8000 })
  await waitText('sam@demo.signalflow.example') // the list arrives after the form
  ok('the People tab lists the demo people, each with a role, teams and approvals', await page.evaluate(() => { const row = document.querySelector('[data-testid="person-sam@demo.signalflow.example"]'); return !!row && /Viewer/.test(row.innerText) && /General/.test(row.innerText) && !!document.querySelector('[data-testid="approvals-sam@demo.signalflow.example"]') }))
  const panelOpen = (testid) => page.waitForSelector(`.cds--modal.is-visible [data-testid="${testid}"]`, { visible: true, timeout: 5000 })
  const inPanel = (sel) => page.evaluate((x) => document.querySelector(`.cds--modal.is-visible ${x}`).click(), sel)

  // An external person is invited as a viewer, in no team.
  await page.click('[data-testid="invite-person"]')
  await panelOpen('invite-panel')
  await page.type('.cds--modal.is-visible #invite-email', 'e2e.counsel@example.com')
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible label[for="invite-external"]').click())
  ok('choosing external hides the role and teams, and says external people join no team', await page.evaluate(() => { const t = document.querySelector('.cds--modal.is-visible [data-testid="invite-panel"]').innerText; return !document.querySelector('.cds--modal.is-visible [data-testid="team-picker"]') && !document.querySelector('.cds--modal.is-visible [data-testid="invite-role-owner"]') && /don’t join teams/.test(t) && /cannot be changed later/.test(t) }))
  await inPanel('[data-testid="save-invite"]')
  await waitText('e2e.counsel@example.com is invited as an external viewer')
  const counsel = await page.evaluate(async () => (await (await fetch('/api/v1/members')).json()).data.find((m) => m.email === 'e2e.counsel@example.com'))
  ok('an external invitation is saved as an external viewer in no team, and the list marks it', counsel?.external === true && counsel.role === 'viewer' && counsel.teams.length === 0 && await page.evaluate(() => /External/.test(document.querySelector('[data-testid="person-e2e.counsel@example.com"]').innerText)))
  await new Promise((r) => setTimeout(r, 400))

  // Invite with a role and teams, then change the role in the person's panel.
  await page.click('[data-testid="invite-person"]')
  await panelOpen('invite-panel')
  await page.type('.cds--modal.is-visible #invite-email', 'not-an-address')
  ok('an email that is not one says so, and Invite stays off', await page.evaluate(() => /valid email/.test(document.querySelector('.cds--modal.is-visible [data-testid="invite-panel"]').innerText) && document.querySelector('.cds--modal.is-visible [data-testid="save-invite"]').disabled === true))
  await page.click('.cds--modal.is-visible #invite-email', { clickCount: 3 })
  await page.type('.cds--modal.is-visible #invite-email', 'e2e.person@example.com')
  ok('the default team is ticked for a new invitation', await page.evaluate(() => !!document.querySelector('.cds--modal.is-visible [data-testid="team-picker"] input[type="checkbox"]:checked')))
  await inPanel('[data-testid="save-invite"]')
  await waitText('e2e.person@example.com is invited as editor')
  ok('inviting adds the person as invited, with the chosen role, in the default team', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'editor' && m.status === 'invited' && m.teams.length === 1 && m.teams[0].name === 'General'))
  await new Promise((r) => setTimeout(r, 400))
  await page.click('[data-testid="open-person-e2e.person@example.com"]')
  await panelOpen('person-panel')
  ok('a person’s panel shows their role, teams and approvals, and a way to remove them', await page.evaluate(() => { const t = document.querySelector('.cds--modal.is-visible [data-testid="person-panel"]').innerText; return /Workspace role/.test(t) && /Teams/.test(t) && /Not an approver/.test(t) && !!document.querySelector('.cds--modal.is-visible [data-testid="remove-person"]') }))
  await inPanel('[data-testid="person-role-viewer"]')
  await inPanel('[data-testid="cancel-person"]')
  await new Promise((r) => setTimeout(r, 500))
  ok('a cancelled panel changes nothing', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'editor'))
  await page.click('[data-testid="open-person-e2e.person@example.com"]')
  await panelOpen('person-panel')
  await inPanel('[data-testid="person-role-viewer"]')
  await inPanel('[data-testid="save-person"]')
  await waitText('Changes saved')
  ok('changing the role and saving it saves it', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'viewer'))
  await new Promise((r) => setTimeout(r, 400))
  await page.click('[data-testid="open-person-e2e.counsel@example.com"]')
  await panelOpen('person-panel')
  ok('an external person’s role cannot be changed, and they have no teams to choose', await page.evaluate(() => { const t = document.querySelector('.cds--modal.is-visible [data-testid="person-panel"]').innerText; return /Viewer \(external\)/.test(t) && /cannot be changed/.test(t) && !document.querySelector('.cds--modal.is-visible [data-testid="team-picker"]') }))
  await inPanel('[data-testid="cancel-person"]')
  await new Promise((r) => setTimeout(r, 400))

  // The audit log records what the owner just did.
  await page.evaluate(() => document.querySelector('nav[aria-label="Admin sections"] [data-label="Audit log"]').click())
  await page.waitForSelector('[data-testid="audit-row"]', { timeout: 8000 })
  ok('the Audit log tab lists who changed what, newest first, including the invitation and the role change just made', await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="audit-row"]')].map((r) => r.innerText); return location.pathname === '/settings/audit' && rows.length >= 2 && /Member/.test(rows[0]) && rows.some((r) => /e2e\.person@example\.com/.test(r) && /role/i.test(r)) && rows.some((r) => /Created|Invited/i.test(r) && /e2e\.person@example\.com/.test(r)) }))

  // Teams: the owner makes a team in a panel, moves a project into it, and a person who is not in it no longer sees that project.
  await page.evaluate(() => document.querySelector('nav[aria-label="Admin sections"] [data-label="Teams"]').click())
  await page.waitForSelector('[data-testid="teams-table"]', { timeout: 8000 })
  await waitText('Default')
  ok('Teams is an Admin tab for owners: the default team holds the demo people and the projects', await page.evaluate(async () => { const r = await (await fetch('/api/v1/teams')).json(); const g = r.data.find((t) => t.isDefault); const row = document.querySelector('[data-testid="team-General"]'); return location.pathname === '/settings/teams' && g?.name === 'General' && g.members.length >= 3 && g.projects.length >= 3 && /Default/.test(row.innerText) && /people/.test(row.innerText) && /gaps?|Covered/.test(document.querySelector('[data-testid="team-approvals-General"]').innerText) }))
  await page.click('[data-testid="new-team"]')
  await panelOpen('team-panel')
  await page.type('.cds--modal.is-visible #team-name', 'general')
  ok('a team name another team has is refused, whatever its case, and Create stays off', await page.evaluate(() => /already exists/.test(document.querySelector('.cds--modal.is-visible [data-testid="team-panel"]').innerText) && document.querySelector('.cds--modal.is-visible [data-testid="save-team"]').disabled === true))
  await page.click('.cds--modal.is-visible #team-name', { clickCount: 3 })
  await page.type('.cds--modal.is-visible #team-name', 'Support')
  await page.type('.cds--modal.is-visible #team-slack', 'Bad Channel!')
  ok('a Slack channel Slack would not accept is refused with the rule', await page.evaluate(() => /lowercase letters/.test(document.querySelector('.cds--modal.is-visible [data-testid="team-panel"]').innerText) && document.querySelector('.cds--modal.is-visible [data-testid="save-team"]').disabled === true))
  await page.click('.cds--modal.is-visible #team-slack', { clickCount: 3 })
  await page.type('.cds--modal.is-visible #team-slack', 'support-launches')
  await inPanel('[data-testid="save-team"]')
  await page.waitForSelector('[data-testid="team-Support"]', { timeout: 8000 })
  ok('a new team is created with its channel, empty and ready for people and projects', await page.evaluate(async () => { const row = document.querySelector('[data-testid="team-Support"]').innerText; const t = (await (await fetch('/api/v1/teams')).json()).data.find((x) => x.name === 'Support'); return /#support-launches/.test(row) && /0 people/.test(row) && t.projects.length === 0 && t.slackChannel === 'support-launches' }))
  await new Promise((r) => setTimeout(r, 400))
  // Open General, and move its first project to Support.
  const supportId = await page.evaluate(async () => (await (await fetch('/api/v1/teams')).json()).data.find((t) => t.name === 'Support').id)
  await page.click('[data-testid="open-team-General"]')
  await panelOpen('team-panel')
  const moving = await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid^="team-project-"]').getAttribute('data-testid').replace('team-project-', ''))
  ok('the default team cannot be deleted, and says why', await page.evaluate(() => /default team/i.test(document.querySelector('.cds--modal.is-visible [data-testid="delete-blocked"]')?.innerText ?? '')))
  await page.select('.cds--modal.is-visible [data-testid^="team-project-"] select', supportId)
  await inPanel('[data-testid="save-team"]')
  await waitText('Changes saved')
  await new Promise((r) => setTimeout(r, 400))
  const movedId = await page.evaluate(async (name) => { const r = await (await fetch('/api/v1/teams')).json(); return r.data.find((t) => t.name === 'Support').projects.find((p) => p.name === name)?.id ?? null }, moving)
  ok('moving a project from the default team to Support puts it in Support', !!movedId)
  ok('the owner is a leader, so still sees it, but cannot change it: not a member of Support', await page.evaluate(async (id) => (await fetch(`/api/v1/projects/${id}`)).status === 200 && (await fetch(`/api/v1/projects/${id}/tasks`, { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '1' }, body: JSON.stringify({ tasks: [] }) })).status === 403, movedId))

  await page.goto(`${BASE}/settings/audit`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('#audit-team', { timeout: 8000 })
  await page.click('#audit-team')
  await page.waitForSelector('[role=option]', { visible: true })
  await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.trim() === 'Support').click())
  await new Promise((r) => setTimeout(r, 800))
  ok('the audit log can be narrowed to one team: its creation and the project moved into it, each naming the team', await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="audit-row"]')].map((r) => r.innerText); return rows.length >= 2 && rows.every((r) => r.includes('Support')) && rows.some((r) => /project moved/i.test(r)) }))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('#project-team-filter', { timeout: 8000 })
  ok('with two teams the list names each project’s team and marks a leader’s read-only view', await page.evaluate(() => { const t = [...document.querySelectorAll('[data-testid="project-team"]')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()); return t.some((x) => x === 'Support · View only') && t.some((x) => x === 'General') }))
  await page.click('#project-team-filter')
  await page.waitForSelector('[role=option]', { visible: true })
  await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.trim() === 'Support').click())
  await new Promise((r) => setTimeout(r, 400))
  ok('the team filter narrows the list to that team’s projects', await page.evaluate(() => /^1 project$/.test(document.body.innerText.match(/\d+ projects?/)?.[0] ?? '') && document.querySelectorAll('[data-testid="project-team"]').length === 1))

  // Launch approvals: one grid for the workspace and each team; a step is edited in a panel that saves as one change.
  const api = (path, init) => page.evaluate(async (path, init) => (await fetch(`/api/v1${path}`, init)).json(), path, init)
  const person = async (key) => (await api('/approvals')).people.find((x) => x.email.startsWith(`${key}@`) || x.email === key).userId
  await page.goto(`${BASE}/settings/members?tab=reviewers`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="approvals-grid"]', { timeout: 8000 })
  ok('the old Reviewers address lands on the Approvals tab', page.url().endsWith('/settings/approvals'))
  ok('Approvals is an Admin tab, and Members no longer has a Reviewers tab', await page.evaluate(() => [...document.querySelectorAll('[aria-label="Admin sections"] button')].some((b) => b.innerText.trim() === 'Approvals' && b.getAttribute('aria-current') === 'page')))
  ok('the grid shows every step, a column per team, and says how many steps have nobody', await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid^="step-row-"]')].map((r) => r.dataset.testid.replace('step-row-', '')); return rows.join() === 'product_leadership,sales,legal,documentation,marketing,final_decision' && /steps without an approver/.test(document.querySelector('[data-testid="gap-summary"]').innerText) && [...document.querySelectorAll('[role="columnheader"]')].map((h) => h.innerText.trim()).join('|').toLowerCase().includes('support') }))
  const panel = (sel) => `.cds--modal.is-visible ${sel}`
  const openStep = async (key) => { await page.evaluate((k) => document.querySelector(`[data-testid="open-step-${k}"]`).click(), key); await page.waitForSelector(panel(`[data-testid="step-panel"][data-step="${key}"]`), { visible: true, timeout: 5000 }) }
  // Sales: Support does not use it.
  await openStep('sales')
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="team-mode-Support-off"]').click())
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="save-step"]').click())
  await page.waitForFunction(() => document.querySelector('[data-testid="cell-sales-Support"]')?.dataset.mode === 'off', { timeout: 8000 })
  ok('turning a step off for a team (Not used) saves and the grid marks it', await page.evaluate(() => { const c = document.querySelector('[data-testid="cell-sales-Support"]'); return c.dataset.state === 'not_used' && /Not used/.test(c.innerText) && document.querySelector('[data-testid="cell-sales-General"]').dataset.state === 'gap' }))
  await new Promise((r) => setTimeout(r, 400))
  // The final decision is always used.
  await openStep('final_decision')
  ok('the final decision cannot be set to Not used', await page.evaluate(() => [...document.querySelectorAll('.cds--modal.is-visible [data-testid^="team-mode-"][data-testid$="-off"]')].every((b) => b.disabled)))
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="cancel-step"]').click())
  await new Promise((r) => setTimeout(r, 400))
  // Legal: choose an approver, and an external person cannot be the workspace approver.
  await openStep('legal')
  const alexId = await person('alex')
  const samId = await person('sam')
  ok('an external person is offered, disabled, as a workspace approver (they can approve for a team only)', await page.evaluate(() => { const o = [...document.querySelectorAll('.cds--modal.is-visible #approver-select option')].find((x) => /e2e\.counsel@example\.com/.test(x.textContent)); return !!o && o.disabled === true && /external/.test(o.textContent) }))
  await page.select('.cds--modal.is-visible #approver-select', alexId)
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="save-step"]').click())
  await page.waitForFunction(() => document.querySelector('[data-testid="cell-legal-Support"]')?.dataset.state === 'covered', { timeout: 8000 })
  ok('choosing a workspace approver covers that step for every team that uses the workspace approver', await page.evaluate(() => document.querySelector('[data-testid="cell-legal-General"]').dataset.state === 'covered' && /Alex/.test(document.querySelector('[data-testid="step-row-legal"]').innerText)))
  await new Promise((r) => setTimeout(r, 400))
  // The Use backup toggle: disabled, with the reason, until there is a backup.
  ok('Use backup is disabled with a reason while the step has no backup', await page.evaluate(() => { const w = document.querySelector('[data-testid="use-backup-legal"]'); return /backup/i.test(w.getAttribute('title') ?? '') && w.querySelector('button[role="switch"]').disabled === true && /No backup/.test(w.innerText) }))
  await openStep('legal')
  await page.select('.cds--modal.is-visible #backup-select', samId)
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="save-step"]').click())
  await page.waitForFunction(() => document.querySelector('[data-testid="use-backup-legal"] button[role="switch"]')?.disabled === false, { timeout: 8000 })
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => document.querySelector('[data-testid="use-backup-legal"] button[role="switch"]').click())
  await page.waitForSelector('[data-testid="away-dialog"]', { timeout: 5000 })
  ok('turning on Use backup asks first, naming who covers', await page.evaluate(() => /Sam/.test(document.querySelector('[data-testid="away-dialog"]').innerText)))
  await page.evaluate(() => [...document.querySelectorAll('.cds--modal.is-visible button')].find((b) => b.innerText.trim() === 'Use backup').click())
  await page.waitForFunction(() => document.querySelector('[data-testid="use-backup-legal"] button[role="switch"]')?.getAttribute('aria-checked') === 'true', { timeout: 8000 })
  ok('after confirming, the approver is marked away and the toggle is on', (await api('/approvals')).people.find((x) => x.email.startsWith('alex@')).unavailable === true)
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => document.querySelector('[data-testid="use-backup-legal"] button[role="switch"]').click())
  await page.waitForFunction(() => document.querySelector('[data-testid="use-backup-legal"] button[role="switch"]')?.getAttribute('aria-checked') === 'false', { timeout: 8000 })
  ok('turning it off acts at once', (await api('/approvals')).people.find((x) => x.email.startsWith('alex@')).unavailable === false)
  // A team of its own: the panel shows who ends up approving.
  await openStep('marketing')
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="team-mode-Support-custom"]').click())
  await page.waitForSelector(panel('[id^="team-approver-"]'), { timeout: 5000 })
  ok('choosing Team approver reveals its approver and backup pickers, and Save waits for an approver', await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="save-step"]').disabled === true && !!document.querySelector('.cds--modal.is-visible [id^="team-backup-"]')))
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="cancel-step"]').click())
  await new Promise((r) => setTimeout(r, 400))
  ok('a cancelled panel changes nothing', await page.evaluate(() => document.querySelector('[data-testid="cell-marketing-Support"]').dataset.mode === 'default'))
  ok('approver changes are in the audit log under their own filter', (await api('/audit?group=reviewers')).data.length >= 3)
  // An external reviewer's whole app: a list of the launches they are asked to review (none yet), and none of the usual menu.
  await signInAs('e2e.counsel@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Launches to review')
  ok('an external member sees only the launches they are asked to review, with no menu and a way to sign out', await page.evaluate(() => /No launches yet/.test(document.body.innerText) && !document.querySelector('[data-nav]') && /external approver/.test(document.body.innerText) && [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Sign out')))
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/settings/people`, { waitUntil: 'networkidle0' })
  await waitText('Invite person')
  await page.evaluate(async (id) => { await fetch(`/api/v1/members/${id}`, { method: 'DELETE' }) }, counsel.id)

  // The invited person signs in: linked, read-only, and no invite form.
  await signInAs('e2e.person@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Projects')
  ok('a viewer does not see Admin in the menu', await page.evaluate(() => ![...document.querySelectorAll('[data-nav] a')].some((a) => a.textContent.includes('Admin'))))
  for (const path of ['/settings/categories', '/settings/members', '/settings/people', '/settings/approvals', '/settings/audit', '/settings/usage', '/members']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => location.pathname === '/projects', { timeout: 8000 })
  }
  ok('a viewer who types an Admin address is sent back to the projects', true)
  ok('the server refuses a viewer the member list, the audit log, system usage and the AI status details', await page.evaluate(async () => (await fetch('/api/v1/members')).status === 403 && (await fetch('/api/v1/audit')).status === 403 && (await fetch('/api/v1/usage')).status === 403 && !('spentUsd' in (await (await fetch('/api/v1/ai/status')).json()))))
  ok('a person in another team does not see the project at all: not in their list, not found by address', await page.evaluate(async (id, name) => { const list = (await (await fetch('/api/v1/projects')).json()).data; return !list.some((p) => p.id === id) && list.length > 0 && (await fetch(`/api/v1/projects/${id}`)).status === 404 && (await fetch(`/api/v1/projects/${id}/themes`)).status === 404 }, movedId, moving))
  ok('and the first sign-in marked them as signed in', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.status === 'active'))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Projects')
  ok('a viewer cannot start a new project', await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New project')?.disabled === true))

  // A Google account nobody invited.
  await signInAs('stranger@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('You have not been invited')
  ok('an uninvited account gets the not-invited screen with its address', (await text()).includes('stranger@example.com') && !(await text()).includes('Projects'))

  // The owner removes the person, who is then locked out.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/settings/people`, { waitUntil: 'networkidle0' })
  await waitText('e2e.person@example.com')
  await page.click('[data-testid="open-person-e2e.person@example.com"]')
  await panelOpen('person-panel')
  await inPanel('[data-testid="remove-person"]')
  await page.waitForSelector('.cds--modal.is-visible [data-testid="remove-confirm"]', { visible: true })
  ok('removing asks first, and says what happens', await page.evaluate(() => /lose access right away/.test(document.querySelector('.cds--modal.is-visible [data-testid="remove-confirm"]').innerText)))
  await inPanel('[data-testid="confirm-remove"]')
  await page.waitForFunction(() => !document.querySelector('[data-testid="person-e2e.person@example.com"]'), { timeout: 8000 })
  await new Promise((r) => setTimeout(r, 600))
  ok('removing a member takes them off the list', !(await members()).some((m) => m.email === 'e2e.person@example.com'))
  await signInAs('e2e.person@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('You have not been invited')
  ok('and they are locked out', true)
} catch (e) {
  ok('auth flow completes', false, e.message)
  await page.screenshot({ path: new URL('./failure-auth.png', import.meta.url).pathname })
}
await browser.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
