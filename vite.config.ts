import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
// @ts-expect-error plain ESM shared with the build scripts
import { loadBrand, renderBrand } from './scripts/brand.mjs'

// The company and product names live in brand/brand.json. The app's page and the static pages in public/ carry {{appName}}-style
// placeholders; this fills them in while developing, and scripts/finish-build.mjs does the same for the built files.
const here = fileURLToPath(new URL('.', import.meta.url))
function brandHtml(): Plugin {
  return {
    name: 'brand-html',
    transformIndexHtml: (html) => renderBrand(html, loadBrand()),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const page = (req.url || '').split('?')[0].match(/^\/(about|privacy|landing)\.html$/)
        if (!page) return next()
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(renderBrand(readFileSync(`${here}public/${page[1]}.html`, 'utf8'), loadBrand()))
      })
    },
  }
}

// In development the API runs separately (npm run dev:api) and Vite forwards /api to it.
export default defineConfig({
  plugins: [react(), brandHtml()],
  server: { proxy: { '/api': `http://localhost:${process.env.API_PORT || 8787}` } },
})
