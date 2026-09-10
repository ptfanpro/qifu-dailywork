// Real rendering + local OCR on synthetic public test content. This catches
// runtime/resource failures that pure number-policy tests cannot exercise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import {createOcrWorker,indexPdfCodes} from '../src/photo-prepare.mjs';
import {validatePdfPrintCodeEvidence} from '../src/pdf-print-code-evidence.mjs';
const require=createRequire(import.meta.url),{PDFDocument,StandardFonts}=require('pdf-lib');
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-pdf-index-integration-'));
let worker;
try {
  const document=await PDFDocument.create(),font=await document.embedFont(StandardFonts.Helvetica);
  for(const number of [123,124]) {
    const page=document.addPage([842,595]);
    page.drawText(`269-1-${number}`,{x:742,y:579,size:10,font});
  }
  const pdf=path.join(dir,'synthetic.pdf');fs.writeFileSync(pdf,await document.save());
  worker=await createOcrWorker(appRoot);
  const pages=await indexPdfCodes(worker,[pdf],'269',path.join(dir,'evidence'),appRoot);
  assert.deepEqual(pages.map(page=>page.number),[123,124]);
  assert.ok(pages.every(page=>page.ocrObservations.some(item=>item.prefixDistance===0)));
  const pdfSha256=crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  for(const page of pages) {
    assert.equal(validatePdfPrintCodeEvidence(page.printCodeEvidence,{pdfSha256,pageNumber:page.pageNumber}),true);
    assert.ok(page.printCodeEvidence.observations.some(item=>item.engine==='tesseract'&&item.status==='ok'));
    assert.ok(page.printCodeEvidence.observations.some(item=>item.engine==='paddle'&&item.status==='ok'));
    assert.ok(page.printCodeEvidence.observations.every(item=>!Object.hasOwn(item,'text')));
  }
  console.log('PDF rendering + local OCR integration PASS (2 synthetic pages)');
} finally {if(worker)await worker.terminate();fs.rmSync(dir,{recursive:true,force:true});}
