// Re-extracts the prototype's sample data into db/seed/data/*.json, so seed data is never retyped.
//   node seed/extract-from-prototype.mjs [baseUrlOrDir]
// The prototype files assign window.SFData.<name>; they are evaluated with a stub window.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL_BASE = 'https://www.thehigherwave.com/prototypes/productivity/research-driven-process';
const BASE = process.argv[2] || URL_BASE;
const here = dirname(fileURLToPath(import.meta.url));

async function load(name) {
  if (/^https?:/.test(BASE)) {
    const res = await fetch(`${BASE}/data/${name}.js`);
    if (!res.ok) throw new Error(`${name}.js: HTTP ${res.status}`);
    return res.text();
  }
  return readFileSync(join(BASE, 'data', `${name}.js`), 'utf8');
}

const stamp = new Date().toISOString().slice(0, 10);
for (const [file, key] of [['research', 'research'], ['boards', 'boards'], ['platformInsights', 'platformInsights']]) {
  const win = { SFData: {} };
  new Function('window', await load(file))(win);
  const out = { _source: `${URL_BASE}/data/${file}.js`, _extracted: stamp, ...win.SFData[key] };
  writeFileSync(join(here, 'data', `${file}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote data/${file}.json (${Object.keys(out).length - 2} keys)`);
}
