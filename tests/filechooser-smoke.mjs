import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:19227', { timeout: 3000 });
try {
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => /\/blessing\/mind\/toUpload\/name/.test(candidate.url()));
  if (!page) throw new Error('当前 Edge 没有图片上传标签。');
  const camera = page.locator('form#form button[onclick*="#file"], button:has(.fa-camera)').first();
  await camera.waitFor({ state: 'visible', timeout: 5000 });
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
  await camera.evaluate((element) => element.click());
  const chooser = await chooserPromise;
  await chooser.setFiles([], { noWaitAfter: true, timeout: 5000 });
  console.log(JSON.stringify({ passed: true, multiple: chooser.isMultiple() }));
} finally {
  await browser.close().catch(() => {});
}
