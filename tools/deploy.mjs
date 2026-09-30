#!/usr/bin/env node
// Deploy naar Cloudflare Workers (alleen statische bestanden) met het korte
// git-commitnummer als versie.
// 1. weigert een werkboom met niet-gecommitte wijzigingen (dan klopt de versie niet)
// 2. kopieert public/ en wrangler.toml naar dist/
// 3. vervangt __VERSION__ in app.js en sw.js door de commit-hash
//    (de app toont ze in de voet; de service worker krijgt zo een nieuwe cache)
// 4. npx wrangler deploy --config dist/wrangler.toml
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');

const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim();
if (dirty && !process.argv.includes('--allow-dirty')) {
  console.error('Werkboom is niet schoon. Commit eerst, zodat de versie (' + sha + ') klopt met de code.\n' +
    'Toch deployen: node tools/deploy.mjs --allow-dirty');
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });
fs.copyFileSync(path.join(root, 'wrangler.toml'), path.join(dist, 'wrangler.toml'));

let vervangen = 0;
for (const f of ['public/app.js', 'public/sw.js']) {
  const p = path.join(dist, f);
  const voor = fs.readFileSync(p, 'utf8');
  const na = voor.replaceAll('__VERSION__', sha);
  if (na !== voor) vervangen++;
  fs.writeFileSync(p, na);
}
if (vervangen !== 2) {
  console.error('Verwachtte __VERSION__ in 2 bestanden, gevonden in ' + vervangen);
  process.exit(1);
}
console.log('versie ' + sha + ' gestempeld, deployen...');
if (process.argv.includes('--dry-run')) { console.log('dry run: klaar in dist/'); process.exit(0); }
execSync('npx wrangler deploy --config dist/wrangler.toml', { cwd: root, stdio: 'inherit' });
console.log('klaar: versie ' + sha + ' op https://notitieboekje.vanali.workers.dev');
