// Browsertesten voor Notitieboekje (desktop 1280x800, telefoon 360 en 390 breed).
// Elke test controleert ook: geen consolefouten en geen verzoeken naar andere sites.
const base = require('@playwright/test');
const { expect } = base;

const test = base.test.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const fouten = [];
    const extern = [];
    const eigen = new URL(baseURL).origin;
    page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
    page.on('pageerror', (e) => fouten.push(String(e)));
    page.context().on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(eigen) && !u.startsWith('data:') && !u.startsWith('blob:')) extern.push(u);
    });
    await use(page);
    if (!testInfo.annotations.some((a) => a.type === 'allow-console-errors')) {
      expect(fouten, 'console errors').toEqual([]);
    }
    expect(extern, 'external requests').toEqual([]);
  },
});

const isMobiel = (testInfo) => testInfo.project.name.startsWith('mobile');

async function open(page) {
  await page.goto('/');
  await expect(page.locator('#titel')).toHaveText('Notitieboekje');
}
async function nieuwBlad(page, tekst) {
  await page.locator('#plus').click();
  await expect(page.locator('#blad')).toBeVisible();
  await expect(page.locator('#tekst')).toBeFocused();
  if (tekst !== undefined) {
    const regels = tekst.split('\n');
    for (let i = 0; i < regels.length; i++) {
      if (i > 0) await page.keyboard.press('Enter');
      if (regels[i]) await page.keyboard.type(regels[i]);
    }
  }
}
async function terug(page) {
  await page.locator('#terug').click();
  await expect(page.locator('#begin')).toBeVisible();
  await expect(page.locator('#blad')).toBeHidden();
}
const rijen = (page) => page.locator('#lijst li .rij');
const opgeslagen = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('notitieboekje.n.')).length);
async function zaai(page, notities) {
  await page.evaluate((n) => {
    const nu = Date.now();
    n.forEach((t, i) => localStorage.setItem('notitieboekje.n.z' + String(i).padStart(4, '0'), JSON.stringify({ t, u: nu - i * 1000, c: nu - i * 1000 })));
  }, notities);
  await page.reload();
}

// wegvegen: met de vinger (CDP-touch, dus echte pointer-events van het type touch) of met de muis
async function veeg(page, locator, dx, testInfo) {
  const box = await locator.boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width * (dx > 0 ? 0.25 : 0.75);
  if (isMobiel(testInfo)) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 12, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 + dx, y, { steps: 12 });
    await page.mouse.up();
  }
}
async function langDrukken(page, locator) {
  const box = await locator.boundingBox();
  const p = { x: box.x + box.width / 3, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await page.waitForTimeout(750);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/* ---------------- schrijven en bewaren ---------------- */

test('write a note with Enter lines, go back: home shows the first line; reload keeps it', async ({ page }) => {
  await open(page);
  await expect(page.locator('#leeg')).toBeVisible();
  await nieuwBlad(page, 'Boodschappen\nmelk\nbrood');
  await expect(page.locator('#tekst')).toHaveValue('Boodschappen\nmelk\nbrood');
  await terug(page);
  await expect(rijen(page)).toHaveCount(1);
  await expect(rijen(page).first()).toHaveText('Boodschappen');
  await expect(page.locator('#leeg')).toBeHidden();
  await page.reload();
  await expect(rijen(page)).toHaveCount(1);
  await expect(rijen(page).first()).toHaveText('Boodschappen');
  await rijen(page).first().click();
  await expect(page.locator('#tekst')).toHaveValue('Boodschappen\nmelk\nbrood');
  await expect(page.locator('#tekst')).toBeFocused();
  // de cursor staat aan het eind: verder schrijven gaat meteen
  await page.keyboard.press('Enter');
  await page.keyboard.type('kaas');
  await terug(page);
  const t = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('notitieboekje.n.')))).t);
  expect(t).toBe('Boodschappen\nmelk\nbrood\nkaas');
});

test('saves on its own after a short pause, without going back', async ({ page }) => {
  await open(page);
  await nieuwBlad(page, 'Autosave');
  await page.waitForTimeout(700);
  expect(await opgeslagen(page)).toBe(1);
  // en ook bij verbergen van de pagina (pagehide / visibilitychange)
  await page.keyboard.type(' en meer');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const t = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('notitieboekje.n.')))).t);
  expect(t).toBe('Autosave en meer');
});

test('editing a note updates its preview and moves it to the top', async ({ page }) => {
  await open(page);
  await nieuwBlad(page, 'Eerste');
  await terug(page);
  await nieuwBlad(page, 'Tweede');
  await terug(page);
  await expect(rijen(page)).toHaveText(['Tweede', 'Eerste']);
  await rijen(page).nth(1).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Nu bovenaan: ');
  await terug(page);
  await expect(rijen(page)).toHaveText(['Nu bovenaan: Eerste', 'Tweede']);
  await expect(rijen(page).first()).toBeFocused();
  // alleen openen en terug (zonder te wijzigen) verandert de volgorde niet
  await rijen(page).nth(1).click();
  await terug(page);
  await expect(rijen(page)).toHaveText(['Nu bovenaan: Eerste', 'Tweede']);
});

test('an empty new page is not kept (also only spaces and newlines, or text erased again)', async ({ page }) => {
  await open(page);
  await nieuwBlad(page);
  await terug(page);
  await expect(rijen(page)).toHaveCount(0);
  await nieuwBlad(page, '   \n\n  ');
  await terug(page);
  await expect(rijen(page)).toHaveCount(0);
  await nieuwBlad(page, 'weg');
  await page.waitForTimeout(500);
  expect(await opgeslagen(page)).toBe(1);
  await page.locator('#tekst').fill('');
  await terug(page);
  await expect(rijen(page)).toHaveCount(0);
  expect(await opgeslagen(page)).toBe(0);
  await expect(page.locator('#leeg')).toBeVisible();
});

test('the browser back button returns to the list and keeps the text', async ({ page }) => {
  await open(page);
  await nieuwBlad(page, 'Via terugknop');
  await page.goBack();
  await expect(page.locator('#begin')).toBeVisible();
  await expect(rijen(page)).toHaveText(['Via terugknop']);
  // Escape doet hetzelfde (toetsenbord)
  await rijen(page).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#begin')).toBeVisible();
  await expect(rijen(page)).toHaveText(['Via terugknop']);
});

/* ---------------- lijst: eerste regel ---------------- */

test('preview uses the first non-empty line, cuts very long lines, handles RTL, and never renders HTML', async ({ page }) => {
  await open(page);
  const lang = 'L'.repeat(500);
  await zaai(page, [
    '\n\n   \n  Tweede regel echt  \nderde',
    lang,
    'مرحبا بالعالم\nسطر ثان',
    '<img src=x onerror="window.__xss=1"><b>vet</b>',
  ]);
  await expect(rijen(page)).toHaveCount(4);
  await expect(rijen(page).nth(0)).toHaveText('Tweede regel echt');
  const r1 = rijen(page).nth(1);
  const maten = await r1.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, len: el.textContent.length, ov: getComputedStyle(el).textOverflow }));
  expect(maten.sw).toBeGreaterThan(maten.cw);
  expect(maten.ov).toBe('ellipsis');
  expect(maten.len).toBeLessThanOrEqual(201);
  const span = rijen(page).nth(2).locator('span');
  await expect(span).toHaveAttribute('dir', 'auto');
  expect(await span.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  await expect(rijen(page).nth(3)).toHaveText('<img src=x onerror="window.__xss=1"><b>vet</b>');
  expect(await page.locator('#lijst img, #lijst b').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // ook in het blaadje zelf blijft het gewone tekst
  await rijen(page).nth(3).click();
  await expect(page.locator('#tekst')).toHaveValue('<img src=x onerror="window.__xss=1"><b>vet</b>');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('150 notes: the list scrolls and the last one is reachable, the page itself does not scroll', async ({ page }) => {
  await open(page);
  const n = Array.from({ length: 150 }, (_, i) => 'Notitie ' + (i + 1));
  await zaai(page, n);
  await expect(rijen(page)).toHaveCount(150);
  const vak = page.locator('#lijstvak');
  expect(await vak.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await vak.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(rijen(page).last()).toHaveText('Notitie 150');
  await expect(rijen(page).last()).toBeInViewport();
  await rijen(page).last().click();
  await expect(page.locator('#tekst')).toHaveValue('Notitie 150');
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
});

test('a very long note opens, scrolls and saves', async ({ page }) => {
  await open(page);
  const lang = Array.from({ length: 400 }, (_, i) => 'Regel ' + (i + 1) + ' ' + 'x'.repeat(40)).join('\n');
  await zaai(page, [lang]);
  await rijen(page).first().click();
  const ta = page.locator('#tekst');
  await expect(ta).toHaveValue(lang);
  expect(await ta.evaluate((el) => el.scrollHeight > el.clientHeight * 5)).toBe(true);
  // de cursor staat aan het eind en dat stuk is in beeld
  expect(await ta.evaluate((el) => el.scrollTop > 0)).toBe(true);
  await page.keyboard.type('\nslot');
  await terug(page);
  const t = await page.evaluate(() => JSON.parse(localStorage.getItem('notitieboekje.n.z0000')).t);
  expect(t.endsWith('\nslot')).toBe(true);
  expect(t.length).toBe(lang.length + 5);
});

/* ---------------- uitscheuren ---------------- */

test('swipe a note away to tear it out, and undo brings it back', async ({ page }, testInfo) => {
  await open(page);
  await zaai(page, ['Boven', 'Midden', 'Onder']);
  await expect(rijen(page)).toHaveCount(3);
  const li = page.locator('#lijst li').nth(1);
  const box = await li.boundingBox();
  await veeg(page, li, box.width * 0.6, testInfo);
  await expect(rijen(page)).toHaveText(['Boven', 'Onder']);
  await expect(page.locator('#strookje')).toHaveClass(/zichtbaar/);
  await expect(page.locator('#strookjeTekst')).toHaveText('Page torn out');
  expect(await opgeslagen(page)).toBe(2);
  await page.locator('#ongedaan').click();
  await expect(rijen(page)).toHaveText(['Boven', 'Midden', 'Onder']);
  expect(await opgeslagen(page)).toBe(3);
  await expect(page.locator('#strookje')).not.toHaveClass(/zichtbaar/);
  // naar links vegen kan ook
  await veeg(page, page.locator('#lijst li').first(), -box.width * 0.6, testInfo);
  await expect(rijen(page)).toHaveText(['Midden', 'Onder']);
});

test('a short swipe or a vertical move does not tear anything; a tap still opens', async ({ page }, testInfo) => {
  await open(page);
  await zaai(page, ['Blijft staan', 'Ook']);
  const li = page.locator('#lijst li').first();
  const box = await li.boundingBox();
  await veeg(page, li, box.width * 0.15, testInfo);
  await expect(rijen(page)).toHaveCount(2);
  await expect(page.locator('#blad')).toBeHidden();
  await expect(page.locator('#strookje')).not.toHaveClass(/zichtbaar/);
  // een verticale beweging (scrollen) scheurt niets uit
  const y0 = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  if (isMobiel(testInfo)) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 3, y: y0 + i * 12 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 20, y0 + 90, { steps: 8 });
    await page.mouse.up();
  }
  await expect(rijen(page)).toHaveCount(2);
  await expect(page.locator('#strookje')).not.toHaveClass(/zichtbaar/);
  await expect(page.locator('#blad')).toBeHidden();
  await page.waitForTimeout(150);   // zo snel na een veeg tikt geen mens
  await rijen(page).first().click();
  await expect(page.locator('#tekst')).toHaveValue('Blijft staan');
});

test('the undo strip disappears after about five seconds and the page stays gone', async ({ page }, testInfo) => {
  await open(page);
  await zaai(page, ['Weg ermee', 'Blijft']);
  const li = page.locator('#lijst li').first();
  const box = await li.boundingBox();
  await veeg(page, li, box.width * 0.6, testInfo);
  await expect(page.locator('#strookje')).toHaveClass(/zichtbaar/);
  await page.waitForTimeout(4000);
  await expect(page.locator('#strookje')).toHaveClass(/zichtbaar/);
  await expect(page.locator('#strookje')).not.toHaveClass(/zichtbaar/, { timeout: 2500 });
  await page.reload();
  await expect(rijen(page)).toHaveText(['Blijft']);
});

test('keyboard: Delete on a focused page tears it out, focus moves on, Ctrl+Z undoes', async ({ page }) => {
  await open(page);
  await zaai(page, ['Een', 'Twee', 'Drie']);
  await rijen(page).nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rijen(page).nth(1)).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(rijen(page)).toHaveText(['Een', 'Drie']);
  await expect(rijen(page).nth(1)).toBeFocused();
  await expect(page.locator('#strookje')).toHaveClass(/zichtbaar/);
  await page.keyboard.press('Control+z');
  await expect(rijen(page)).toHaveText(['Een', 'Twee', 'Drie']);
  // de lijst vertelt schermlezers hoe het werkt
  await expect(page.locator('#lijst')).toHaveAttribute('aria-describedby', 'lijstHulp');
  await expect(page.locator('#lijstHulp')).toHaveText('Press Delete to tear out a page.');
});

test('a hidden "Tear out" button per page is reachable by keyboard and screen readers', async ({ page }) => {
  await open(page);
  await zaai(page, ['Alfa', 'Beta']);
  const knop = page.locator('#lijst li').first().locator('.scheur');
  await expect(knop).toHaveAccessibleName('Tear out: Alfa');
  expect(await knop.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await rijen(page).first().focus();
  await page.keyboard.press('Tab');
  await expect(knop).toBeFocused();
  expect(await knop.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await page.keyboard.press('Enter');
  await expect(rijen(page)).toHaveText(['Beta']);
  await expect(page.locator('#ongedaan')).toHaveText('Undo');
});

test('long-press (touch) or right-click shows the small "Tear out" action', async ({ page }, testInfo) => {
  await open(page);
  await zaai(page, ['Alfa', 'Beta']);
  const li = page.locator('#lijst li').first();
  if (isMobiel(testInfo)) await langDrukken(page, li.locator('.rij'));
  else await li.locator('.rij').click({ button: 'right' });
  await expect(li).toHaveClass(/gewapend/);
  await expect(page.locator('#blad')).toBeHidden();       // lang drukken opent het blaadje niet
  await li.locator('.scheur').click();
  await expect(rijen(page)).toHaveText(['Beta']);
});

/* ---------------- lijnen: tekst op de lijnen ---------------- */

test('text sits on the ruled lines: line-height equals the line spacing, rows follow the grid', async ({ page }) => {
  await open(page);
  await zaai(page, ['Een', 'Twee', 'Drie']);
  const lijst = await page.evaluate(() => {
    const vak = document.getElementById('lijstvak');
    const cs = getComputedStyle(vak);
    const lis = [...document.querySelectorAll('#lijst li')];
    return {
      lh: parseFloat(getComputedStyle(document.querySelector('#lijst .rij')).lineHeight),
      bg: parseFloat(cs.backgroundSize.split(' ')[1]),
      att: cs.backgroundAttachment,
      tops: lis.map((li) => li.offsetTop),
      h: lis.map((li) => li.getBoundingClientRect().height),
    };
  });
  expect(lijst.bg).toBeCloseTo(lijst.lh, 3);
  expect(lijst.att).toBe('local');
  lijst.h.forEach((h) => expect(h).toBeCloseTo(lijst.lh, 1));
  lijst.tops.forEach((top, i) => expect(top).toBeCloseTo(i * lijst.lh, 1));

  await rijen(page).first().click();
  const ta = page.locator('#tekst');
  await ta.fill('een\ntwee\ndrie\n' + 'lang woord '.repeat(40) + '\n' + Array.from({ length: 40 }, (_, i) => 'r' + i).join('\n'));
  const blad = await ta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    // waar valt de basislijn van dit lettertype in een regel?
    const proef = document.createElement('div');
    proef.className = 'tekst';
    proef.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;';
    const a = document.createElement('span'); a.textContent = 'Hxg';
    const b = document.createElement('span'); b.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline';
    proef.append(a, b); document.body.append(proef);
    const basislijn = b.getBoundingClientRect().top - proef.getBoundingClientRect().top;
    proef.remove();
    return {
      lh,
      bg: parseFloat(cs.backgroundSize.split(' ')[1]),
      att: cs.backgroundAttachment,
      padTop: parseFloat(cs.paddingTop),
      padBottom: parseFloat(cs.paddingBottom),
      ry: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ry')),
      basislijn,
      sh: el.scrollHeight,
    };
  });
  expect(blad.bg).toBeCloseTo(blad.lh, 3);
  expect(blad.att).toBe('local');
  expect(blad.padTop).toBe(0);
  // de lijn ligt net onder de basislijn (0 tot 3 px), dus de letters staan erop
  expect(blad.ry - blad.basislijn).toBeGreaterThanOrEqual(0);
  expect(blad.ry - blad.basislijn).toBeLessThanOrEqual(3);
  // ook afgebroken regels volgen het raster: de hoogte is een veelvoud van de regelhoogte
  const regels = (blad.sh - blad.padTop - blad.padBottom) / blad.lh;
  expect(Math.abs(regels - Math.round(regels))).toBeLessThan(0.05);
  expect(Math.round(regels)).toBeGreaterThan(44);   // 44 harde regels + minstens 1 afgebroken
});

test('text stays on the lines when zoomed (bigger root font size)', async ({ page }) => {
  await open(page);
  // grotere standaardletter (zoals een gebruiker die zijn tekst groter zet), via CSSOM
  await page.evaluate(() => { document.documentElement.style.fontSize = '22px'; window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(300);
  await nieuwBlad(page, 'Groter');
  const r = await page.locator('#tekst').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { lh: parseFloat(cs.lineHeight), bg: parseFloat(cs.backgroundSize.split(' ')[1]), ry: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ry')) };
  });
  expect(r.lh).toBeCloseTo(22 * 1.75, 1);
  expect(r.bg).toBeCloseTo(r.lh, 3);
  expect(r.ry).toBeGreaterThan(r.lh * 0.55);
  expect(r.ry).toBeLessThan(r.lh);
});

/* ---------------- talen ---------------- */

test('language switch changes the UI, sets RTL for Arabic, and is remembered', async ({ page }) => {
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#plus')).toHaveAttribute('aria-label', 'New page');
  await expect(page.locator('#taal option')).toHaveCount(23);
  await page.locator('#taal').selectOption('nl');
  await expect(page.locator('#plus')).toHaveAttribute('aria-label', 'Nieuw blaadje');
  await expect(page.locator('#leeg')).toHaveText('Nog geen blaadjes. Tik op + en begin te schrijven.');
  await expect(page.locator('#doneerKnop')).toHaveText('Doneer');
  await page.locator('#taal').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('#plus')).toHaveAttribute('aria-label', 'صفحة جديدة');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#taal')).toHaveValue('ar');
  // in RTL staat de plus links en de titel rechts
  const titel = await page.locator('#titel').boundingBox();
  const plus = await page.locator('#plus').boundingBox();
  expect(plus.x).toBeLessThan(titel.x);
  await page.locator('#taal').selectOption('zgh');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#leeg')).toContainText('ⵜⴰⵙⵏⴰ');
  // de Tifinagh-letter komt uit ons eigen lettertype (geen extern verzoek)
  await page.waitForFunction(() => document.fonts.check('16px "Noto Sans Tifinagh"', 'ⵜ'));
});

test('language is detected from the browser', async ({ browser, baseURL }) => {
  for (const [locale, verwacht] of [['fr-BE', 'Nouvelle page'], ['ur-PK', 'نیا صفحہ'], ['pt-BR', 'Página nova'], ['xx-YY', 'New page']]) {
    const ctx = await browser.newContext({ locale, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(baseURL + '/');
    await expect(p.locator('#plus')).toHaveAttribute('aria-label', verwacht);
    await ctx.close();
  }
});

test('all 23 languages render without missing texts and without horizontal overflow', async ({ page }) => {
  await open(page);
  await zaai(page, ['Een blaadje']);
  const codes = await page.locator('#taal option').evaluateAll((o) => o.map((x) => x.value));
  expect(codes).toHaveLength(23);
  for (const code of codes) {
    await page.locator('#taal').selectOption(code);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    const r = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      voet: (() => { const v = document.getElementById('voet'); return v.scrollWidth - v.clientWidth; })(),
      labels: [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')),
      doneer: document.getElementById('doneerKnop').textContent,
    }));
    expect(r.overflow, code).toBe(false);
    expect(r.voet, code + ' footer overflows').toBeLessThanOrEqual(1);
    expect(r.doneer.length).toBeGreaterThan(1);
    for (const l of r.labels) expect(l, code).not.toMatch(/^[a-z]+(\.[a-z]+)+$/);   // geen ruwe sleutels
  }
});

/* ---------------- voet: doneren, versie, verversen ---------------- */

test('footer: donate panel with PayPal links, version stamp and refresh', async ({ page }) => {
  await open(page);
  await expect(page.locator('#versie')).toHaveText('vtest1');
  await expect(page.locator('#doneerPaneel')).toBeHidden();
  await page.locator('#doneerKnop').click();
  await expect(page.locator('#doneerPaneel')).toBeVisible();
  await expect(page.locator('#doneerKnop')).toHaveAttribute('aria-expanded', 'true');
  const links = await page.locator('#doneerPaneel a').evaluateAll((a) => a.map((x) => x.href));
  expect(links).toEqual([
    'https://www.paypal.com/paypalme/ABoulbahaiem/1EUR',
    'https://www.paypal.com/paypalme/ABoulbahaiem/2EUR',
    'https://www.paypal.com/paypalme/ABoulbahaiem/5EUR',
    'https://www.paypal.com/paypalme/ABoulbahaiem/20EUR',
    'https://www.paypal.com/paypalme/ABoulbahaiem/50EUR',
    'https://www.paypal.com/paypalme/ABoulbahaiem',
  ]);
  await expect(page.locator('#doneerPaneel')).toContainText('Glad you use Notitieboekje!');
  await page.keyboard.press('Escape');
  await expect(page.locator('#doneerPaneel')).toBeHidden();
});

test('refresh button installs a newly deployed version immediately', async ({ page, request }) => {
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
  await expect(page.locator('#versie')).toHaveText('vtest1');
  await nieuwBlad(page, 'Blijft bewaard bij het verversen');
  await terug(page);
  try {
    await request.get('/__stamp?v=test2');
    await Promise.all([
      page.waitForEvent('load', { timeout: 15000 }),
      page.locator('#ververs').click(),
    ]);
    await expect(page.locator('#versie')).toHaveText('vtest2', { timeout: 10000 });
    await expect(rijen(page)).toHaveText(['Blijft bewaard bij het verversen']);
    const caches = await page.evaluate(() => caches.keys());
    expect(caches).toEqual(['notitieboekje-test2']);
  } finally {
    await request.get('/__stamp?v=test1');
  }
});

// Laat de app naar een nieuwe versie zoeken zoals bij terugkeren naar de app.
const zoekNieuweVersie = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('a new version on the home page is picked up by itself (no click)', async ({ page, request }) => {
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
  await nieuwBlad(page, 'Blijft staan na de update');
  await terug(page);
  await expect(page.locator('#versie')).toHaveText('vtest1');
  try {
    await request.get('/__stamp?v=test2');
    await Promise.all([
      page.waitForEvent('load', { timeout: 15000 }),
      zoekNieuweVersie(page),
    ]);
    await expect(page.locator('#versie')).toHaveText('vtest2', { timeout: 10000 });
    await expect(rijen(page)).toHaveText(['Blijft staan na de update']);
    // en geen herlaadlus: de nieuwe versie blijft gewoon staan
    await page.evaluate(() => { window.__nogHier = 1; });
    await zoekNieuweVersie(page);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.__nogHier)).toBe(1);
  } finally {
    await request.get('/__stamp?v=test1');
  }
});

test('with a page open, a new version waits: no reload while typing, reload after going back', async ({ page, request }) => {
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
  await nieuwBlad(page, 'Ik schrijf');
  try {
    await request.get('/__stamp?v=test2');
    await zoekNieuweVersie(page);
    await page.waitForFunction(() => window.notitieboekje.updateKlaar === true, null, { timeout: 15000 });
    await page.evaluate(() => { window.__nogHier = 1; });
    await page.keyboard.type(' gewoon verder');
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.__nogHier)).toBe(1);
    await expect(page.locator('#tekst')).toHaveValue('Ik schrijf gewoon verder');
    await expect(page.locator('#versie')).toHaveText('vtest1');
    await Promise.all([
      page.waitForEvent('load', { timeout: 15000 }),
      page.locator('#terug').click(),
    ]);
    await expect(page.locator('#versie')).toHaveText('vtest2', { timeout: 10000 });
    await expect(rijen(page)).toHaveText(['Ik schrijf gewoon verder']);
  } finally {
    await request.get('/__stamp?v=test1');
  }
});

test('with a page open, a new version reloads when the app is hidden, after saving', async ({ page, request }) => {
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
  await nieuwBlad(page, 'Net voor het wegleggen');
  try {
    await request.get('/__stamp?v=test2');
    await zoekNieuweVersie(page);
    await page.waitForFunction(() => window.notitieboekje.updateKlaar === true, null, { timeout: 15000 });
    await Promise.all([
      page.waitForEvent('load', { timeout: 15000 }),
      page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }),
    ]);
    await expect(page.locator('#versie')).toHaveText('vtest2', { timeout: 10000 });
    await expect(rijen(page)).toHaveText(['Net voor het wegleggen']);
  } finally {
    await request.get('/__stamp?v=test1');
  }
});

/* ---------------- op het beginscherm zetten ---------------- */

async function nepInstallEvent(page) {
  return page.evaluate(() => {
    window.__prompt = window.__prompt || 0;
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompt++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
}

test('install note (Android): a note on the pad with an Install button; closing keeps it away', async ({ page }, testInfo) => {
  await open(page);
  expect(await nepInstallEvent(page)).toBe(true);
  const briefje = page.locator('#installeer');
  if (!isMobiel(testInfo)) {
    await expect(briefje).toBeHidden();           // nooit op de desktop
    return;
  }
  await expect(briefje).toBeVisible();
  await expect(page.locator('#installTitel')).toHaveText('Put the notebook on your phone');
  await expect(page.locator('#installKnop')).toHaveText('Install');
  await expect(page.locator('#installUitleg')).toBeHidden();
  await page.locator('#taal').selectOption('nl');
  await expect(page.locator('#installTitel')).toHaveText('Zet het boekje op je gsm');
  await expect(page.locator('#installKnop')).toHaveText('Installeren');
  await expect(page.locator('#installDicht')).toHaveAttribute('aria-label', 'Sluiten');
  // alleen op de beginpagina
  await nieuwBlad(page);
  await expect(briefje).toBeHidden();
  await terug(page);
  await expect(briefje).toBeVisible();
  // de onderste blaadjes blijven bereikbaar boven het briefje
  expect(await page.locator('#lijstvak').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThan(40);
  await page.locator('#installKnop').click();
  expect(await page.evaluate(() => window.__prompt)).toBe(1);
  await expect(briefje).toBeHidden();
  // volgende keer weer (niet gesloten), tot je op x tikt: dan 14 dagen niet
  await page.reload();
  await nepInstallEvent(page);
  await expect(briefje).toBeVisible();
  await page.locator('#installDicht').click();
  await expect(briefje).toBeHidden();
  const t0 = Number(await page.evaluate(() => localStorage.getItem('notitieboekje.install.dicht')));
  expect(Math.abs(Date.now() - t0)).toBeLessThan(60000);
  await page.reload();
  await nepInstallEvent(page);
  await expect(briefje).toBeHidden();
  // na 15 dagen mag het weer
  await page.evaluate(() => localStorage.setItem('notitieboekje.install.dicht', String(Date.now() - 15 * 864e5)));
  await page.reload();
  await nepInstallEvent(page);
  await expect(briefje).toBeVisible();
});

test('install note: iOS Safari explains Share, iOS Chrome points to Safari, never when installed', async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'eigen contexten; één keer is genoeg');
  const telefoon = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'nl-BE' };
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const chromeIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1';

  let ctx = await browser.newContext({ ...telefoon, userAgent: safari });
  let p = await ctx.newPage();
  await p.goto(baseURL + '/');
  await expect(p.locator('#installeer')).toBeVisible();
  await expect(p.locator('#installTitel')).toHaveText('Zet het boekje op je gsm');
  await expect(p.locator('#installUitleg')).toHaveText('Tik op  en dan op ‘Zet op beginscherm’.');
  await expect(p.locator('#installUitleg svg[aria-label="Delen"]')).toHaveCount(1);
  await expect(p.locator('#installKnop')).toBeHidden();
  await p.locator('#taal').selectOption('en');
  await expect(p.locator('#installUitleg')).toHaveText('Tap  and then “Add to Home Screen”.');
  await ctx.close();

  ctx = await browser.newContext({ ...telefoon, userAgent: chromeIOS });
  p = await ctx.newPage();
  await p.goto(baseURL + '/');
  await expect(p.locator('#installUitleg')).toContainText('Open deze pagina in Safari.');
  await ctx.close();

  // al geïnstalleerd (iOS: navigator.standalone)
  ctx = await browser.newContext({ ...telefoon, userAgent: safari });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  p = await ctx.newPage();
  await p.goto(baseURL + '/');
  await expect(p.locator('#titel')).toBeVisible();
  await expect(p.locator('#installeer')).toBeHidden();
  await ctx.close();

  // al geïnstalleerd (Android: display-mode standalone)
  ctx = await browser.newContext(telefoon);
  await ctx.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => (String(q).includes('display-mode: standalone')
      ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
      : orig(q));
  });
  p = await ctx.newPage();
  await p.goto(baseURL + '/');
  await nepInstallEvent(p);
  await expect(p.locator('#installeer')).toBeHidden();
  await ctx.close();
});

/* ---------------- meer: exporteren en importeren ---------------- */

const { maakMemo, VOORBEELD, T } = require('./memo-maker');
const alleOpgeslagen = (page) => page.evaluate(() => Object.keys(localStorage)
  .filter((k) => k.startsWith('notitieboekje.n.'))
  .map((k) => JSON.parse(localStorage.getItem(k)))
  .sort((a, b) => b.u - a.u));
async function kiesUitMenu(page, id) {
  await page.locator('#meerKnop').click();
  await expect(page.locator('#meerMenu')).toBeVisible();
  await page.locator('#' + id).click();
}
async function importeer(page, naam, buffer, mimeType = 'application/octet-stream') {
  const [kiezer] = await Promise.all([page.waitForEvent('filechooser'), kiesUitMenu(page, 'importKnop')]);
  await kiezer.setFiles({ name: naam, mimeType, buffer });
}
async function exporteerAlsDownload(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), kiesUitMenu(page, 'exportKnop')]);
  const pad = await dl.path();
  return { naam: dl.suggestedFilename(), data: JSON.parse(require('fs').readFileSync(pad, 'utf8')) };
}
const zonderDelen = () => { try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch {} navigator.share = undefined; navigator.canShare = undefined; };

test('export: a JSON file with all pages (download when sharing files is not possible)', async ({ page }) => {
  await page.addInitScript(zonderDelen);
  await open(page);
  await zaai(page, ['Eerste\nmet twee regels', 'Tweede 🎉', 'مرحبا']);
  const { naam, data } = await exporteerAlsDownload(page);
  expect(naam).toMatch(/^notitieboekje-\d{4}-\d{2}-\d{2}\.json$/);
  expect(data.format).toBe('notitieboekje');
  expect(data.version).toBe(1);
  expect(Math.abs(Date.parse(data.exported) - Date.now())).toBeLessThan(60000);
  const opgeslagen = await alleOpgeslagen(page);
  expect(data.notes.map((n) => [n.text, n.created, n.updated])).toEqual(opgeslagen.map((n) => [n.t, n.c, n.u]));
  expect(data.notes.every((n) => /^z\d{4}$/.test(n.id))).toBe(true);
  await expect(page.locator('#meerMenu')).toBeHidden();
});

test('export uses the share sheet when the device can share files', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => { window.__gedeeld = { naam: d.files[0].name, type: d.files[0].type, tekst: await d.files[0].text() }; };
  });
  await open(page);
  await zaai(page, ['Gedeeld blaadje']);
  await kiesUitMenu(page, 'exportKnop');
  await page.waitForFunction(() => window.__gedeeld);
  const g = await page.evaluate(() => window.__gedeeld);
  expect(g.naam).toMatch(/^notitieboekje-\d{4}-\d{2}-\d{2}\.json$/);
  expect(g.type).toBe('application/json');
  expect(JSON.parse(g.tekst).notes.map((n) => n.text)).toEqual(['Gedeeld blaadje']);
});

test('export with no pages says so', async ({ page }) => {
  await open(page);
  await kiesUitMenu(page, 'exportKnop');
  await expect(page.locator('#melding')).toHaveText('No pages to export yet.');
});

test('import our own export into an empty notebook gives identical pages; twice adds nothing', async ({ page, browser, baseURL }) => {
  await page.addInitScript(zonderDelen);
  await open(page);
  await zaai(page, ['Eerste\nmet twee regels', 'Tweede 🎉', 'مرحبا']);
  const { data } = await exporteerAlsDownload(page);
  const origineel = await alleOpgeslagen(page);

  const ctx = await browser.newContext({ reducedMotion: 'reduce', locale: 'nl-BE' });
  const p = await ctx.newPage();
  await p.goto(baseURL + '/');
  await importeer(p, 'notitieboekje-2026-09-30.json', Buffer.from(JSON.stringify(data, null, 2)), 'application/json');
  await expect(p.locator('#melding')).toHaveText('3 blaadjes toegevoegd');
  await expect(p.locator('#melding')).toHaveClass(/info/);
  await expect(p.locator('#lijst li .rij')).toHaveText(['Eerste', 'Tweede 🎉', 'مرحبا']);
  expect((await alleOpgeslagen(p)).map((n) => [n.t, n.c, n.u])).toEqual(origineel.map((n) => [n.t, n.c, n.u]));
  // nog eens: niets nieuws, niets overschreven
  await importeer(p, 'notitieboekje-2026-09-30.json', Buffer.from(JSON.stringify(data)), 'application/json');
  await expect(p.locator('#melding')).toHaveText('0 blaadjes toegevoegd, 3 stonden er al');
  expect(await opgeslagen(p)).toBe(3);
  await ctx.close();
});

test('import a MEMOBK2 backup (synthetic): right count, texts, timestamps and order', async ({ page }) => {
  await open(page);
  await zaai(page, ['Al aanwezig']);
  await importeer(page, '2026-09-30 15.16.40.500-3F2504E0-4F89-41D3-9A0C-0305E82C3301.memo', maakMemo(VOORBEELD));
  // te houden: 8 records (1 leeg, 1 dubbel binnen het bestand); als verwijderd gemarkeerd: 2 (+1 leeg)
  await expect(page.locator('#melding')).toHaveText('6 pages added, 1 was already there, 2 deleted pages skipped');
  const n = await alleOpgeslagen(page);
  expect(n).toHaveLength(7);
  expect(n.some((x) => x.t.startsWith('Verwijderd'))).toBe(false);
  const perTekst = Object.fromEntries(n.map((x) => [x.t, x]));
  expect(perTekst['Boodschappen\nmelk\nbrood']).toMatchObject({ c: T.boodschappen, u: T.boodschappen });
  expect(perTekst['Tandarts vrijdag 10u']).toMatchObject({ c: T.tandarts, u: T.tandartsGewijzigd });
  expect(perTekst['Rare datum, wel een wijzigtijd']).toMatchObject({ c: T.raar, u: T.raar });
  expect(perTekst['🎉 Feestje 👨‍👩‍👧 zaterdag']).toBeTruthy();
  expect(perTekst['Café crème, ½ liter, € 3,50']).toBeTruthy();
  // de lijst volgt de wijzigtijd: het bestaande blaadje (net gemaakt) bovenaan, het oudste onderaan
  await expect(rijen(page)).toHaveText([
    'Al aanwezig',
    'Boodschappen',
    'مرحبا بالعالم',
    '🎉 Feestje 👨‍👩‍👧 zaterdag',
    'Café crème, ½ liter, € 3,50',
    'Tandarts vrijdag 10u',
    'Rare datum, wel een wijzigtijd',
  ]);
  expect(await rijen(page).nth(2).locator('span').evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  // plural in het Pools: 7 = "many", 2..4 = "few"
  await page.locator('#taal').selectOption('pl');
  await importeer(page, 'b.memo', maakMemo([{ text: 'Nowa jeden', a: T.tandarts }, { text: 'Nowa dwa', a: T.tandarts + 1 }]));
  await expect(page.locator('#melding')).toHaveText('2 kartki dodane');
  await page.locator('#taal').selectOption('nl');
  await importeer(page, 'c.memo', maakMemo([{ text: 'Weg', a: -T.weg1 }, { text: 'Nieuw', a: T.tandarts }]));
  await expect(page.locator('#melding')).toHaveText('1 blaadje toegevoegd, 1 verwijderd blaadje overgeslagen');
});

test('a corrupt file shows an error and imports nothing', async ({ page }) => {
  await open(page);
  await zaai(page, ['Blijft zoals het was']);
  const goed = maakMemo(VOORBEELD);
  await importeer(page, 'kapot.memo', goed.subarray(0, goed.length - 60));
  await expect(page.locator('#melding')).toHaveText('I can’t read this file.');
  await expect(page.locator('#melding')).not.toHaveClass(/info/);
  expect(await opgeslagen(page)).toBe(1);
  await importeer(page, 'kapot.json', Buffer.from('{"format":"notitieboekje","notes":['), 'application/json');
  await expect(page.locator('#melding')).toHaveText('I can’t read this file.');
  await importeer(page, 'foto.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]));
  await expect(page.locator('#melding')).toHaveText('I can’t read this file.');
  expect(await opgeslagen(page)).toBe(1);
  await expect(rijen(page)).toHaveText(['Blijft zoals het was']);
});

test('import a plain .txt file as one page', async ({ page }) => {
  await open(page);
  await importeer(page, 'lijstje.txt', Buffer.from('Lijstje voor de markt\nappels\nperen\n'), 'text/plain');
  await expect(page.locator('#melding')).toHaveText('1 page added');
  await expect(rijen(page)).toHaveText(['Lijstje voor de markt']);
  await rijen(page).first().click();
  await expect(page.locator('#tekst')).toHaveValue('Lijstje voor de markt\nappels\nperen');
});

test('the ⋯ menu: keyboard, Escape returns focus, closes on outside tap, fits small screens', async ({ page }, testInfo) => {
  await open(page);
  const knop = page.locator('#meerKnop');
  const menu = page.locator('#meerMenu');
  await expect(knop).toHaveAttribute('aria-label', 'More');
  await expect(knop).toHaveAttribute('aria-haspopup', 'menu');
  await knop.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(knop).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#exportKnop')).toBeFocused();
  await expect(page.getByRole('menuitem')).toHaveText(['Export', 'Import', 'Erase everything']);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#importKnop')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#wisKnop')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#exportKnop')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(knop).toBeFocused();
  await expect(knop).toHaveAttribute('aria-expanded', 'false');
  // buiten het menu tikken sluit het; doneren en menu staan nooit tegelijk open
  await knop.click();
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await page.locator('#doneerKnop').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#doneerPaneel')).toBeVisible();
  await knop.click();
  await expect(page.locator('#doneerPaneel')).toBeHidden();
  await page.locator('#titel').click();
  await expect(menu).toBeHidden();
  // vertaald
  await page.locator('#taal').selectOption('nl');
  await expect(knop).toHaveAttribute('aria-label', 'Meer');
  await knop.click();
  await expect(page.getByRole('menuitem')).toHaveText(['Exporteren', 'Importeren', 'Alles wissen']);
  if (isMobiel(testInfo)) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

/* ---------------- alles wissen ---------------- */

test('erase everything: Cancel (default) keeps all, Escape too; confirming wipes notes but keeps settings', async ({ page }) => {
  await open(page);
  await zaai(page, ['Een', 'Twee', 'Drie']);
  await page.evaluate(() => {
    localStorage.setItem('notitieboekje.lang', 'nl');
    localStorage.setItem('notitieboekje.install.dicht', String(Date.now()));
  });
  await page.reload();
  const slip = page.locator('#bevestig');
  await kiesUitMenu(page, 'wisKnop');
  await expect(slip).toBeVisible();
  await expect(slip).toHaveAttribute('role', 'alertdialog');
  await expect(page.locator('#bevestigTitel')).toHaveText('Alles wissen?');
  await expect(page.locator('#bevestigTekst')).toHaveText('Dit kan niet ongedaan worden. Exporteer eerst als je iets wilt bewaren.');
  await expect(page.locator('#wisNee')).toBeFocused();
  await expect(page.locator('#wisNee')).toHaveText('Annuleren');
  await expect(page.locator('#wisJa')).toHaveText('Wis alles');
  // Enter op de standaardknop = annuleren
  await page.keyboard.press('Enter');
  await expect(slip).toBeHidden();
  await expect(page.locator('#meerKnop')).toBeFocused();
  expect(await opgeslagen(page)).toBe(3);
  // Escape = annuleren; Tab blijft op het briefje
  await kiesUitMenu(page, 'wisKnop');
  await page.keyboard.press('Tab');
  await expect(page.locator('#wisJa')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#wisExport')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#wisNee')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(slip).toBeHidden();
  expect(await opgeslagen(page)).toBe(3);
  // naast het briefje tikken = annuleren
  await kiesUitMenu(page, 'wisKnop');
  await page.locator('#titel').click();
  await expect(slip).toBeHidden();
  expect(await opgeslagen(page)).toBe(3);
  // bevestigen
  await kiesUitMenu(page, 'wisKnop');
  await page.locator('#wisJa').click();
  await expect(slip).toBeHidden();
  await expect(rijen(page)).toHaveCount(0);
  await expect(page.locator('#leeg')).toBeVisible();
  await expect(page.locator('#melding')).toHaveText('Notitieboekje gewist');
  expect(await opgeslagen(page)).toBe(0);
  const inst = await page.evaluate(() => [localStorage.getItem('notitieboekje.lang'), localStorage.getItem('notitieboekje.install.dicht')]);
  expect(inst[0]).toBe('nl');
  expect(inst[1]).toBeTruthy();
  await page.reload();
  await expect(rijen(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
});

test('erase everything: "Export first" exports, and another tab empties too', async ({ page, context }) => {
  await page.addInitScript(zonderDelen);
  await open(page);
  await zaai(page, ['Een', 'Twee']);
  const b = await context.newPage();
  await b.goto('/');
  await expect(rijen(b)).toHaveCount(2);
  await kiesUitMenu(page, 'wisKnop');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#wisExport').click()]);
  const data = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  expect(data.notes.map((n) => n.text).sort()).toEqual(['Een', 'Twee']);
  await expect(page.locator('#bevestig')).toBeVisible();     // na exporteren kan je nog kiezen
  await page.locator('#wisJa').click();
  await expect(rijen(page)).toHaveCount(0);
  await expect(rijen(b)).toHaveCount(0);
  await expect(b.locator('#leeg')).toBeVisible();
  await b.close();
});

/* ---------------- offline, opslag en randgevallen ---------------- */

test('works fully offline after the first visit (service worker)', async ({ page, context }) => {
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
  await context.setOffline(true);
  try {
    const res = await page.reload();
    expect(res.fromServiceWorker()).toBe(true);
    await expect(page.locator('#titel')).toHaveText('Notitieboekje');
    await nieuwBlad(page, 'Offline geschreven');
    await terug(page);
    await page.reload();
    await expect(rijen(page)).toHaveText(['Offline geschreven']);
    await expect(page.locator('#versie')).toHaveText('vtest1');
  } finally {
    await context.setOffline(false);
  }
});

test('two tabs: the list follows the other tab, and an open page is not overwritten', async ({ page, context }) => {
  await open(page);
  const b = await context.newPage();
  await b.goto('/');
  await nieuwBlad(b, 'Uit tab B');
  await terug(b);
  await expect(rijen(page)).toHaveText(['Uit tab B']);
  // A opent het blaadje en typt; B wijzigt hetzelfde blaadje intussen
  await rijen(page).first().click();
  await page.keyboard.type(' plus A');
  await rijen(b).first().click();
  await b.keyboard.type(' plus B');
  await terug(b);
  await expect(page.locator('#tekst')).toHaveValue('Uit tab B plus A');
  await page.keyboard.type('!');
  await terug(page);
  // per blaadje wint wie het laatst bewaart; de tekst in A ging niet verloren
  await expect(rijen(page)).toHaveText(['Uit tab B plus A!']);
  await expect(rijen(b)).toHaveText(['Uit tab B plus A!']);
  // uitscheuren in A verdwijnt ook uit de lijst in B
  await page.locator('#lijst li .rij').first().focus();
  await page.keyboard.press('Delete');
  await expect(rijen(b)).toHaveCount(0);
  await b.close();
});

test('without localStorage (private mode) the app still works in memory and says so', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await open(page);
  await expect(page.locator('#melding')).toHaveText('Saving is not possible here (private window?). Your pages disappear when you close this window.');
  await nieuwBlad(page, 'Alleen in het geheugen');
  await terug(page);
  await expect(rijen(page)).toHaveText(['Alleen in het geheugen']);
  await page.locator('#taal').selectOption('nl');
  await expect(page.locator('#melding')).toContainText('Bewaren lukt hier niet');
});

test('storage full: a small message, and the open text is not lost', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('notitieboekje.n.') && String(v).length > 60) throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await open(page);
  await nieuwBlad(page, 'kort');
  await page.waitForTimeout(500);
  await page.keyboard.type(' en dan veel te lang voor de volle opslag hier');
  await expect(page.locator('#melding')).toHaveText('Your device is full. The last change was not saved.');
  await expect(page.locator('#tekst')).toHaveValue('kort en dan veel te lang voor de volle opslag hier');
});

test('asks once for persistent storage when the first note is saved', async ({ page }) => {
  await page.addInitScript(() => {
    window.__persist = 0;
    if (navigator.storage) navigator.storage.persist = () => { window.__persist++; return Promise.resolve(true); };
  });
  await open(page);
  expect(await page.evaluate(() => window.__persist)).toBe(0);
  await nieuwBlad(page, 'eerste');
  await terug(page);
  await nieuwBlad(page, 'tweede');
  await terug(page);
  expect(await page.evaluate(() => window.__persist)).toBe(1);
  await page.reload();
  await nieuwBlad(page, 'derde');
  await terug(page);
  expect(await page.evaluate(() => window.__persist)).toBe(0);
});

/* ---------------- uitzicht ---------------- */

test('layout: no horizontal overflow, pad fits the screen, pocket size on desktop', async ({ page }, testInfo) => {
  await open(page);
  await zaai(page, ['Een heel lange eerste regel die zeker niet op één regel past op een smalle telefoon', 'Twee']);
  const r = await page.evaluate(() => {
    const b = document.getElementById('blok').getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, b: { x: b.x, w: b.width, r: b.right, h: b.height, bottom: b.bottom }, vw: innerWidth, vh: innerHeight };
  });
  expect(r.sw).toBeLessThanOrEqual(r.cw);
  expect(r.b.r).toBeLessThanOrEqual(r.vw);
  expect(r.b.bottom).toBeLessThanOrEqual(r.vh);
  if (isMobiel(testInfo)) {
    // het blokje vult de breedte met een kleine marge
    expect(r.b.x).toBeGreaterThanOrEqual(8);
    expect(r.b.x).toBeLessThanOrEqual(16);
  } else {
    expect(r.b.w).toBeLessThan(420);
    expect(Math.abs(r.b.x + r.b.w / 2 - r.vw / 2)).toBeLessThan(2);
  }
  await rijen(page).first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('page flip animation over the top, and none with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page);
  await page.locator('#plus').click();
  const anim = await page.evaluate(() => document.getElementById('begin').getAnimations().map((a) => a.effect.getKeyframes().map((k) => k.transform)));
  expect(anim.length).toBe(1);
  expect(anim[0][0]).toContain('rotateX(0deg)');
  expect(anim[0][1]).toMatch(/rotateX\(\d+deg\)/);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('begin')).transformOrigin.split(' ')[1])).toBe('0px');
  await expect(page.locator('#begin')).toBeHidden();
  await page.keyboard.type('x');
  await page.locator('#terug').click();
  expect(await page.evaluate(() => document.getElementById('begin').getAnimations().length)).toBe(1);
  await expect(page.locator('#blad')).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#plus').click();
  expect(await page.evaluate(() => document.getElementById('begin').getAnimations().length)).toBe(0);
});

test('dark mode keeps the pad yellow and only darkens the desk', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  const k = await page.evaluate(() => ({
    papier: getComputedStyle(document.getElementById('begin')).backgroundColor,
    bureau: getComputedStyle(document.body).backgroundColor,
  }));
  const rgb = (s) => s.match(/\d+/g).map(Number);
  const [r, g, b] = rgb(k.papier);
  expect(r).toBeGreaterThan(200); expect(g).toBeGreaterThan(190); expect(b).toBeLessThan(170);   // geel
  const [br, bg, bb] = rgb(k.bureau);
  expect(br + bg + bb).toBeLessThan(150);   // donker bureau
});
