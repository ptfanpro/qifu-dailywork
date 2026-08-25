import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:19227', { timeout: 3000 });
try {
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => /\/blessing\/mind\/toUpload\/name/.test(candidate.url()));
  if (!page) throw new Error('当前 Edge 没有图片上传标签。');
  const result = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    inputs: [...document.querySelectorAll('input[type="file"]')].map((element) => ({
      id: element.id,
      name: element.getAttribute('name'),
      accept: element.getAttribute('accept'),
      multiple: element.multiple,
      display: getComputedStyle(element).display,
      visibility: getComputedStyle(element).visibility,
      parent: element.parentElement?.outerHTML?.slice(0, 1000),
    })),
    clickers: [...document.querySelectorAll('button,a,label,input')].map((element) => ({
      tag: element.tagName,
      id: element.id,
      className: String(element.className || ''),
      text: String(element.textContent || element.value || '').replace(/\s+/g, ' ').trim(),
      forValue: element.getAttribute('for'),
      onclick: element.getAttribute('onclick'),
    })).filter((item) => /file|上传|相机|camera|选择/i.test(`${item.id} ${item.className} ${item.text} ${item.forValue} ${item.onclick}`)),
  }));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close().catch(() => {});
}
