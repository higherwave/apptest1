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
  ok('signed out, with public viewing off, the sign-in screen is shown instead of the app', (await text()).includes('invite-only') && !(await text()).includes('Product Funnel'))

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
  await waitText('Product Funnel')
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

  // /sign-in sends someone who is already signed in straight to the projects.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => location.pathname === '/insights/themes', { timeout: 8000 })
  ok('/sign-in takes a signed-in person to Platform Insights, the home page', true)
  await signInAs(null)

  // A signed-in owner: the app, with their name and role and an account menu.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Product Funnel')
  const header = await page.evaluate(() => document.querySelector('header')?.innerText ?? '')
  ok('an owner sees no token controls in the header (the role is in the account panel)', !header.includes('Editing unlocked') && !header.includes('Unlock editing') && !header.includes('Lock'))
  // AI status is a link in the account menu (a canned live status stands in for the always-simulated test API).
  await page.setRequestInterception(true)
  const canned = (req) => new URL(req.url()).pathname === '/api/v1/ai/status' ? req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'live', enabled: true, budgetUsd: 10, spentUsd: 1, spendLevel: 'ok', month: '2026-11' }) }) : req.continue()
  page.on('request', canned)
  await page.reload({ waitUntil: 'networkidle0' })
  await waitText('Product Funnel')
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
  await waitText('Product Funnel')
  await page.goto(`${BASE}/members`, { waitUntil: 'networkidle0' })
  ok('the old Members address lands on the Admin Members tab', await page.evaluate(() => location.pathname === '/settings/members' && document.querySelector('nav[aria-label="Admin sections"] [data-label="Members"]')?.dataset.current === 'true'))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' })
  await waitText('Experience')
  await page.evaluate(() => document.querySelector('nav[aria-label="Admin sections"] [data-label="Members"]').click())
  await waitText('Invite')
  await waitText('sam@demo.signalflow.example') // the list arrives after the form
  ok('the account menu opens the Members page, which lists the demo members', (await text()).includes('david@demo.signalflow.example') && (await text()).includes('sam@demo.signalflow.example'))

  // Invite, change role, then see what that person gets.
  await page.type('#invite-email', 'e2e.person@example.com')
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Invite').click())
  await waitText('e2e.person@example.com is invited as editor')
  ok('inviting adds the person as invited, with the chosen role', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'editor' && m.status === 'invited'))
  await page.click('[data-testid="member-e2e.person@example.com"] [id^="role-"]')
  await page.waitForSelector('[role=option]', { visible: true })
  ok('each role in the list says what it allows, and the explanation is no longer printed above the table', await page.evaluate(() => { const o = [...document.querySelectorAll('[role=option]')].map((x) => x.innerText); return o.length === 3 && /Everything, including inviting/.test(o[0]) && /Create and change projects/.test(o[1]) && /Look, but not change anything/.test(o[2]) && ![...document.querySelectorAll('p')].some((p) => p.innerText.startsWith('Owner:')) }))
  await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.includes('Viewer')).click())
  await new Promise((r) => setTimeout(r, 800))
  ok('changing the role saves it', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'viewer'))

  // The audit log records what the owner just did.
  await page.evaluate(() => document.querySelector('nav[aria-label="Admin sections"] [data-label="Audit log"]').click())
  await page.waitForSelector('[data-testid="audit-row"]', { timeout: 8000 })
  ok('the Audit log tab lists who changed what, newest first, including the invitation and the role change just made', await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="audit-row"]')].map((r) => r.innerText); return location.pathname === '/settings/audit' && rows.length >= 2 && /Member/.test(rows[0]) && rows.some((r) => /e2e\.person@example\.com/.test(r) && /role/i.test(r)) && rows.some((r) => /Created|Invited/i.test(r) && /e2e\.person@example\.com/.test(r)) }))

  // The invited person signs in: linked, read-only, and no invite form.
  await signInAs('e2e.person@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Product Funnel')
  ok('a viewer does not see Admin in the menu', await page.evaluate(() => ![...document.querySelectorAll('[data-nav] a')].some((a) => a.textContent.includes('Admin'))))
  for (const path of ['/settings/categories', '/settings/members', '/settings/audit', '/settings/usage', '/members']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => location.pathname === '/projects', { timeout: 8000 })
  }
  ok('a viewer who types an Admin address is sent back to the projects', true)
  ok('the server refuses a viewer the member list, the audit log, system usage and the AI status details', await page.evaluate(async () => (await fetch('/api/v1/members')).status === 403 && (await fetch('/api/v1/audit')).status === 403 && (await fetch('/api/v1/usage')).status === 403 && !('spentUsd' in (await (await fetch('/api/v1/ai/status')).json()))))
  ok('and the first sign-in marked them as signed in', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.status === 'active'))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Product Funnel')
  ok('a viewer cannot start a new project', await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New project')?.disabled === true))

  // A Google account nobody invited.
  await signInAs('stranger@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('You have not been invited')
  ok('an uninvited account gets the not-invited screen with its address', (await text()).includes('stranger@example.com') && !(await text()).includes('Product Funnel'))

  // The owner removes the person, who is then locked out.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/members`, { waitUntil: 'networkidle0' })
  await waitText('e2e.person@example.com')
  await page.click('[data-testid="member-e2e.person@example.com"] > div:last-child button')
  await waitText('They lose access right away')
  await new Promise((r) => setTimeout(r, 400))
  ok('the remove dialog darkens the whole window, not just the width of the page', await page.evaluate(() => { const m = document.querySelector('.cds--modal.is-visible'); const r = m.getBoundingClientRect(); return Math.abs(r.width - window.innerWidth) < 2 && r.left < 2 }))
  await clickInOpenDialog('Remove')
  await page.waitForFunction(() => !document.body.innerText.includes('e2e.person@example.com') || document.querySelector('.cds--modal.is-visible') === null, { timeout: 8000 })
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
