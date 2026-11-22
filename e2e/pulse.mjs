// Pulse (preview): invisible until an owner switches it on in Admin, Previews; then an owner sees it in the menu and can add signals and notes, keep and dismiss them;
// a read-only visitor never sees it, and switching it off hides it again. Started by e2e/run.mjs against the main test API.
import puppeteer from 'puppeteer-core'
const BASE = process.env.E2E_BASE || 'http://localhost:5198'
const TOKEN = process.env.E2E_TOKEN || 'e2e-token'
const API = process.env.E2E_API || 'http://localhost:8791'
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
// The apps the launcher offers: it is opened, read, and closed again.
const menu = async (page) => {
  await page.click('[data-testid="app-launcher"]')
  await page.waitForSelector('[data-testid="launcher-panel"]', { visible: true, timeout: 5000 })
  const names = await page.evaluate(() => [...document.querySelectorAll('[data-testid="launcher-panel"] a')].map((a) => a.getAttribute('data-label')))
  await page.keyboard.press('Escape')
  await wait(300)
  return names
}
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
  ok('Pulse is not in the launcher while the preview is off', !(await menu(page)).includes('Pulse'))
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  ok('and /pulse is a page that does not exist', (await text(page)).includes('Page not found'))

  // An owner switches it on in Admin, Previews.
  await page.goto(`${BASE}/settings/preview`, { waitUntil: 'networkidle0' })
  await waitText(page, 'Show Pulse (preview)')
  ok('Admin has a Previews tab with the Pulse switch, off', await page.evaluate(() => document.querySelector('[data-testid="preview-pulse"]').getAttribute('aria-checked') === 'false' && !!document.querySelector('[aria-label="Admin sections"]').innerText.includes('Previews')))
  await click(page, 'preview-pulse')
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-pulse"]')?.getAttribute('aria-checked') === 'true', { timeout: 8000 })
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  ok('with it on, Pulse is in the launcher for the owner', (await menu(page)).includes('Pulse'))

  // The page: empty, then a signal typed in (kept at once), then notes (wait for review), then keep and dismiss.
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  await waitText(page, 'No topics yet')
  ok('/pulse opens Topics, with Pulse as the app in the header and Topics and Signals as its items', (await page.evaluate(() => document.querySelector('[data-testid="app-brand"]').innerText.trim())) === 'Pulse' && (await page.evaluate(() => [...document.querySelectorAll('[data-nav] a')].map((a) => a.dataset.label).filter((l) => l !== 'Admin').join('|'))) === 'Topics|Signals')
  await page.goto(`${BASE}/pulse/signals`, { waitUntil: 'networkidle0' })
  await waitText(page, 'Nothing waiting for review')
  ok('Signals opens on Auto-discovered, with Manual and All beside it, a preview tag and an empty review list', (await text(page)).includes('Preview') && !!(await page.$('[data-testid="pulse-empty"]')) && await page.evaluate(() => document.querySelector('[data-testid="signals-filter-auto"]').getAttribute('aria-selected') === 'true' && !!document.querySelector('[data-testid="signals-filter-manual"]') && !!document.querySelector('[data-testid="signals-filter-all"]') && !document.querySelector('#signal-body')))
  await click(page, 'add-notes-toggle')
  await page.waitForSelector('#signal-body', { timeout: 8000 })
  ok('"Add call notes or a signal" opens the two forms on the page', await page.evaluate(() => !!document.querySelector('#notes-text') && !!document.querySelector('[data-testid="pulse-add"]')))
  await page.click('[data-testid="signals-filter-manual"]')
  await page.waitForFunction(() => location.search === '?source=manual', { timeout: 5000 })
  ok('the filter is in the address, so a view can be linked to', true)
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
  // Topics: kept signals grouped, ranked by weighted score, with the sums on request; a person can rename and merge; a weight changes the score.
  const api = (m, path, body) => fetch(`${API}/api/v1${path}`, { method: m, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
  for (const [body, channel, account] of [
    ['I do not trust the score, it was wrong on a renewal last quarter.', 'call_notes', 'Contoso Health'],
    ['Can the score explain which factors moved it? I cannot trust what I cannot explain.', 'slack', 'Fabrikam Retail'],
    ['When a hard case moves to my queue I redo the whole investigation, the handoff loses the history.', 'call_notes', 'Northwind Logistics'],
    ['We need the context carried over with every handoff to success.', 'slack', 'Tailspin Travel'],
  ]) await api('POST', '/pulse/signals', { body, channel, account })
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  await waitText(page, 'No topics yet')
  await click(page, 'topics-update')
  await waitText(page, 'Trust and accuracy')
  const grid = await text(page)
  ok('Update topics groups the kept signals into topics, ranked, with a count for each channel', grid.includes('Trust and accuracy') && grid.includes('Handoffs and lost context') && (await page.evaluate(() => document.querySelectorAll('[data-testid^="topic-"][data-rank]').length)) >= 2)
  const first = await page.evaluate(() => { const r = document.querySelector('[data-testid^="topic-"][data-rank="1"]'); return { id: r.dataset.testid.slice(6), score: r.querySelector('[data-testid="topic-score"]').innerText.trim(), title: r.querySelector('[data-testid="topic-title"]').innerText.trim() } })
  await click(page, `why-${first.id}`)
  await waitText(page, 'Edit weights')
  ok('"Why it ranks here" shows signals times weight for each channel, adding up to the score shown', await page.evaluate((score) => { const box = document.querySelector('[data-testid^="why-row-"]').innerText; return /×/.test(box) && box.includes('Score') && box.replace(/\s+/g, ' ').includes(score) }, first.score))
  ok('and the grid says who is behind it: accounts, and how many channels it was heard in', /accounts?/.test(grid) && /\d of 3/.test(grid))

  // The impact map and picking topics: a circle for each topic; picked ones show on the map, in the grid and in a bar at the foot of the page.
  const topicIds = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="topic-"][data-rank]')].map((r) => r.dataset.testid.slice(6)))
  ok('the impact map has a circle for each topic, with its name', (await page.evaluate(() => document.querySelectorAll('[data-testid^="bubble-"]').length)) === topicIds.length && (await text(page)).includes('Channels it was heard in'))
  await page.evaluate((id) => document.querySelector(`[data-testid="bubble-${id}"] circle`).dispatchEvent(new MouseEvent('click', { bubbles: true })), topicIds[0])
  await page.waitForSelector('[data-testid="pick-bar"]', { timeout: 5000 })
  ok('choosing a circle selects the topic: the bar says so, and the row is ticked in the grid', (await text(page)).includes('1 topic selected') && (await page.evaluate((id) => document.querySelector(`#pick-${id}`).checked, topicIds[0])))
  await page.evaluate((id) => document.querySelector(`#pick-${id}`).click(), topicIds[1])
  await page.waitForFunction(() => document.body.innerText.includes('2 topics selected'), { timeout: 5000 })
  ok('and ticking a row in the grid selects it too, shown on the map', await page.evaluate((id) => document.querySelector(`[data-testid="bubble-${id}"]`).getAttribute('aria-checked') === 'true', topicIds[1]))

  // Start a project from them: the panel drafts a name, a description and questions from what customers said; save fills the Test Plan.
  await click(page, 'create-project')
  await page.waitForSelector('[data-testid="pp-question"]', { timeout: 8000 })
  const panel = await page.evaluate(() => ({ name: document.querySelector('#pp-name').value, desc: document.querySelector('#pp-description').value, qs: document.querySelectorAll('[data-testid="pp-question"]').length, from: document.querySelector('[data-testid="pp-from"]').innerText }))
  ok('the panel starts with a name, a description and four to six questions drafted from the topics', panel.name.length > 3 && /Frame the problem/.test(panel.desc) && panel.qs >= 4 && panel.qs <= 6 && /2 topics/.test(panel.from), JSON.stringify({ ...panel, desc: panel.desc.slice(0, 40) }))
  ok('the questions come with the customer words that prompted them', await page.evaluate(() => [...document.querySelectorAll('[data-testid="pp-question"]')].some((q) => /from .*: “/.test(q.innerText))))
  await page.$eval('#pp-name', (el) => el.select())
  await page.keyboard.type('Trust and handoffs')
  await page.evaluate(() => [...document.querySelectorAll('[data-testid="pp-question"] button')].find((b) => /Remove question 1/.test(b.getAttribute('aria-label') ?? b.innerText)).click())
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="pp-question"]').length === n - 1, { timeout: 4000 }, panel.qs)
  await click(page, 'pp-save')
  await page.waitForFunction(() => /\/projects\/[^/]+\/plan$/.test(location.pathname), { timeout: 10000 })
  await page.waitForSelector('[data-testid="from-pulse"]', { timeout: 10000 })
  ok('saving opens the new project\'s Test Plan, with a note saying which topics it came from', (await page.evaluate(() => document.querySelector('[data-testid="from-pulse"]').innerText)).includes('From Pulse: 2 topics'))
  ok('the description is under What to test', (await page.$eval('textarea', (el) => el.value)).includes('Frame the problem'))
  await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => /What to ask or observe/.test(t.innerText)).click())
  await page.waitForFunction(() => /\/ask$/.test(location.pathname) && document.querySelector('[id^="task-"]'), { timeout: 8000 })
  const asked = await page.evaluate(() => [...document.querySelectorAll('input[id^="task-"]')].filter((i) => /^task-\d+$/.test(i.id)).map((i) => i.value))
  ok('and the questions are under What to ask or observe, one fewer than drafted (one was removed)', asked.length === panel.qs - 1 && asked.every((v) => v.length > 15 && /[?.]$/.test(v.trim())), `${asked.length} of ${panel.qs - 1}`)
  const noteTopic = await page.evaluate(() => document.querySelector('[data-testid="from-pulse"] button')?.innerText)
  ok('the note links to the topics it came from', !!noteTopic)

  // Topic details: the quotes and accounts behind one topic, and a one-click start for just that topic.
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="topic-title"]', { timeout: 8000 })
  await page.evaluate(() => document.querySelector('[data-testid="topic-title"]').click())
  await page.waitForSelector('[data-testid="topic-quotes"]', { timeout: 8000 })
  ok('a topic opens to its details: customer quotes with where and who, the accounts and people, and why it ranks', await page.evaluate(() => document.querySelectorAll('[data-testid="quote"]').length >= 2 && !!document.querySelector('[data-testid="topic-accounts"]') && !!document.querySelector('[data-testid="topic-people"]') && document.querySelector('[data-testid="topic-why"]').innerText.includes('×')))
  const all = await page.evaluate(() => document.querySelectorAll('[data-testid="quote"]').length)
  await page.select('#quote-channel', await page.evaluate(() => [...document.querySelectorAll('#quote-channel option')][1].value))
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="quote"]').length < n, { timeout: 4000 }, all)
  ok('the quotes can be narrowed to one channel', true)
  await click(page, 'dig-in')
  await page.waitForSelector('[data-testid="create-project-panel"]', { visible: true, timeout: 5000 })
  ok('"Dig into this" opens the same panel for just this topic', /1 topic and/.test(await page.$eval('[data-testid="pp-from"]', (el) => el.innerText)))
  await page.keyboard.press('Escape')
  await wait(500)
  await click(page, 'topic-back')
  await page.waitForSelector('[data-testid="topics-grid"]', { timeout: 8000 })

  // Rename: opens with the current name; saving changes it.
  await page.evaluate((id) => document.querySelector(`[data-testid="topic-menu-${id}"]`).click(), first.id)
  await page.waitForSelector(`[data-testid="rename-${first.id}"]`, { timeout: 4000 })
  await page.evaluate((id) => document.querySelector(`[data-testid="rename-${id}"]`).click(), first.id)
  await page.waitForSelector('.cds--modal.is-visible #rename-title', { timeout: 4000 })
  ok("Rename opens with the topic's own name", (await page.$eval('#rename-title', (el) => el.value)) === first.title)
  await page.$eval('#rename-title', (el) => el.select())
  await page.keyboard.type('Why the health score moves')
  await page.evaluate(() => [...document.querySelectorAll('.cds--modal.is-visible button')].find((b) => b.innerText.trim() === 'Save').click())
  await waitText(page, 'Why the health score moves')
  await wait(500)
  ok('a renamed topic shows its new name', (await text(page)).includes('Why the health score moves'))

  // Merge the other topic into it: one row is left.
  const other = await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid^="topic-"][data-rank]')]; return rows.length > 1 ? rows[1].dataset.testid.slice(6) : null })
  ok('there is a second topic to merge', !!other)
  if (other) {
    await page.evaluate((id) => document.querySelector(`[data-testid="topic-menu-${id}"]`).click(), other)
    await page.waitForSelector(`[data-testid="merge-${other}"]`, { timeout: 4000 })
    await page.evaluate((id) => document.querySelector(`[data-testid="merge-${id}"]`).click(), other)
    await page.waitForSelector('.cds--modal.is-visible #merge-into', { timeout: 4000 })
    await page.evaluate(() => [...document.querySelectorAll('.cds--modal.is-visible button')].find((b) => b.innerText.trim() === 'Merge').click())
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="topic-"][data-rank]').length === 1, { timeout: 8000 })
    ok('merging a topic into another leaves one topic', true)
  }
  const before = await page.evaluate(() => document.querySelector('[data-testid="topic-score"]').innerText.trim())

  // Weights live in Admin, Pulse (owners): a change re-ranks at once.
  await page.goto(`${BASE}/settings/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('#weight-call_notes', { timeout: 8000 })
  ok('Admin has a Pulse tab, with a weight for each channel', await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Admin sections"] a')].some((b) => b.innerText.trim() === 'Pulse') && ['call_notes', 'slack', 'salesforce'].every((k) => !!document.querySelector(`#weight-${k}`))))
  await page.$eval('#weight-slack', (el) => el.select())
  await page.keyboard.type('5')
  await click(page, 'weights-save')
  await waitText(page, 'Weights saved')
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="topic-score"]', { timeout: 8000 })
  const after = await page.evaluate(() => document.querySelector('[data-testid="topic-score"]').innerText.trim())
  ok("raising Slack's weight raises the topic score at once", Number(after) > Number(before), `${before} to ${after}`)
  await page.goto(`${BASE}/settings/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('#weight-slack', { timeout: 8000 })
  await page.$eval('#weight-slack', (el) => el.select())
  await page.keyboard.type('9')
  ok('a weight above 5 is refused, with the Save button off', await page.evaluate(() => document.querySelector('[data-testid="weights-save"]').disabled === true && /0 to 5/.test(document.body.innerText)))
  await page.screenshot({ path: process.env.PULSE_SHOT || '/tmp/pulse.png' })

  // Who can view Pulse: owners and editors always; a viewer can be given view access one person at a time.
  await page.goto(`${BASE}/settings/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="pulse-viewers"] li', { timeout: 8000 })
  ok('Admin lists who can view Pulse: owners and editors always, and a checkbox for each viewer', await page.evaluate(() => /Owner: always/.test(document.querySelector('[data-testid="pulse-viewers"]').innerText) && /Editor: always/.test(document.querySelector('[data-testid="pulse-viewers"]').innerText) && !!document.querySelector('[data-testid^="viewer-check-"]')))
  const box = await page.$('[data-testid^="viewer-check-"]')
  const boxId = await box.evaluate((el) => el.id)
  await page.evaluate((id) => document.getElementById(id).click(), boxId)
  await page.waitForFunction((id) => document.getElementById(id)?.checked === true, { timeout: 8000 }, boxId)
  ok('view access can be given to a viewer', true)
  await page.evaluate((id) => document.getElementById(id).click(), boxId)
  await page.waitForFunction((id) => document.getElementById(id)?.checked === false, { timeout: 8000 }, boxId)
  ok('and taken away again', true)

  // Feedback sources live under the weights: list a channel, read it, and its messages wait in the Signals list for review.
  await page.goto(`${BASE}/settings/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="source-name"]', { timeout: 8000 })
  await page.type('#source-name', '#customer-feedback')
  await click(page, 'source-add')
  await page.waitForSelector('[data-testid="source-customer-feedback"]', { timeout: 8000 })
  ok('a Slack channel can be listed as a source, waiting for review by default', await page.evaluate(() => document.querySelector('[data-testid="source-mode-customer-feedback"]').value === 'review'))
  await click(page, 'source-check-customer-feedback')
  await page.waitForFunction(() => document.querySelector('[data-testid="source-note"]')?.innerText.includes('4 new messages'), { timeout: 8000 })
  ok('Check now reads the channel and says how many messages it found', true)
  await page.goto(`${BASE}/pulse/signals`, { waitUntil: 'networkidle0' })
  ok('those messages wait in the Signals list, marked as from the channel', await page.evaluate(() => document.body.innerText.includes('#customer-feedback') && document.body.innerText.includes('weekly digest does not match')))
  await page.goto(`${BASE}/settings/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="source-check-customer-feedback"]', { timeout: 8000 })
  await click(page, 'source-check-customer-feedback')
  await page.waitForFunction(() => document.querySelector('[data-testid="source-note"]')?.innerText.includes('Nothing new'), { timeout: 8000 })
  ok('reading again adds nothing', true)
  await click(page, 'source-remove-customer-feedback')
  await page.waitForFunction(() => !document.querySelector('[data-testid="source-customer-feedback"]'), { timeout: 8000 })
  ok('a source can be removed', true)

  // Salesforce (read only): copy the accounts, and the topics show the ARR behind them, in the table, on the map and on the topic's page.
  await page.goto(`${BASE}/settings/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="salesforce-sync"]', { timeout: 8000 })
  await click(page, 'salesforce-sync')
  await page.waitForFunction(() => /4 accounts copied/.test(document.querySelector('[data-testid="salesforce-status"]')?.innerText ?? ''), { timeout: 8000 })
  ok('Salesforce accounts are copied on request and counted', true)
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="map-by-arr"]', { timeout: 8000 })
  ok('the topics table has an ARR column once Salesforce is copied', await page.evaluate(() => [...document.querySelectorAll('[data-testid="topics-grid"] th')].some((th) => th.innerText.trim() === 'ARR') && /\$[\d.]+[KM]/.test(document.querySelector('[data-testid^="topic-arr-"]').innerText)))
  await click(page, 'map-by-arr')
  await page.waitForFunction(() => document.querySelector('[data-testid="impact-map"]').innerText.includes('ARR of the accounts raising it'), { timeout: 4000 })
  ok('the impact map can show height as ARR instead of accounts', await page.evaluate(() => /\$\d+[KM]/.test(document.querySelector('[data-testid="impact-map"]').innerText)))
  await page.evaluate(() => document.querySelector('[data-testid="topic-title"]').click())
  await page.waitForSelector('[data-testid="topic-accounts"]', { timeout: 8000 })
  ok("a topic's page shows each account's ARR, and says which were not found", await page.evaluate(() => /ARR · /.test(document.querySelector('[data-testid="topic-accounts"]').innerText) && /ARR/.test(document.querySelector('h1').closest('div').parentElement.innerText)))
  // Salesforce opportunity notes: designate the fields, read them, and topics show what is at stake; "Rank by" can order by it.
  await page.goto(`${BASE}/settings/pulse`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="opp-add"]', { timeout: 8000 })
  await click(page, 'opp-add')
  await page.waitForSelector('[data-testid^="source-check-opportunities"]', { timeout: 8000 })
  ok('opportunity notes can be designated as a source, with the fields shown', await page.evaluate(() => document.querySelector('[data-testid="source-opportunities"]').innerText.includes('NextStep, Description')))
  await page.select('[data-testid="source-mode-opportunities"]', 'keep')
  await wait(500)
  await click(page, 'source-check-opportunities')
  await page.waitForFunction(() => /\d+ new messages/.test(document.querySelector('[data-testid="source-note"]')?.innerText ?? ''), { timeout: 10000 })
  ok('Check now reads the opportunity notes', true)
  await page.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  await click(page, 'topics-update')
  await page.waitForSelector('[data-testid="rank-play"]', { timeout: 10000 })
  ok('topics gain an In play column and a Rank by switch', await page.evaluate(() => [...document.querySelectorAll('[data-testid="topics-grid"] th')].some((th) => th.innerText.trim() === 'In play') && !!document.querySelector('[data-testid="rank-arr"]')))
  await click(page, 'rank-play')
  await wait(400)
  ok('ranking by what is in play orders the list by it', await page.evaluate(() => { const v = [...document.querySelectorAll('[data-testid^="topic-play-"]')].map((c) => { const m = /\$([\d.]+)([KM]?)/.exec(c.innerText); return m ? Number(m[1]) * (m[2] === 'M' ? 1e6 : m[2] === 'K' ? 1e3 : 1) : 0 }); return v.length > 0 && v.every((x, i) => i === 0 || v[i - 1] >= x) }))
  await page.evaluate(() => document.querySelector('[data-testid^="topic-play-"]').closest('tr').querySelector('[data-testid="topic-title"]').click())
  await page.waitForSelector('[data-testid="topic-in-play"]', { timeout: 8000 })
  ok("a topic's page says what is at stake, and quotes show the opportunity", await page.evaluate(() => /open opportunit/.test(document.querySelector('[data-testid="topic-in-play"]').innerText) && !!document.querySelector('[data-testid="quote-opportunity"]')))
  ok("a topic's page says what Signal Flow already knows: themes that cover it, or that it is not researched yet", await page.evaluate(() => /Already researched|Not researched yet/.test(document.querySelector('[data-testid="topic-links"]')?.innerText ?? '')))
  await page.goto(`${BASE}/insights/themes`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="heard-in-pulse"]', { timeout: 8000 })
  ok('Platform Insights opens with what is heard in Pulse, each topic linking to it', await page.evaluate(() => document.querySelectorAll('[data-testid="heard-topic"]').length >= 1 && /Researched|Not researched yet/.test(document.querySelector('[data-testid="heard-in-pulse"]').innerText)))
  // The Signals page shows the same topics as rows with the accounts and quotes behind them, and starts a project from the ones picked.
  await page.evaluate(() => sessionStorage.removeItem('signalflow.pulse.selection')) // earlier steps picked topics on the Topics page
  await page.goto(`${BASE}/pulse/signals?source=auto`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid^="sig-topic-"]', { timeout: 10000 })
  ok('Auto-discovered lists topics from Slack and Salesforce, with accounts, ARR and trend', await page.evaluate(() => { const row = document.querySelector('[data-testid^="sig-topic-"][data-selected]'); const head = [...document.querySelectorAll('[data-testid="topic-table-auto"] th')].map((h) => h.innerText.trim()).join('|'); return !!row && /Accounts/.test(head) && /ARR/.test(head) && /Trend/.test(head) && /Evidence/.test(head) && /Slack|Salesforce/.test(row.innerText) }))
  await page.evaluate(() => document.querySelector('[data-testid^="sig-accounts-"]').click())
  await page.waitForSelector('[data-testid^="sig-accounts-row-"]', { timeout: 5000 })
  await page.evaluate(() => document.querySelector('[data-testid^="sig-quotes-"]').click())
  await page.waitForSelector('[data-testid="sig-quote"]', { timeout: 8000 })
  ok('a topic’s accounts (with ARR) and quotes open in place', await page.evaluate(() => /ARR|mention/.test(document.querySelector('[data-testid^="sig-accounts-row-"]').innerText) && document.querySelectorAll('[data-testid="sig-quote"]').length >= 1))
  await page.evaluate(() => document.querySelector('[data-testid^="sig-pick-"]').click())
  await page.waitForFunction(() => /1 topic selected/.test(document.querySelector('[data-testid="sig-selected"]')?.innerText ?? ''), { timeout: 5000 })
  ok('picking a topic fills the footer with the count and the ARR in scope', await page.evaluate(() => /1 topic selected · \$[\d.]+[KM]? ARR in scope/.test(document.querySelector('[data-testid="sig-selected"]').innerText)))
  await click(page, 'sig-create-auto')
  await page.waitForSelector('[data-testid="create-project-panel"]', { visible: true, timeout: 8000 })
  ok('Create Signal Flow project opens the project panel for the picked topics', /1 topic/.test(await page.$eval('[data-testid="pp-from"]', (el) => el.innerText)))
  await page.keyboard.press('Escape')
  await wait(500)
  await page.evaluate(() => document.querySelector('[data-testid^="sig-pick-"]').click())

  // A read-only visitor never sees it.
  const visitor = await open(null, '/projects')
  ok('a read-only visitor has no Pulse in the launcher', !(await menu(visitor)).includes('Pulse'))
  await visitor.goto(`${BASE}/pulse`, { waitUntil: 'networkidle0' })
  ok('and the address is a page that does not exist for them', (await text(visitor)).includes('Page not found'))

  // Switched off again: gone for the owner too.
  await page.goto(`${BASE}/settings/preview`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-pulse"]')?.getAttribute('aria-checked') === 'true', { timeout: 8000 })
  await click(page, 'preview-pulse')
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-pulse"]')?.getAttribute('aria-checked') === 'false', { timeout: 8000 })
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle0' })
  ok('switched off, Pulse leaves the launcher again', !(await menu(page)).includes('Pulse'))
} catch (err) {
  failed++
  console.log('  FAIL ' + (err instanceof Error ? err.message : err))
}
await browser.close()
console.log(failed ? `\n${failed} failed` : '\nAll Pulse checks passed')
process.exit(failed ? 1 : 0)
