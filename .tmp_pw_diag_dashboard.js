const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGEERROR', err && (err.stack || err.message || String(err))));
  page.on('requestfailed', (req) => console.log('REQFAIL', req.url(), req.failure() && req.failure().errorText));
  const res = await page.goto('https://captiva-risks.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('STATUS', res && res.status());
  await page.waitForTimeout(6000);
  const text = await page.locator('body').innerText();
  console.log('BODY_TEXT_START');
  console.log(text.slice(0, 2000));
  console.log('BODY_TEXT_END');
  await browser.close();
})();
