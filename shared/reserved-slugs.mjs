// Names that can never be a customer's workspace address (<name>.<our domain>): they belong to the platform itself. Used by the address resolver
// (server/workspace-host.ts), by workspace creation (db/init-workspace.mjs), and mirrored in the database by migration 0052.
export const RESERVED_SLUGS = ['www', 'app', 'api', 'admin', 'auth', 'login', 'sign-in', 'signin', 'status', 'staff', 'mail', 'docs', 'help', 'support', 'static', 'assets', 'cdn', 'dev', 'staging', 'test'];
