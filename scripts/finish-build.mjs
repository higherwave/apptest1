// After `vite build`: the app's own page becomes dist/app.html, and the landing page becomes dist/index.html. Vercel serves a
// real file before it applies any routing rule, so this is how the bare address shows the landing page to visitors while every
// other address (see vercel.json) still opens the app. A signed-in person who lands on it is sent on by a small script in it.
import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function finishBuild(dist) {
  const index = join(dist, 'index.html')
  const landing = join(dist, 'landing.html')
  if (!existsSync(index) || !existsSync(landing)) throw new Error(`Expected index.html and landing.html in ${dist}. Did the build run?`)
  renameSync(index, join(dist, 'app.html'))
  copyFileSync(landing, index)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  finishBuild(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'))
  console.log('dist/index.html is the landing page; dist/app.html is the app.')
}
