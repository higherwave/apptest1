// npm run sso:try: the sign-in test API and the app, side by side, for trying a real identity provider on this machine.
// Reads db/.env.sso.local (gitignored). Open the address it prints and sign in.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const file = join(root, 'db', '.env.sso.local')
if (!existsSync(file)) {
  console.error('Create db/.env.sso.local first: docs/SSO-TRY.md says what goes in it (the issuer, client id and client secret of your provider).')
  process.exit(1)
}
const appPort = process.env.SSO_TRY_APP_PORT || '5198'
const apiPort = process.env.SSO_TRY_API_PORT || '8793'
const children = [
  spawn('node', [`--env-file=${file}`, '--import', 'tsx', 'server/dev-sso.ts'], { cwd: root, stdio: 'inherit' }),
  spawn('npx', ['vite', '--port', appPort, '--strictPort'], { cwd: root, env: { ...process.env, API_PORT: apiPort }, stdio: 'ignore' }),
]
console.log(`\nOpen http://localhost:${appPort} and sign in. Press Ctrl+C to stop.\n`)
const stop = () => children.forEach((c) => c.kill('SIGTERM'))
process.on('SIGINT', () => { stop(); process.exit(0) })
children[0].on('exit', (code) => { stop(); process.exit(code ?? 0) })
