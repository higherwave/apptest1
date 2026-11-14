// Turns a finished HTML page into a PDF with headless Chromium, the same browser the thumbnails use (the one in @sparticuz/chromium on Vercel, or CHROME_PATH
// anywhere else). The page is complete in itself, so every request it makes is refused: nothing is fetched, and a link in a launch's text can never make the
// server visit an address. This file is the seam: the API only knows PdfService, so tests use a stand-in and never start Chrome.
import type { Env } from './db.js'

export type PdfService = (html: string, footer: string) => Promise<Buffer>

/** A failure with a message fit to show the person. */
export class PdfError extends Error {}

const reason = (err: unknown) => String((err as Error)?.message ?? err).split('\n')[0].replace(/\/[\w./@-]+/g, '<path>').slice(0, 140)
const OVERALL_MS = 40_000

let tail: Promise<unknown> = Promise.resolve()
const oneAtATime = <T>(job: () => Promise<T>): Promise<T> => {
  const run = tail.then(job, job)
  tail = run.catch(() => undefined)
  return run
}

export function makePdf(env: Env): PdfService {
  return (html, footer) => oneAtATime(() => render(html, footer, env))
}

async function render(html: string, footer: string, env: Env): Promise<Buffer> {
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
    console.error('PDF export: the browser did not start', err)
    throw new PdfError(`The PDF service could not start (${reason(err)}).`)
  }
  const timer = setTimeout(() => void browser.close().catch(() => undefined), OVERALL_MS)
  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const ok = /^(data|about):/i.test(req.url())
      void (ok ? req.continue() : req.abort('blockedbyclient')).catch(() => undefined)
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 15_000 })
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#5c6773;padding:0 0.8in;display:flex;justify-content:space-between;font-family:sans-serif"><span>${footer.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margin: { top: '0.8in', bottom: '0.9in', left: '0.8in', right: '0.8in' },
    })
    return Buffer.from(pdf)
  } catch (err) {
    console.error('PDF export failed', err)
    throw new PdfError(`The PDF could not be made (${reason(err)}).`)
  } finally {
    clearTimeout(timer)
    await browser.close().catch(() => undefined)
  }
}
