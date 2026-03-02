const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => console.log('[console]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err && err.stack || String(err)));
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText));
  const res = await page.goto('https://captiva-risks.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('[status]', res && res.status());
  await page.waitForTimeout(5000);
  const text = await page.locator('body').innerText();
  console.log('[body-snippet]', text.slice(0, 800));
  await browser.close();
})();
