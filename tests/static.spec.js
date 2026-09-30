// Statische controles: talen volledig, geen verboden tekens of namen, bestanden in orde.
// Deze testen starten geen browser.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function laadI18n() {
  const code = fs.readFileSync(path.join(PUBLIC, 'i18n.js'), 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.self.NB_I18N;
}
const plaatshouders = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join(',');

// alle tekstbestanden van het project (zonder node_modules, .git, dist, test-results)
function bestanden(dir = ROOT, uit = []) {
  for (const naam of fs.readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'test-results', 'playwright-report', '.wrangler'].includes(naam)) continue;
    const p = path.join(dir, naam);
    const st = fs.statSync(p);
    if (st.isDirectory()) bestanden(p, uit);
    else if (/\.(html|js|mjs|css|json|webmanifest|md|txt|xml|toml|py)$|^_headers$|^LICENSE$/.test(naam)) uit.push(p);
  }
  return uit;
}

test('23 languages, each with every key and the same placeholders as English', () => {
  const { TALEN, TEKSTEN } = laadI18n();
  const codes = Object.keys(TALEN);
  expect(codes).toEqual(['en', 'nl', 'fr', 'de', 'es', 'pt', 'pl', 'uk', 'ru', 'tr', 'ar', 'ur', 'hi', 'bn', 'id', 'vi', 'zh', 'ja', 'ko', 'sw', 'zgh', 'ku', 'sn']);
  expect(Object.keys(TEKSTEN).sort()).toEqual([...codes].sort());
  const sleutels = Object.keys(TEKSTEN.en).sort();
  expect(sleutels.length).toBeGreaterThan(15);
  for (const code of codes) {
    expect(Object.keys(TEKSTEN[code]).sort(), 'keys of ' + code).toEqual(sleutels);
    for (const k of sleutels) {
      const s = TEKSTEN[code][k];
      expect(typeof s, code + ' ' + k).toBe('string');
      expect(s.trim().length, code + ' ' + k + ' is empty').toBeGreaterThan(0);
      expect(plaatshouders(s), code + ' ' + k + ' placeholders').toBe(plaatshouders(TEKSTEN.en[k]));
    }
    // de merknaam blijft in elke taal hetzelfde
    expect(TEKSTEN[code]['donate.intro'], code).toContain('Notitieboekje');
  }
  expect(TALEN.ar.rtl).toBe(true);
  expect(TALEN.ur.rtl).toBe(true);
  expect(codes.filter((c) => TALEN[c].rtl)).toEqual(['ar', 'ur']);
});

test('translations are real translations (not copied English) for the main labels', () => {
  const { TEKSTEN } = laadI18n();
  for (const code of Object.keys(TEKSTEN)) {
    if (code === 'en') continue;
    for (const k of ['new', 'back', 'torn', 'undo', 'empty', 'lang.pick']) {
      expect(TEKSTEN[code][k], code + ' ' + k).not.toBe(TEKSTEN.en[k]);
    }
  }
});

test('the PayPal name is ABoulbahaiem and the misspelling appears nowhere', () => {
  const fout = 'ABoul' + 'lbahaiem';
  for (const p of bestanden()) {
    const s = fs.readFileSync(p, 'utf8');
    expect(s.includes(fout), p).toBe(false);
  }
  const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  expect(app).toContain("const PAYPAL = 'ABoulbahaiem';");
});

test('no e-mail addresses and no em dashes in the project', () => {
  const mail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
  const streep = String.fromCharCode(0x2014);   // em dash
  for (const p of bestanden()) {
    const s = fs.readFileSync(p, 'utf8');
    expect(mail.test(s) ? p + ': ' + s.match(mail)[0] : null).toBeNull();
    expect(s.includes(streep) ? p : null, 'em dash in ' + p).toBeNull();
  }
});

test('no external resources in the app files', () => {
  for (const f of ['index.html', 'style.css', 'app.js', 'sw.js', 'i18n.js']) {
    const s = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    // enkel links naar PayPal (doneren) en de eigen site (meta/OG) mogen een volledige URL hebben
    const urls = (s.match(/https?:\/\/[^\s'"`)<>]+/g) || [])
      .filter((u) => !u.startsWith('https://www.paypal.com/paypalme/') && !u.startsWith('https://notitieboekje.vanali.workers.dev/') && !u.startsWith('http://www.w3.org/'));
    expect(urls, f).toEqual([]);
    expect(s).not.toMatch(/fonts\.googleapis|cdnjs|jsdelivr|unpkg|googletagmanager|analytics/i);
  }
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  expect(html).not.toMatch(/<script>|\son[a-z]+="/);   // geen inline scripts of event-attributen (strikte CSP)
  expect(html).not.toMatch(/\sstyle="/);
});

test('user text never goes through innerHTML', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  expect(app).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('headers: strict CSP and the basic security headers', () => {
  const h = fs.readFileSync(path.join(PUBLIC, '_headers'), 'utf8');
  expect(h).toMatch(/Content-Security-Policy: default-src 'none'; script-src 'self';/);
  expect(h).not.toMatch(/unsafe-inline|unsafe-eval/);
  expect(h).toMatch(/X-Content-Type-Options: nosniff/);
  expect(h).toMatch(/Referrer-Policy: /);
  expect(h).toMatch(/frame-ancestors 'none'/);
});

test('manifest, icons, OG image, robots and sitemap', () => {
  const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
  expect(m.name).toBe('Notitieboekje');
  expect(m.display).toBe('standalone');
  expect(m.orientation).toBe('portrait');
  expect(m.start_url).toBe('/');
  expect(m.theme_color).toMatch(/^#F[0-9A-F]E[0-9A-F]{3}$/i);   // geel
  const pngMaat = (f) => { const b = fs.readFileSync(path.join(PUBLIC, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  for (const i of m.icons) {
    const [w, hgt] = pngMaat(i.src.slice(1));
    expect(i.sizes).toBe(w + 'x' + hgt);
  }
  expect(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
  expect(pngMaat('apple-touch-icon.png')).toEqual([180, 180]);
  // schermafdruk voor de rijkere installatie-weergave in Chrome
  const smal = (m.screenshots || []).find((x) => x.form_factor === 'narrow');
  expect(smal).toBeTruthy();
  expect(fs.existsSync(path.join(PUBLIC, smal.src.slice(1)))).toBe(true);
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
  expect(pngMaat('og.png')).toEqual([1200, 630]);
  expect(fs.readFileSync(path.join(PUBLIC, 'robots.txt'), 'utf8')).toContain('Sitemap: https://notitieboekje.vanali.workers.dev/sitemap.xml');
  const sitemap = fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
  expect(sitemap.match(/<loc>/g)).toHaveLength(1);
  expect(sitemap).toContain('<loc>https://notitieboekje.vanali.workers.dev/</loc>');
});

test('version placeholder is where deploy.mjs expects it, and the SW caches every shell file', () => {
  expect(fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8')).toContain("const VERSION = '__VERSION__';");
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  expect(sw).toContain("const VERSION = '__VERSION__';");
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of shell) {
    if (f === '/') continue;
    expect(fs.existsSync(path.join(PUBLIC, f)), f).toBe(true);
  }
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  for (const ref of html.match(/(?:src|href)="(\/[^"]+)"/g).map((x) => x.split('"')[1])) {
    if (ref === '/manifest.webmanifest' || ref.endsWith('.png') || ref.endsWith('.js') || ref.endsWith('.css')) {
      expect(shell, 'SW shell mist ' + ref).toContain(ref);
    }
  }
  const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  expect(toml).toMatch(/name = "notitieboekje"/);
  expect(toml).toMatch(/directory = "\.\/public"/);
  expect(toml).not.toMatch(/^main\s*=/m);
});
