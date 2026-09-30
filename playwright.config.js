// Testconfig: een kleine statische server voor public/ (zoals Cloudflare die serveert),
// met __VERSION__ gestempeld als "test1" zodat de productiecode (service worker) meedraait.
const { defineConfig } = require('@playwright/test');
const fs = require('fs');

// Een voorgeïnstalleerde Chromium (CHROMIUM_PATH of /opt/pw-browsers/chromium) als die er is,
// anders de gewone Playwright-download (npx playwright install chromium).
const chromiumPad = process.env.CHROMIUM_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8791;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:' + PORT,
    launchOptions: chromiumPad ? { executablePath: chromiumPad } : {},
    reducedMotion: 'reduce',
    locale: 'en-GB',
  },
  webServer: {
    command: 'node tools/serve.mjs --port=' + PORT + ' --stamp=test1 --test',
    url: 'http://localhost:' + PORT,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    { name: 'static', testMatch: /static\.spec\.js/ },
    { name: 'desktop', testMatch: /e2e\.spec\.js/, use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-360', testMatch: /e2e\.spec\.js/, use: { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true } },
    { name: 'mobile-390', testMatch: /e2e\.spec\.js/, use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
});
