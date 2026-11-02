// Vercel function entry. vercel.json rewrites every /api/* request here; the app routes on the original path.
import { createApp } from '../server/app.js'

// Defaults for the deployed demo, each overridden by setting the variable in Vercel:
//   OPEN_EDITING=true   anyone with the link can edit, with no sign-in. Set it to false to require an invitation to edit.
//   PUBLIC_VIEW=true    with editing closed, a visitor who is not signed in can still look around, read-only. Set it to
//                       false to require sign-in even to look.
// A deployment with its own company sign-in (OIDC_ISSUER) is not a demo, so it starts closed: nobody gets in without signing in,
// unless these are set to true on purpose. Local runs and the tests build the app themselves and stay closed unless they ask.
const demo = process.env.OIDC_ISSUER ? {} : { OPEN_EDITING: 'true', PUBLIC_VIEW: 'true' }
const app = createApp({ env: { ...demo, ...process.env } })
export default { fetch: app.fetch }
