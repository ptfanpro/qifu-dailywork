// Private diagnostic rendering; never changes the PDF or any business state.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {requirePrivateAuditRoot} from './audit-paths.mjs';
const [pdfFile,output,...numbers]=process.argv.slice(2);
requirePrivateAuditRoot(output);
const require=createRequire(import.meta.url),{createCanvas}=require('@napi-rs/canvas');
const pdfModule=require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs=await import(pathToFileURL(pdfModule).href);
const fonts=path.resolve(path.dirname(pdfModule),'../../standard_fonts').replaceAll('\\','/')+'/';
const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(pdfFile)),disableWorker:true,standardFontDataUrl:fonts,useSystemFonts:false}).promise;
try {
  for(const value of numbers) {
    const number=Number(value);
    if(!Number.isInteger(number)||number<1||number>doc.numPages)throw Error('Invalid page number');
    const page=await doc.getPage(number),base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:1200/base.width});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    fs.writeFileSync(path.join(output,`private-page-${number}.png`),canvas.toBuffer('image/png'));
  }
} finally {await doc.destroy();}
