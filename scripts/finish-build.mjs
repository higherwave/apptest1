// After `vite build`: the app's own page becomes dist/app.html, and the landing page becomes dist/index.html. Vercel serves a
// real file before it applies any routing rule, so this is how the bare address shows the landing page to visitors while every
// other address (see vercel.json) still opens the app. A signed-in person who lands on it is sent on by a small script in it.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBrand, renderBrand } from './brand.mjs'

export function finishBuild(dist, brand = loadBrand()) {
  const index = join(dist, 'index.html')
  const landing = join(dist, 'landing.html')
  if (!existsSync(index) || !existsSync(landing)) throw new Error(`Expected index.html and landing.html in ${dist}. Did the build run?`)
  // The static pages carry {{appName}}-style placeholders (brand/brand.json); fill them in before the landing page becomes the index.
  for (const name of ['landing.html', 'about.html', 'privacy.html']) {
    const file = join(dist, name)
    if (existsSync(file)) writeFileSync(file, renderBrand(readFileSync(file, 'utf8'), brand))
  }
  renameSync(index, join(dist, 'app.html'))
  copyFileSync(landing, index)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  finishBuild(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'))
  console.log('dist/index.html is the landing page; dist/app.html is the app.')
}
