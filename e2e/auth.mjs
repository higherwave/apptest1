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
// Puppeteer 25 no longer selects a field's text on a triple click: select it explicitly, so typing replaces it.
const selectAll = async (sel) => { await page.click(sel); await page.$eval(sel, (el) => el.select()) }
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
  const bar = () => page.evaluate(() => { const h = document.querySelector('header'); const r = h.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(h).backgroundColor, name: h.querySelector('[data-testid="app-brand"]')?.innerText.trim(), launcher: !!h.querySelector('[data-testid="app-launcher"]'), full: Math.round(r.width) === innerWidth } })
  const top = await bar()
  ok('the app header is one dark bar across the top, with the launcher at the left and the app name beside it', top.left === 0 && top.top === 0 && top.full && top.h === 64 && top.bg === 'rgb(42, 45, 52)' && top.launcher && top.name === 'Signal Flow', JSON.stringify(top))
  await page.click('[data-testid="app-launcher"]')
  await page.waitForSelector('[data-testid="launcher-panel"]', { visible: true, timeout: 4000 })
  ok('the launcher opens a panel of apps, the suite home first and Signal Flow marked as the current one', await page.evaluate(() => { const l = [...document.querySelectorAll('[data-testid="launcher-panel"] a')]; return l[0]?.dataset.label === 'Platform Insights home' && l.find((a) => a.dataset.label === 'Signal Flow')?.getAttribute('aria-current') === 'true' }))
  ok('and the Prototype gallery and the Decision Guides open in another tab, safely', await page.evaluate(() => { const g = document.querySelector('[data-testid="launcher-panel"] a[data-label="Prototype gallery"]'); const d = document.querySelector('[data-testid="launcher-panel"] a[data-label="Decision Guides"]'); return !!g && !!d && [g, d].every((a) => a.target === '_blank' && /noopener/.test(a.rel)) && /^https:\/\/thehigherwave\.com\/?$/.test(g.href) && d.href === 'https://www.thehigherwave.com/prototypes/productivity/decision-guides/index.html' }))
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 400))
  ok('Escape closes the launcher again', await page.waitForFunction(() => { const el = document.querySelector('[data-testid="launcher-panel"]'); return !el || el.offsetParent === null || el.getBoundingClientRect().height === 0 }, { timeout: 3000 }).then(() => true, () => false))
  const states = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Project steps"] a:not([href="/projects"])')].map((a) => a.dataset.state))
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
  ok('the AI badge sits in the right-hand group of the header, with the account picture at the far right', await page.evaluate(() => {
    const bar = document.querySelector('header').getBoundingClientRect()
    const badge = [...document.querySelectorAll('header .cds--tag')].find((t) => t.innerText.startsWith('AI:'))?.getBoundingClientRect()
    const account = document.querySelector('[data-testid="account-button"]')?.getBoundingClientRect()
    return !!badge && !!account && badge.left > bar.left + bar.width / 2 && account.right > bar.right - bar.width / 4 && !document.querySelector('header .cds--overflow-menu')
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
  ok('an owner’s account panel has a Settings link, which opens Settings', await (async () => { const has = await page.evaluate(() => [...document.querySelectorAll('.cds--popover-content button')].some((b) => b.innerText.trim() === 'Settings')); await page.click('[data-testid="account-settings"]'); await page.waitForFunction(() => location.pathname.startsWith('/settings'), { timeout: 5000 }); return has })())
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}/settings/status`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.body.innerText.includes('$1.00 of $10.00'), { timeout: 5000 })
  ok('Usage and Costs opens on AI (the old AI address redirects there), with the AI mode, the spend against the budget and the recent problems', await page.evaluate(() => { const t = document.body.innerText; return document.querySelector('nav[aria-label="Settings sections"] [data-label="AI"]')?.getAttribute('aria-current') === 'page' && location.search === '?tab=ai' && /AI: live/.test(t) && /Recent problems/i.test(t) && /No problems in the past 30 days/.test(t) }))
  await new Promise((r) => setTimeout(r, 600))
  await page.click('[data-testid="tab-system"]')
  await page.waitForSelector('[data-testid="usage-database"]', { timeout: 8000 })
  ok('System is a sub-tab of Usage and Costs with the database size against its limit, read from the database itself', await page.evaluate(() => { const card = document.querySelector('[data-testid="usage-database"]'); return location.pathname === '/settings/usage' && location.search === '?tab=system' && /Database size/.test(card.innerText) && /\d+ (KB|MB|GB) of 1\.00 GB \(\d+%\)/.test(card.innerText) && !!card.querySelector('[role="progressbar"]') }))
  page.off('request', canned)
  await page.setRequestInterception(false)
  await page.reload({ waitUntil: 'networkidle0' })
  await waitText('Projects')
  await page.goto(`${BASE}/members`, { waitUntil: 'networkidle0' })
  ok('the old Members address lands on People, under User Access', await page.evaluate(() => location.pathname === '/settings/access' && location.search === '?tab=people' && document.querySelector('nav[aria-label="Settings sections"] [data-label="People"]')?.getAttribute('aria-current') === 'page' && document.querySelector('[data-testid="tab-people"]')?.getAttribute('aria-current') === 'page'))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' })
  await waitText('Experience')
  await page.evaluate(() => document.querySelector('nav[aria-label="Settings sections"] [data-label="People"]').click())
  await page.waitForSelector('[data-testid="people-table"]', { timeout: 8000 })
  ok('the Settings menu groups Categories and Matches, AI and System, Notifications, People, Teams and Approvals, Data and Audit log, and Previews', await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Settings sections"] a')].map((b) => b.innerText.trim().replace(/ · \d+$/, '')).join('|') === 'Categories|Matches|AI|System|Notifications|People|Teams|Approvals|Data|Audit log|Previews' && [...document.querySelectorAll('nav[aria-label="Settings sections"] [role="group"]')].map((g) => g.getAttribute('aria-label')).join('|') === 'Experience Categories|Usage and Costs|Communication|User Access|Data and Compliance|Previews'))
  await waitText('sam@demo.signalflow.example') // the list arrives after the form
  ok('the People tab lists the demo people, each with a role, teams and approvals', await page.evaluate(() => { const row = document.querySelector('[data-testid="person-sam@demo.signalflow.example"]'); return !!row && /Viewer/.test(row.innerText) && /Platform/.test(row.innerText) && !!document.querySelector('[data-testid="approvals-sam@demo.signalflow.example"]') }))
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
  await selectAll('.cds--modal.is-visible #invite-email')
  await page.type('.cds--modal.is-visible #invite-email', 'e2e.person@example.com')
  ok('the default team is ticked for a new invitation', await page.evaluate(() => !!document.querySelector('.cds--modal.is-visible [data-testid="team-picker"] input[type="checkbox"]:checked')))
  await inPanel('[data-testid="save-invite"]')
  await waitText('e2e.person@example.com is invited as editor')
  ok('inviting adds the person as invited, with the chosen role, in the default team', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'editor' && m.status === 'invited' && m.teams.length === 1 && m.teams[0].name === 'Platform'))
  await new Promise((r) => setTimeout(r, 400))
  await page.click('[data-testid="open-person-e2e.person@example.com"]')
  await panelOpen('person-panel')
  ok('a person’s panel shows their role, teams and approvals, and a way to remove them', await page.evaluate(() => { const t = document.querySelector('.cds--modal.is-visible [data-testid="person-panel"]').innerText; return /Workspace role/.test(t) && /Teams/.test(t) && /Not an approver/.test(t) && /Add approvals in the Approvals tab/.test(t) && !document.querySelector('.cds--modal.is-visible [data-testid="manage-approvals"]') && !!document.querySelector('.cds--modal.is-visible [data-testid="remove-person"]') }))
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
  await page.evaluate(() => document.querySelector('nav[aria-label="Settings sections"] [data-label="Audit log"]').click())
  await page.waitForSelector('[data-testid="audit-row"]', { timeout: 8000 })
  ok('the Audit log tab lists who changed what, newest first, including the invitation and the role change just made', await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="audit-row"]')].map((r) => r.innerText); return location.pathname === '/settings/audit' && rows.length >= 2 && /Member/.test(rows[0]) && rows.some((r) => /e2e\.person@example\.com/.test(r) && /role/i.test(r)) && rows.some((r) => /Created|Invited/i.test(r) && /e2e\.person@example\.com/.test(r)) }))
  // The date filter is one dropdown of presets. What was just done is in Today, and the server narrows by date.
  await page.click('#audit-range')
  await page.waitForSelector('[role=option]', { visible: true })
  ok('the When filter offers All time, Today and the last 7, 30 and 90 days', await page.evaluate(() => [...document.querySelectorAll('[role=option]')].map((o) => o.innerText.trim()).join('|') === 'All time|Today|Last 7 days|Last 30 days|Last 90 days'))
  await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.trim() === 'Today').click())
  await new Promise((r) => setTimeout(r, 800))
  ok('Today still lists what was just done', await page.evaluate(() => document.querySelectorAll('[data-testid="audit-row"]').length > 0))
  ok('and a start in the future lists nothing', await page.evaluate(async () => (await (await fetch(`/api/v1/audit?since=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`)).json()).data.length === 0))

  // Data: the owner can take the data away, and it is recorded.
  await page.evaluate(() => document.querySelector('nav[aria-label="Settings sections"] [data-label="Data"]').click())
  await page.waitForSelector('[data-testid="data-downloads"]', { timeout: 8000 })
  ok('the Data tab offers the three downloads and says how long things are kept', await page.evaluate(() => ['workspace', 'audit', 'usage'].every((k) => document.querySelector(`[data-testid="download-${k}"]`)) && /12 months/.test(document.querySelector('[data-testid="data-keeping"]').innerText) && /90 days/.test(document.querySelector('[data-testid="data-keeping"]').innerText)))
  await page.click('[data-testid="download-audit"]')
  await page.waitForSelector('[data-testid="download-done"]', { timeout: 10000 })
  ok('downloading the audit log works and names the file', await page.evaluate(() => /^audit-log-\d{4}-\d{2}-\d{2}\.csv$/.test(document.querySelector('[data-testid="download-done"]').innerText.replace('Downloaded', '').trim())))
  await page.click('[data-testid="download-workspace"]')
  await page.waitForFunction(() => /signal-flow-.*\.zip/.test(document.querySelector('[data-testid="download-done"]')?.innerText ?? ''), { timeout: 20000 })
  ok('downloading all of the data gives a ZIP', true)
  ok('each download is in the audit log', await page.evaluate(async () => (await (await fetch('/api/v1/audit?group=data')).json()).data.filter((e) => e.verb === 'exported').length >= 2))
  // Legal hold: an owner places one with a reason, it shows as in force, and releasing it puts it in the history.
  await page.type('#hold-reason', 'E2E matter: a customer dispute')
  await page.click('[data-testid="hold-place"]')
  await page.waitForSelector('[data-testid="hold-row"]', { timeout: 8000 })
  ok('a legal hold on the workspace shows as in force with its reason', await page.evaluate(() => /In force/.test(document.querySelector('[data-testid="hold-row"]').innerText) && /customer dispute/.test(document.querySelector('[data-testid="hold-row"]').innerText)))
  ok('while it is in force the server refuses to delete for good', await page.evaluate(async () => { const t = (await (await fetch('/api/v1/trash')).json()); const id = (await (await fetch('/api/v1/projects')).json()).data[0].id; const r = await fetch(`/api/v1/projects/${id}?permanent=true`, { method: 'DELETE' }); return r.status === 409 && (await r.json()).error.code === 'legal_hold' && Array.isArray(t.data) }))
  await page.click('[data-testid="hold-release"]')
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => [...document.querySelectorAll('.cds--modal.is-visible button')].find((b) => b.innerText.trim() === 'Release').click())
  await page.waitForFunction(() => !document.querySelector('[data-testid="hold-row"]'), { timeout: 8000 })
  await new Promise((r) => setTimeout(r, 600)) // the dialog finishes closing before the next click
  ok('releasing it ends the hold, and it stays in the history', await page.evaluate(() => /released/i.test(document.querySelector('[data-testid="legal-hold"]').innerText)))

  // Teams: the owner makes a team in a panel, moves a project into it, and a person who is not in it no longer sees that project.
  await page.evaluate(() => document.querySelector('nav[aria-label="Settings sections"] [data-label="People"]').click())
  await page.waitForSelector('[data-testid="people-table"]', { timeout: 8000 }) // the People tab has loaded, so the tabs stay put when clicked
  await page.waitForSelector('[data-testid="tab-teams"]', { timeout: 8000 })
  await page.click('[data-testid="tab-teams"]')
  await page.waitForSelector('[data-testid="teams-table"]', { timeout: 8000 })
  await waitText('Default')
  ok('Teams is a sub-tab of User Access: the default team holds the demo people and the projects', await page.evaluate(async () => { const r = await (await fetch('/api/v1/teams')).json(); const g = r.data.find((t) => t.isDefault); const row = document.querySelector('[data-testid="team-Platform"]'); return location.pathname === '/settings/access' && location.search === '?tab=teams' && g?.name === 'Platform' && g.members.length >= 3 && g.projects.length >= 3 && /Default/.test(row.innerText) && /people/.test(row.innerText) && /gaps?|Covered/.test(document.querySelector('[data-testid="team-approvals-Platform"]').innerText) }))
  await page.click('[data-testid="new-team"]')
  await panelOpen('team-panel')
  await page.type('.cds--modal.is-visible #team-name', 'platform')
  ok('a team name another team has is refused, whatever its case, and Create stays off', await page.evaluate(() => /already exists/.test(document.querySelector('.cds--modal.is-visible [data-testid="team-panel"]').innerText) && document.querySelector('.cds--modal.is-visible [data-testid="save-team"]').disabled === true))
  await selectAll('.cds--modal.is-visible #team-name')
  await page.type('.cds--modal.is-visible #team-name', 'Support')
  await page.type('.cds--modal.is-visible #team-slack', 'Bad Channel!')
  ok('a Slack channel Slack would not accept is refused with the rule', await page.evaluate(() => /lowercase letters/.test(document.querySelector('.cds--modal.is-visible [data-testid="team-panel"]').innerText) && document.querySelector('.cds--modal.is-visible [data-testid="save-team"]').disabled === true))
  await selectAll('.cds--modal.is-visible #team-slack')
  await page.type('.cds--modal.is-visible #team-slack', 'support-launches')
  await inPanel('[data-testid="save-team"]')
  await page.waitForSelector('[data-testid="team-Support"]', { timeout: 8000 })
  ok('a new team is created with its channel, empty and ready for people and projects', await page.evaluate(async () => { const row = document.querySelector('[data-testid="team-Support"]').innerText; const t = (await (await fetch('/api/v1/teams')).json()).data.find((x) => x.name === 'Support'); return /#support-launches/.test(row) && /0 people/.test(row) && t.projects.length === 0 && t.slackChannel === 'support-launches' }))
  await new Promise((r) => setTimeout(r, 400))
  // Open Platform, and move its first project to Support.
  const supportId = await page.evaluate(async () => (await (await fetch('/api/v1/teams')).json()).data.find((t) => t.name === 'Support').id)
  await page.click('[data-testid="open-team-Platform"]')
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
  ok('with two teams the list names each project’s team and marks a leader’s read-only view', await page.evaluate(() => { const t = [...document.querySelectorAll('[data-testid="project-team"]')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()); return t.some((x) => x === 'Support · View only') && t.some((x) => x === 'Platform') }))
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
  ok('the old Reviewers address lands on Approvals, under User Access', page.url().endsWith('/settings/access?tab=approvals'))
  ok('Approvals is a sub-tab of User Access, and the sub-tab is in the address', await page.evaluate(() => document.querySelector('[data-testid="tab-approvals"]')?.getAttribute('aria-current') === 'page' && document.querySelector('[aria-label="Settings sections"] [data-label="Approvals"]')?.getAttribute('aria-current') === 'page'))
  ok('the grid shows every step, a column per team, and says how many steps have nobody', await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid^="step-row-"]')].map((r) => r.dataset.testid.replace('step-row-', '')); return rows.join() === 'product_leadership,sales,legal,documentation,marketing,final_decision' && /steps without an approver/.test(document.querySelector('[data-testid="gap-summary"]').innerText) && [...document.querySelectorAll('[role="columnheader"]')].map((h) => h.innerText.trim()).join('|').toLowerCase().includes('support') }))
  const panel = (sel) => `.cds--modal.is-visible ${sel}`
  const openStep = async (key) => { await page.evaluate((k) => document.querySelector(`[data-testid="open-step-${k}"]`).click(), key); await page.waitForSelector(panel(`[data-testid="step-panel"][data-step="${key}"]`), { visible: true, timeout: 5000 }) }
  // Sales: Support does not use it.
  await openStep('sales')
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="team-mode-Support-off"]').click())
  await page.evaluate(() => document.querySelector('.cds--modal.is-visible [data-testid="save-step"]').click())
  await page.waitForFunction(() => document.querySelector('[data-testid="cell-sales-Support"]')?.dataset.mode === 'off', { timeout: 8000 })
  ok('turning a step off for a team (Not used) saves and the grid marks it', await page.evaluate(() => { const c = document.querySelector('[data-testid="cell-sales-Support"]'); return c.dataset.state === 'not_used' && /Not used/.test(c.innerText) && document.querySelector('[data-testid="cell-sales-Platform"]').dataset.state === 'gap' }))
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
  ok('choosing a workspace approver covers that step for every team that uses the workspace approver', await page.evaluate(() => document.querySelector('[data-testid="cell-legal-Platform"]').dataset.state === 'covered' && /Alex/.test(document.querySelector('[data-testid="step-row-legal"]').innerText)))
  await new Promise((r) => setTimeout(r, 400))
  // The Use backup toggle: disabled, with the reason, until there is a backup.
  ok('Use backup is disabled with a reason while the step has no backup', await page.evaluate(() => { const w = document.querySelector('[data-testid="use-backup-legal"]'); return /backup/i.test(w.getAttribute('title') ?? '') && w.querySelector('button[role="switch"]').disabled === true && /No backup/.test(document.querySelector('[data-testid="step-row-legal"]').innerText) }))
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
  await page.goto(`${BASE}/settings/access?tab=people`, { waitUntil: 'networkidle0' })
  await waitText('Invite person')
  await page.evaluate(async (id) => { await fetch(`/api/v1/members/${id}`, { method: 'DELETE' }) }, counsel.id)

  // The invited person signs in: linked, read-only, and no invite form.
  await signInAs('e2e.person@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Projects')
  ok('a viewer does not see Settings in the menu', await page.evaluate(() => ![...document.querySelectorAll('[data-nav] a')].some((a) => a.textContent.includes('Settings'))))
  for (const path of ['/settings/categories', '/settings/members', '/settings/people', '/settings/approvals', '/settings/access', '/settings/audit', '/settings/data', '/settings/usage', '/members']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => location.pathname === '/projects', { timeout: 8000 })
  }
  ok('a viewer who types an Settings address is sent back to the projects', true)
  ok('the server refuses a viewer the member list, the audit log, system usage and the AI status details', await page.evaluate(async () => (await fetch('/api/v1/members')).status === 403 && (await fetch('/api/v1/audit')).status === 403 && (await fetch('/api/v1/export/workspace.zip')).status === 403 && (await fetch('/api/v1/export/audit.csv')).status === 403 && (await fetch('/api/v1/usage')).status === 403 && !('spentUsd' in (await (await fetch('/api/v1/ai/status')).json()))))
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
  await page.goto(`${BASE}/settings/access?tab=people`, { waitUntil: 'networkidle0' })
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
  console.log('  what the page showed: ' + (await page.evaluate(() => {
    const tab = document.querySelector('[data-testid="tab-teams"]')
    const r = tab?.getBoundingClientRect()
    const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null
    return `${location.pathname}${location.search} | scrollY=${window.scrollY} | tab-teams at ${r ? `${Math.round(r.x)},${Math.round(r.y)}` : 'missing'} selected=${tab?.getAttribute('aria-selected')} | what is at its centre: ${hit ? `${hit.tagName} ${hit.className?.toString().slice(0, 60)}` : 'nothing'} | modal=${!!document.querySelector('.cds--modal.is-visible')}`
  }).catch(() => 'unavailable')))
  await page.screenshot({ path: new URL('./failure-auth.png', import.meta.url).pathname })
}
await browser.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
