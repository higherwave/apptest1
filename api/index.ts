// Vercel function entry. vercel.json rewrites every /api/* request here; the app routes on the original path.
import { createApp } from '../server/app.js'

// Defaults for the deployed demo, each overridden by setting the variable in Vercel:
//   OPEN_EDITING=true   anyone with the link can edit, with no sign-in. Set it to false to require an invitation to edit.
//   PUBLIC_VIEW=true    with editing closed, a visitor who is not signed in can still look around, read-only. Set it to
//                       false to require sign-in even to look.
// Local runs and the tests build the app themselves and stay closed unless they ask for these.
const app = createApp({ env: { OPEN_EDITING: 'true', PUBLIC_VIEW: 'true', ...process.env } })
export default { fetch: app.fetch }
