// Thumbnails for the Design step: visits a prototype link in headless Chromium on our side and keeps a 960 px picture of it. Nothing
// is sent to a third party. The one real danger is the server being used to look at things the person cannot reach themselves
// (an internal address, a cloud metadata endpoint), so every address, including each redirect and each page resource, is checked
// before it is fetched. This file is the seam: the API only knows CaptureService, so tests use a stand-in and never start Chrome.
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Env } from './db.js'

export type Screenshot = { type: 'image/jpeg'; data: Buffer }
export type CaptureService = (url: string) => Promise<Screenshot>

/** A failure with a message fit to show the person. */
export class CaptureError extends Error {}

// A short, safe reason for a failure the person cannot fix but whoever runs the deployment can: the first line of the error, without paths.
const reason = (err: unknown) => String((err as Error)?.message ?? err).split('\n')[0].replace(/\/[\w./@-]+/g, '<path>').slice(0, 140)

// Addresses that are not the public internet: loopback, private, link-local (cloud metadata), shared, documentation, multicast.
const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const v4ToInt = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0)
const inV4Block = (ip: string, [base, bits]: [string, number]) => {
  const size = 2 ** (32 - bits)
  return Math.floor(v4ToInt(ip) / size) === Math.floor(v4ToInt(base) / size)
}

// An IPv6 address as eight 16-bit groups ("::" expanded, a dotted ending turned into two groups).
function v6Groups(ip: string): number[] {
  let text = ip.toLowerCase().replace(/%.*$/, '')
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    const n = v4ToInt(dotted[1])
    text = text.slice(0, dotted.index) + `${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`
  }
  const [head, tail] = text.split('::')
  const a = head ? head.split(':') : []
  const b = tail === undefined ? [] : tail ? tail.split(':') : []
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - a.length - b.length)).fill('0')
  return [...a, ...fill, ...b].map((g) => parseInt(g || '0', 16))
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return V4_BLOCKS.some((b) => inV4Block(ip, b))
  if (kind !== 6) return true // not an address at all: treat as unsafe
  const g = v6Groups(ip)
  const embeddedV4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`
  const zeros5 = g.slice(0, 5).every((x) => x === 0)
  if (zeros5 && g[5] === 0xffff) return isPrivateAddress(embeddedV4) // ::ffff:a.b.c.d, an IPv4 address in IPv6 clothes
  if (g.slice(0, 7).every((x) => x === 0)) return true // :: and ::1
  if (zeros5 && g[5] === 0) return isPrivateAddress(embeddedV4) // the old ::a.b.c.d form
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateAddress(embeddedV4) // NAT64 carrying an IPv4 address
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true // documentation
  return false
}

const INTERNAL_NAME = /(^|\.)(localhost|local|internal|localdomain|lan|home|intranet|corp)$/

/**
 * Throws a CaptureError unless the link is an ordinary public web page: http or https, no embedded password, port 80 or 443, a name
 * with a dot that is not an internal one, and every address it resolves to public. `allowPrivate` is for tests only.
 */
export async function assertCapturable(link: string, opts: { allowPrivate?: boolean; lookup?: (host: string) => Promise<string[]> } = {}): Promise<URL> {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new CaptureError('That link is not a web address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CaptureError('Only http and https links can be captured.')
  if (url.username || url.password) throw new CaptureError('Links with a password in them cannot be captured.')
  if (opts.allowPrivate) return url
  if (url.port && url.port !== '80' && url.port !== '443') throw new CaptureError('Only links on the standard web ports can be captured.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new CaptureError('That address is on a private network, so it cannot be captured.')
    return url
  }
  if (!host.includes('.') || INTERNAL_NAME.test(host)) throw new CaptureError('That address is on a private network, so it cannot be captured.')
  let addresses: string[]
  try {
    addresses = opts.lookup ? await opts.lookup(host) : (await dnsLookup(host, { all: true })).map((a) => a.address)
  } catch {
    throw new CaptureError('That address could not be found.')
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new CaptureError('That address is on a private network, so it cannot be captured.')
  return url
}

const WIDTH = 1280
const HEIGHT = 800
const SCALE = 0.75 // 1280 x 800 at 0.75 is 960 x 600: the size the Design table keeps
const MAX_BYTES = 580_000 // the API accepts at most about 600 KB of picture
const OVERALL_MS = 40_000

// One capture at a time on an instance: Chromium is heavy, and a burst of links should queue rather than run the function out of memory.
let tail: Promise<unknown> = Promise.resolve()
const oneAtATime = <T>(job: () => Promise<T>): Promise<T> => {
  const run = tail.then(job, job)
  tail = run.catch(() => undefined)
  return run
}

/**
 * The real capture service (the API checks DESIGN_CAPTURE=false before it ever calls it). On Vercel it runs the Chromium that ships in @sparticuz/chromium;
 * anywhere else set CHROME_PATH to a Chrome or Chromium (a developer's own browser is fine). Both libraries load only when the first
 * link is captured, so the rest of the API pays nothing for them.
 */
export function makeCapture(env: Env): CaptureService {
  return (link) => oneAtATime(() => capture(link, env, env.DESIGN_CAPTURE_ALLOW_PRIVATE === 'true'))
}

async function capture(link: string, env: Env, allowPrivate: boolean): Promise<Screenshot> {
  const first = await assertCapturable(link, { allowPrivate })
  const { default: puppeteer } = await import('puppeteer-core')
  let browser: Awaited<ReturnType<typeof puppeteer.launch>>
  try {
    if (env.CHROME_PATH) {
      browser = await puppeteer.launch({ executablePath: env.CHROME_PATH, headless: true, args: env.CI ? ['--no-sandbox'] : [] })
    } else {
      const { default: chromium } = await import('@sparticuz/chromium')
      browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: 'shell' })
    }
  } catch (err) {
    console.error('Thumbnail capture: the browser did not start', err)
    throw new CaptureError(`The thumbnail service could not start (${reason(err)}). Upload a screenshot instead.`)
  }
  const timer = setTimeout(() => void browser.close().catch(() => undefined), OVERALL_MS)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE })
    await page.setUserAgent(`${await browser.userAgent()} SignalFlowThumbnail/1`)
    page.on('dialog', (d) => void d.dismiss().catch(() => undefined))
    // Every request the page makes (redirects, scripts, images) must also be a public web address.
    const verdicts = new Map<string, Promise<boolean>>()
    const allowed = (raw: string) => {
      if (/^(data|blob|about):/i.test(raw)) return Promise.resolve(true)
      let host: string
      try {
        host = new URL(raw).host
      } catch {
        return Promise.resolve(false)
      }
      if (!verdicts.has(host)) verdicts.set(host, assertCapturable(raw, { allowPrivate }).then(() => true, () => false))
      return verdicts.get(host)!
    }
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      void allowed(req.url()).then((ok) => (ok ? req.continue() : req.abort('blockedbyclient')), () => req.abort('failed')).catch(() => undefined)
    })
    let reached = false
    try {
      const res = await page.goto(first.toString(), { waitUntil: 'networkidle2', timeout: 20_000 })
      reached = !!res
      if (res && res.status() >= 400) throw new CaptureError(`That page answered with an error (${res.status()}), so there is nothing to capture.`)
    } catch (err) {
      if (err instanceof CaptureError) throw err
      // A page that never goes quiet (video, live data) is still captured once it has loaded.
      reached = page.url() !== 'about:blank' && !/chrome-error:/.test(page.url())
      if (!reached) throw new CaptureError('That page could not be opened. Check the link, or upload a screenshot instead.')
    }
    if (!/^https?:/i.test(page.url()) && !allowPrivate) throw new CaptureError('That page could not be captured.')
    await new Promise((r) => setTimeout(r, 800)) // fonts and entrance animations
    let quality = 80
    let data = Buffer.from(await page.screenshot({ type: 'jpeg', quality }))
    while (data.length > MAX_BYTES && quality > 40) {
      quality -= 20
      data = Buffer.from(await page.screenshot({ type: 'jpeg', quality }))
    }
    if (data.length > MAX_BYTES) throw new CaptureError('The picture of that page is too large to keep.')
    return { type: 'image/jpeg', data }
  } catch (err) {
    if (err instanceof CaptureError) throw err
    console.error('Thumbnail capture failed', err)
    throw new CaptureError(`The page could not be captured (${reason(err)}). Upload a screenshot instead.`)
  } finally {
    clearTimeout(timer)
    await browser.close().catch(() => undefined)
  }
}

export type PreflightStep = { name: string; ok: boolean; ms: number; detail?: string }
export type Preflight = { ok: boolean; enabled: boolean; node: string; platform: string; arch: string; steps: PreflightStep[]; checkedAt: string }

// What the deployment can actually do, step by step, without visiting any page: is the browser package there, does its binary unpack,
// does the browser start, can it draw. Safe to expose: it reads nothing of anyone's and opens no address. It is slow (a browser start),
// so the answer is kept for five minutes.
let lastPreflight: { at: number; key: string; value: Preflight } | undefined
export async function capturePreflight(env: Env): Promise<Preflight> {
  const key = `${env.CHROME_PATH}|${env.DESIGN_CAPTURE}`
  if (lastPreflight && lastPreflight.key === key && Date.now() - lastPreflight.at < 5 * 60_000) return lastPreflight.value
  const steps: PreflightStep[] = []
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    const t = Date.now()
    try {
      const out = await fn()
      steps.push({ name, ok: true, ms: Date.now() - t, detail: typeof out === 'string' ? out : undefined })
      return out
    } catch (err) {
      steps.push({ name, ok: false, ms: Date.now() - t, detail: reason(err) })
      return undefined
    }
  }
  const base = { node: process.version, platform: process.platform, arch: process.arch, checkedAt: new Date().toISOString() }
  if (env.DESIGN_CAPTURE === 'false') return { ...base, ok: false, enabled: false, steps }
  let executablePath = env.CHROME_PATH
  if (!executablePath) {
    const chromium = await step('the browser package loads', async () => (await import('@sparticuz/chromium')).default)
    if (chromium) executablePath = await step('the browser unpacks', async () => (await chromium.executablePath()) as string)
    if (executablePath) {
      const { statSync } = await import('node:fs')
      await step('the browser file is there', async () => `${Math.round(statSync(executablePath!).size / 1_000_000)} MB`)
    }
  }
  if (executablePath) {
    const { default: puppeteer } = await import('puppeteer-core')
    const chromium = env.CHROME_PATH ? undefined : (await import('@sparticuz/chromium')).default
    const browser = await step('the browser starts', async () =>
      env.CHROME_PATH
        ? await puppeteer.launch({ executablePath, headless: true, args: env.CI ? ['--no-sandbox'] : [] })
        : await puppeteer.launch({ executablePath, args: chromium!.args, headless: 'shell' }),
    )
    if (browser) {
      await step('the browser draws a page', async () => {
        const page = await browser.newPage()
        await page.setContent('<h1 style="font-family:sans-serif">ok</h1>')
        const shot = await page.screenshot({ type: 'jpeg' })
        return `${shot.length} bytes, ${await browser.version()}`
      })
      await browser.close().catch(() => undefined)
    }
    // The whole path a real capture takes (address checks, page load, picture) on a fixed page of this app's own site: nothing a
    // visitor chooses, so it cannot be used to visit anything else.
    const own = env.BETTER_AUTH_URL
    if (own && steps.every((s) => s.ok)) {
      await step('a page is captured end to end', async () => {
        const shot = await capture(new URL('/about.html', own).toString(), env, env.DESIGN_CAPTURE_ALLOW_PRIVATE === 'true')
        return `${new URL('/about.html', own).host}: ${Math.round(shot.data.length / 1000)} KB`
      })
    }
  }
  const value: Preflight = { ...base, ok: steps.length > 0 && steps.every((s) => s.ok), enabled: true, steps }
  lastPreflight = { at: Date.now(), key, value }
  return value
}
