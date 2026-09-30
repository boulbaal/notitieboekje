#!/usr/bin/env node
// Kleine statische server voor public/ (ontwikkelen en testen).
// - past de headers uit public/_headers toe (zodat de CSP ook lokaal geldt)
// - elke onbekende route krijgt index.html (zoals not_found_handling = "single-page-application")
// - met --stamp=<v> wordt __VERSION__ vervangen, zoals tools/deploy.mjs doet;
//   de testen gebruiken GET /__stamp?v=<v> om een nieuwe versie te "deployen".
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const arg = (naam, std) => {
  const a = process.argv.find((x) => x.startsWith('--' + naam + '='));
  return a ? a.slice(naam.length + 3) : std;
};
const port = Number(arg('port', process.env.PORT || 8790));
let stempel = arg('stamp', '');
const testModus = process.argv.includes('--test');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
};

// _headers lezen: blokken "pad" gevolgd door ingesprongen "Naam: waarde"
function leesHeaders() {
  const regels = fs.readFileSync(path.join(root, '_headers'), 'utf8').split('\n');
  const blokken = [];
  let huidig = null;
  for (const r of regels) {
    if (!r.trim() || r.trim().startsWith('#')) continue;
    if (!/^\s/.test(r)) { huidig = { patroon: r.trim(), headers: {} }; blokken.push(huidig); continue; }
    const i = r.indexOf(':');
    if (huidig && i > 0) huidig.headers[r.slice(0, i).trim()] = r.slice(i + 1).trim();
  }
  return blokken;
}
function headersVoor(pad) {
  const uit = {};
  for (const b of leesHeaders()) {
    const re = new RegExp('^' + b.patroon.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (re.test(pad)) Object.assign(uit, b.headers);
  }
  return uit;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (testModus && url.pathname === '/__stamp') {
    stempel = url.searchParams.get('v') || '';
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok ' + stempel);
  }
  let pad = decodeURIComponent(url.pathname);
  let bestand = path.join(root, pad);
  if (!bestand.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (pad.endsWith('/')) bestand = path.join(bestand, 'index.html');
  if (!fs.existsSync(bestand) || fs.statSync(bestand).isDirectory() || path.basename(bestand) === '_headers') {
    bestand = path.join(root, 'index.html');
  }
  let body = fs.readFileSync(bestand);
  const ext = path.extname(bestand);
  if (stempel && ['.html', '.js'].includes(ext)) body = Buffer.from(body.toString('utf8').replaceAll('__VERSION__', stempel));
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': 'no-cache',
    ...headersVoor(pad),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, () => console.log('Notitieboekje op http://localhost:' + port + (stempel ? ' (versie ' + stempel + ')' : '')));
