const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGEERROR', err && (err.stack || err.message || String(err))));
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/')) console.log('API', res.status(), url);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('captiva_token', 'dummy.token.value');
  });
  const res = await page.goto('https://captiva-risks.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('STATUS', res && res.status());
  await page.waitForTimeout(7000);
  console.log('URL_NOW', page.url());
  const text = await page.locator('body').innerText();
  console.log('BODY_TEXT_START');
  console.log(text.slice(0, 1500));
  console.log('BODY_TEXT_END');
  await browser.close();
})();
