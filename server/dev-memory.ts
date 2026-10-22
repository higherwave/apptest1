// Local API on a throwaway in-memory copy of the demo data (PGlite): no Neon, no cost, safe to break.
//   npm run dev:api:memory        (set DEV_TOKEN=... to try the read-only / unlock flow)
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { createDemoDatabase, fakeAuth } from './test-utils.js'

const { db } = await createDemoDatabase()
const port = Number(process.env.API_PORT || 8787)
// AUTH_TEST=true switches on sign-in with the stand-in service (see fakeAuth), for the browser tests of sign-in.
const auth = process.env.AUTH_TEST === 'true' ? fakeAuth() : undefined
serve({ fetch: createApp({ getDb: () => db, auth }).fetch, port }, () => console.log(`In-memory API on http://localhost:${port}/api/v1/health`))
