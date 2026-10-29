// Local API on a throwaway in-memory copy of the demo data (PGlite): no Neon, no cost, safe to break.
//   npm run dev:api:memory        (set DEV_TOKEN=... to try the read-only / unlock flow)
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createApp } from './app.js'
import { createDemoDatabase, fakeAuth } from './test-utils.js'

// ANCHOR_CX=true also loads the Anchor CX demo story (db/seed/anchor-cx/README.md).
const { db } = await createDemoDatabase({ anchor: process.env.ANCHOR_CX === 'true' })
const port = Number(process.env.API_PORT || 8787)
const env = { ...process.env }
// AUTH_TEST=true switches on sign-in with the stand-in service (see fakeAuth), for the browser tests of sign-in. It also
// adds POST /__test/public-view/true|false so a test can flip PUBLIC_VIEW while the server runs.
const testAuth = process.env.AUTH_TEST === 'true'
const app = createApp({ env, getDb: () => db, auth: testAuth ? fakeAuth() : undefined })
const root = new Hono()
if (testAuth) {
  root.post('/__test/public-view/:on', (c) => {
    env.PUBLIC_VIEW = c.req.param('on') === 'true' ? 'true' : 'false'
    return c.json({ publicView: env.PUBLIC_VIEW })
  })
}
root.route('/', app)
serve({ fetch: root.fetch, port }, () => console.log(`In-memory API on http://localhost:${port}/api/v1/health`))
