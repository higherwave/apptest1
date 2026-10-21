// Starts an in-memory API (no Neon) and the Vite dev server, runs the browser flow, and stops both.
//   npm run e2e            (needs Google Chrome; set CHROME_PATH to use another)
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN = 'e2e-token'
const children = []
const start = (cmd, args, env = {}) => {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' })
  children.push(child)
  return child
}
const stopAll = () => children.forEach((c) => c.kill('SIGTERM'))
process.on('SIGINT', () => { stopAll(); process.exit(130) })

async function waitFor(url, label, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  stopAll()
  throw new Error(`${label} did not start within ${ms / 1000}s`)
}

start('npx', ['tsx', 'server/dev-memory.ts'], { DEV_TOKEN: TOKEN, API_PORT: '8791' })
start('npx', ['vite', '--port', '5198', '--strictPort'], { API_PORT: '8791' })
await waitFor('http://localhost:8791/api/v1/health', 'The API')
await waitFor('http://localhost:5198/', 'The app')

const flow = spawn('node', ['e2e/flow.mjs'], { cwd: root, env: { ...process.env, E2E_BASE: 'http://localhost:5198', E2E_TOKEN: TOKEN }, stdio: 'inherit' })
flow.on('exit', (code) => { stopAll(); process.exit(code ?? 1) })
