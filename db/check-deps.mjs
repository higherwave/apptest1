// Enforces the schema dependency rule: a schema may only reference schemas above it.
//   core <- research <- delivery, insights   (delivery and insights never reference each other)
// Reads the up migrations; exits 1 on a violation.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ALLOWED = {
  core: [],
  research: ['core'],
  delivery: ['core', 'research'],
  insights: ['core', 'research'],
};

export function findViolations(dir) {
  const violations = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--.*$/gm, '');
    // Split into CREATE TABLE statements and look at each table's references.
    const tables = sql.split(/create\s+table\s+/i).slice(1);
    for (const chunk of tables) {
      const name = chunk.match(/^([a-z_]+)\.([a-z_]+)/i);
      if (!name) continue;
      const [, schema, table] = name;
      for (const ref of chunk.matchAll(/references\s+([a-z_]+)\.([a-z_]+)/gi)) {
        const target = ref[1];
        if (target !== schema && !(ALLOWED[schema] || []).includes(target)) {
          violations.push(`${file}: ${schema}.${table} references ${target}.${ref[2]}`);
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const bad = findViolations(dir);
  if (bad.length) {
    console.error('Dependency rule violated:\n' + bad.map((b) => '  ' + b).join('\n'));
    process.exit(1);
  }
  console.log('Dependency rule holds: core <- research <- delivery, insights');
}
