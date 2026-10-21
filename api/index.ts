// Vercel function entry. vercel.json rewrites every /api/* request here; the app routes on the original path.
import { createApp } from '../server/app.js'

const app = createApp()
export default { fetch: app.fetch }
