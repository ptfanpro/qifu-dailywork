import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const file = process.argv[2];
const document = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true }).promise;
for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  console.log(JSON.stringify({ pageNumber, text: content.items.map((item) => item.str).filter(Boolean) }, null, 2));
}
await document.destroy();
