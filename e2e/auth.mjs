// Sign-in and roles in the browser, against an in-memory API with the stand-in sign-in service (AUTH_TEST=true): the
// sign-in screen, an owner's header menu and Members page (invite, change role, remove), the not-invited screen, and what
// a viewer sees. Started by e2e/run.mjs, after the main flow.
import puppeteer from 'puppeteer-core'
const BASE = process.env.E2E_AUTH_BASE || 'http://localhost:5199'
const API = process.env.E2E_AUTH_API || 'http://localhost:8792'
const results = []
const ok = (name, cond, extra = '') => { results.push([cond ? 'ok  ' : 'FAIL', name, extra]); console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1400,900'] })
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
  ok('signed out, with public viewing off, the sign-in screen is shown instead of the app', (await text()).includes('invite-only') && !(await text()).includes('Research Projects'))

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
  await waitText('Research Projects')
  const visitor = await page.evaluate(() => document.querySelector('header')?.innerText ?? '')
  ok('a visitor can look around: projects load, the header says read-only and offers Sign in', visitor.includes('Read-only demo') && visitor.includes('Sign in') && (await page.$$('[data-status]')).length >= 3)
  ok('a visitor cannot start a project or remove one', await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New project')?.disabled === true) && (await page.$$('.cds--overflow-menu')).length === 0)
  const first = (await (await fetch(`${API}/api/v1/projects`)).json()).data[0]
  await page.goto(`${BASE}/projects/${first.id}/plan`, { waitUntil: 'networkidle0' })
  await waitText('Editing is locked')
  ok('a project opens read-only and says how to get editing access', (await text()).includes('Sign in') && (await page.evaluate(() => document.querySelector('#project-name').readOnly === true)))

  // /sign-in sends someone who is already signed in straight to the projects.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => location.pathname === '/insights/themes', { timeout: 8000 })
  ok('/sign-in takes a signed-in person to Platform Insights, the home page', true)
  await signInAs(null)

  // A signed-in owner: the app, with their name and role and an account menu.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Research Projects')
  const header = await page.evaluate(() => document.querySelector('header')?.innerText ?? '')
  ok('an owner sees their role in the header and no token controls', header.toLowerCase().includes('owner') && !header.includes('Editing unlocked') && !header.includes('Unlock editing') && !header.includes('Lock'))
  await page.click('[aria-label="Account"]')
  await clickText('Members')
  await waitText('Invite')
  ok('the account menu opens the Members page, which lists the demo members', (await text()).includes('david@demo.signalflow.example') && (await text()).includes('sam@demo.signalflow.example'))

  // Invite, change role, then see what that person gets.
  await page.type('#invite-email', 'e2e.person@example.com')
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Invite').click())
  await waitText('e2e.person@example.com is invited as editor')
  ok('inviting adds the person as invited, with the chosen role', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'editor' && m.status === 'invited'))
  await page.click('[data-testid="member-e2e.person@example.com"] [id^="role-"]')
  await page.waitForSelector('[role=option]', { visible: true })
  await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find((o) => o.innerText.includes('Viewer')).click())
  await new Promise((r) => setTimeout(r, 800))
  ok('changing the role saves it', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.role === 'viewer'))

  // The invited person signs in: linked, read-only, and no invite form.
  await signInAs('e2e.person@example.com')
  await page.goto(`${BASE}/members`, { waitUntil: 'networkidle0' })
  await waitText('Members')
  ok('a viewer can see the members but has no invite form or remove buttons', !(await page.$('#invite-email')) && !(await page.$('[data-testid^="member-"] > div:last-child button')))
  ok('and the first sign-in marked them as signed in', (await members()).some((m) => m.email === 'e2e.person@example.com' && m.status === 'active'))
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('Research Projects')
  ok('a viewer cannot start a new project', await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New project')?.disabled === true))

  // A Google account nobody invited.
  await signInAs('stranger@example.com')
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  await waitText('You have not been invited')
  ok('an uninvited account gets the not-invited screen with its address', (await text()).includes('stranger@example.com') && !(await text()).includes('Research Projects'))

  // The owner removes the person, who is then locked out.
  await signInAs('david@demo.signalflow.example')
  await page.goto(`${BASE}/members`, { waitUntil: 'networkidle0' })
  await waitText('e2e.person@example.com')
  await page.click('[data-testid="member-e2e.person@example.com"] > div:last-child button')
  await waitText('They lose access right away')
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
