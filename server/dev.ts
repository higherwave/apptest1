// Local API server for development: npm run dev:api (Vite proxies /api to it).
import { serve } from '@hono/node-server'
import { createApp } from './app.js'

// Use db/.env.local for the connection string when it exists; never required.
try {
  process.loadEnvFile('db/.env.local')
} catch {
  /* no local env file: the API starts without a database */
}

const port = Number(process.env.API_PORT || 8787)
serve({ fetch: createApp().fetch, port }, () => console.log(`API on http://localhost:${port}/api/v1/health`))
