// Vercel function entry. vercel.json rewrites every /api/* request here; the app routes on the original path.
import { createApp } from '../server/app.js'

// Editing is open on the deployed demo until real sign-in exists (it is shared only with named people): a visitor with
// no token acts as the demo owner. Set OPEN_EDITING=false in Vercel to lock it again. Local runs and the tests build
// the app themselves and stay closed unless they ask for this.
const app = createApp({ env: { OPEN_EDITING: 'true', ...process.env } })
export default { fetch: app.fetch }
