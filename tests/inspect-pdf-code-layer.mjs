// Read-only diagnostic: emits code-like tokens and counts, not customer text.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const pdfjs=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
for(const file of process.argv.slice(2)) {
  const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),disableWorker:true}).promise;
  const page=await doc.getPage(1), text=await page.getTextContent();
  const joined=text.items.map(i=>i.str).join(' ');
  console.log(JSON.stringify({pages:doc.numPages,textItems:text.items.length,codeTokens:joined.match(/\b26\d{1,2}\s*-\s*1\s*-\s*\d+\b/g)||[],numericFormatItems:text.items.filter(i=>/^[\d\s-]{4,20}$/.test(i.str)).map(i=>({pattern:i.str.replace(/\d/g,'D'),x:i.transform[4],y:i.transform[5]}))}));
  await doc.destroy();
}
