#!/usr/bin/env node
// Schermafdrukken van Notitieboekje (telefoon en desktop, licht en donker).
// Start eerst de server: node tools/serve.mjs --port=8790
// Dan: node tools/shots.mjs [uitmap]   (standaard: screenshots/)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASIS = process.env.BASIS || 'http://localhost:8790';
const uit = path.resolve(process.argv[2] || 'screenshots');
fs.mkdirSync(uit, { recursive: true });
const chromiumPad = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const NOTITIES = {
  nl: [
    'Boodschappen\nmelk\nbrood\n2 citroenen\nkoffie (bonen!)',
    'Idee voor de verjaardag van mama: een fotoboek met oude foto\'s',
    'Garage bellen voor de APK\nvrijdag voor 10u',
    'Wifi-wachtwoord van de buren: vragen',
    'Boeken om te lezen\nDe avond is ongemak\nHet smelt',
  ],
  en: [
    'Groceries\nmilk\nbread\n2 lemons\ncoffee (beans!)',
    'Birthday idea for mum: a photo book with old pictures',
    'Call the garage about the car\nFriday before 10',
    'Ask the neighbours for the wifi password',
    'Books to read\nThe Hobbit\nPiranesi',
  ],
};

async function met(opties, naam, doe) {
  const browser = await chromium.launch(chromiumPad ? { executablePath: chromiumPad } : {});
  const ctx = await browser.newContext(opties);
  const page = await ctx.newPage();
  await doe(page);
  await browser.close();
}

async function vul(page, taal) {
  await page.goto(BASIS + '/');
  await page.evaluate(([n, taal]) => {
    const nu = Date.now();
    n.forEach((t, i) => localStorage.setItem('notitieboekje.n.demo' + i, JSON.stringify({ t, u: nu - i * 3600e3, c: nu - i * 3600e3 })));
    localStorage.setItem('notitieboekje.lang', taal);
    localStorage.setItem('notitieboekje.hint', '99');
  }, [NOTITIES[taal] || NOTITIES.en, taal]);
  await page.reload();
  await page.waitForSelector('#lijst li');
}

const varianten = [
  { naam: 'mobiel', opties: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  { naam: 'desktop', opties: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
];
const taal = process.env.TAAL || 'nl';
for (const v of varianten) {
  for (const schema of ['light', 'dark']) {
    const opties = { ...v.opties, colorScheme: schema, reducedMotion: 'reduce', locale: 'nl-BE' };
    await met(opties, v.naam, async (page) => {
      await vul(page, taal);
      await page.screenshot({ path: path.join(uit, `${v.naam}-${schema}-home.png`) });
      await page.locator('#lijst li .rij').first().click();
      await page.waitForSelector('#blad:not([hidden])');
      await page.keyboard.type('\nnog iets');
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(uit, `${v.naam}-${schema}-blad.png`) });
    });
  }
}
console.log('schermafdrukken in', uit);
