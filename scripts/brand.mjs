// The words that name the company and the product, kept in brand/brand.json and nowhere else. The React app imports the JSON; the
// static pages in public/ (landing, about, privacy) carry {{appName}}-style placeholders that this fills in, in the dev server
// and at the end of the build. A placeholder with no value is an error, never a blank.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

export function loadBrand(file = join(root, 'brand', 'brand.json')) {
  const brand = JSON.parse(readFileSync(file, 'utf8'))
  for (const key of ['appName', 'orgName', 'orgDomain', 'contactEmail']) {
    if (typeof brand[key] !== 'string' || !brand[key].trim()) throw new Error(`${file}: "${key}" is required.`)
  }
  return brand
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Replaces {{key}} with the escaped value from the brand. Throws on a key the brand does not have. */
export function renderBrand(html, brand) {
  return html.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_, key) => {
    if (!(key in brand)) throw new Error(`The page uses {{${key}}} but brand/brand.json has no "${key}".`)
    return escapeHtml(brand[key])
  })
}

export const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g
