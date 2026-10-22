// Makes the first owners: invites each email address as an owner of the workspace (the same rows the Members page
// creates), so the first Google sign-in has an invitation to match. Safe to run again: an existing person is
// promoted, never duplicated.
//
//   node db/bootstrap-owners.mjs a@example.com b@example.com          dry run: shows what it would do
//   node db/bootstrap-owners.mjs a@example.com b@example.com --yes    does it
//
// The connection string comes from db/.env.local or the environment, like migrate.mjs. The workspace is
// DEMO_WORKSPACE_SLUG (default higherwave-demo).
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { findConnectionString, loadEnvFile } from './migrate.mjs';

// `db` is anything with query(sql, params), so tests can run it on an in-memory database.
export async function bootstrapOwners(db, slug, emails) {
  const workspace = (await db.query('select id from core.workspaces where slug = $1', [slug])).rows[0];
  if (!workspace) throw new Error(`No workspace "${slug}". Run the seed first.`);
  const done = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`"${raw}" is not an email address.`);
    let user = (await db.query('select id from core.users where lower(email) = $1', [email])).rows[0];
    if (!user) user = (await db.query('insert into core.users (email, display_name) values ($1, $2) returning id', [email, email.split('@')[0]])).rows[0];
    await db.query(
      `insert into core.memberships (workspace_id, user_id, role) values ($1, $2, 'owner')
       on conflict (workspace_id, user_id) do update set role = 'owner'`,
      [workspace.id, user.id],
    );
    done.push(email);
  }
  return done;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const emails = args.filter((a) => !a.startsWith('--'));
  if (!emails.length) {
    console.error('Give one or more email addresses.');
    process.exit(1);
  }
  loadEnvFile();
  const url = findConnectionString(process.env);
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).');
    process.exit(1);
  }
  const slug = process.env.DEMO_WORKSPACE_SLUG || 'higherwave-demo';
  console.log(`Target: ${new URL(url).host}, workspace "${slug}"`);
  console.log(`Owners: ${emails.join(', ')}`);
  if (!yes) {
    console.log('Dry run. Add --yes to make them owners.');
    process.exit(0);
  }
  const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
  await client.connect();
  try {
    await client.query('begin');
    const done = await bootstrapOwners(client, slug, emails);
    await client.query('commit');
    console.log(`Done: ${done.join(', ')} are owners.`);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
