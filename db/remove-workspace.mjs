// Removes a customer's workspace and everything in it, for good, at the end of an agreement (the customer has had its export, and we have held the data for
// 30 days after the end date in case they needed it). It refuses while a legal hold is in force. It removes the workspace's people too when they belong to no
// other workspace, so nothing personal is left behind. Then it prints a written confirmation to send the customer.
//
//   node db/remove-workspace.mjs --workspace acme                          dry run: what would go, and whether a hold stops it
//   node db/remove-workspace.mjs --workspace acme --confirm acme --yes     does it (the name typed twice, so it cannot be a slip)
//
// Backups of the database expire on the provider's own schedule, so the confirmation says when the last copy is gone, not that it is gone already.
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { findConnectionString, loadEnvFile } from './migrate.mjs';

const BACKUP_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 7);

/** What is in the workspace, so a person can see what is about to go. Touches nothing. */
export async function inventory(db, slug) {
  const ws = (await db.query('select id, name, slug, created_at from core.workspaces where slug = $1', [slug])).rows[0];
  if (!ws) throw new Error(`No workspace with the slug "${slug}".`);
  const n = async (sql) => Number((await db.query(sql, [ws.id])).rows[0].n);
  const holds = (await db.query(`select scope_name, reason from core.legal_holds where workspace_id = $1 and released_at is null`, [ws.id])).rows;
  return {
    ws,
    holds,
    counts: {
      projects: await n(`select count(*)::int n from core.projects where workspace_id = $1`),
      transcripts: await n(`select count(*)::int n from research.transcripts where workspace_id = $1`),
      themes: await n(`select count(*)::int n from research.themes where workspace_id = $1`),
      launches: await n(`select count(*)::int n from delivery.launches where workspace_id = $1`),
      inTrash: await n(`select count(*)::int n from core.trash where workspace_id = $1`),
      members: await n(`select count(*)::int n from core.memberships where workspace_id = $1`),
    },
  };
}

/** Deletes the workspace (every table cascades from it), then the people who belonged only to it. Returns what was removed. */
export async function removeWorkspace(db, slug, confirm) {
  const inv = await inventory(db, slug);
  if (confirm !== slug) throw new Error(`To remove "${slug}", type it again with --confirm ${slug}.`);
  if (inv.holds.length) throw new Error(`"${slug}" is under a legal hold (${inv.holds.map((h) => `${h.scope_name}: ${h.reason}`).join('; ')}). It cannot be removed until an owner releases the hold.`);
  const members = (await db.query('select user_id from core.memberships where workspace_id = $1', [inv.ws.id])).rows.map((r) => r.user_id);
  await db.query('delete from core.workspaces where id = $1', [inv.ws.id]);
  // A person who belongs to no other workspace goes too, with their sign-in account and sessions; one who belongs elsewhere stays.
  const gone = (
    await db.query(
      `with orphans as (select u.id, u.auth_subject from core.users u where u.id = any($1::uuid[]) and not exists (select 1 from core.memberships m where m.user_id = u.id)),
            sessions as (delete from public.auth_user a using orphans o where a.id = o.auth_subject returning a.id),
            removed as (delete from core.users u using orphans o where u.id = o.id returning u.id)
       select (select count(*) from removed)::int as people`,
      [members],
    )
  ).rows[0].people;
  return { ...inv, peopleRemoved: Number(gone) };
}

export function confirmation(r, now = new Date()) {
  const last = new Date(now.getTime() + BACKUP_DAYS * 86400000);
  return [
    `Confirmation of removal: ${r.ws.name}`,
    '',
    `On ${now.toISOString().slice(0, 10)} we removed your Signal Flow workspace "${r.ws.name}" and all the data in it: ${r.counts.projects} projects, ${r.counts.transcripts} transcripts,`,
    `${r.counts.themes} themes, ${r.counts.launches} launches and everything that belonged to them, including the items in your deleted-items list, and the sign-in records of ${r.peopleRemoved} people`,
    'who belonged only to your workspace.',
    '',
    `Our database provider keeps backups for up to ${BACKUP_DAYS} days. The last backup that can contain your data expires on ${last.toISOString().slice(0, 10)}; backups are not used for anything else and are not restored into the live service.`,
    'Anything you sent to the AI provider to be analysed is deleted from their systems within 30 days of being sent, under their published terms.',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  loadEnvFile();
  const slug = flag('--workspace');
  const url = findConnectionString(process.env);
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).');
    process.exit(1);
  }
  console.log(`Target: ${new URL(url).host}`);
  const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
  await client.connect();
  try {
    const inv = await inventory(client, slug);
    console.log(`Workspace "${inv.ws.name}" (${inv.ws.slug}), made ${new Date(inv.ws.created_at).toISOString().slice(0, 10)}:`);
    console.log(`  ${JSON.stringify(inv.counts)}`);
    if (inv.holds.length) console.log(`  LEGAL HOLD IN FORCE: ${inv.holds.map((h) => `${h.scope_name} (${h.reason})`).join('; ')}`);
    if (!args.includes('--yes')) {
      console.log('Dry run. Remove it for good with:  --confirm <the same name> --yes');
      process.exit(inv.holds.length ? 2 : 0);
    }
    await client.query('begin');
    const r = await removeWorkspace(client, slug, flag('--confirm'));
    await client.query('commit');
    console.log('\nRemoved.\n');
    console.log(confirmation(r));
    console.log('Send the confirmation above to the customer, and keep a copy.');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
