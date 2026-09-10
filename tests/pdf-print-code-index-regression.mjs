import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {indexPdfCodes,appendWindowsPdfCodeEvidence} from '../src/photo-prepare.mjs';
import {createPdfPrintCodeEvidence,validatePdfPrintCodeEvidence} from '../src/pdf-print-code-evidence.mjs';
const require=createRequire(import.meta.url),{PDFDocument}=require('pdf-lib');
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

test('actual PDF index preserves all readings outside the legacy top-eight candidates',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-literal-index-'));
  try {
    const document=await PDFDocument.create();document.addPage([842,595]);
    const pdf=path.join(dir,'synthetic.pdf');fs.writeFileSync(pdf,await document.save());
    const codes=Array.from({length:12},(_,index)=>`269-1-${index+1}`).concat('2610-1-12');
    const calls=[];
    const worker={setParameters:async()=>{},recognize:async file=>{
      calls.push(hash(fs.readFileSync(file)));
      return {data:{text:codes.join('\n'),confidence:1}};
    }};
    const [page]=await indexPdfCodes(worker,[pdf],'269',path.join(dir,'work'));
    assert.equal(page.ocrObservations.length,8,'legacy selection remains bounded');
    const source={pdfSha256:hash(fs.readFileSync(pdf)),pageNumber:1};
    assert.equal(validatePdfPrintCodeEvidence(page.printCodeEvidence,source),true);
    const recorded=page.printCodeEvidence.observations.filter(item=>item.engine==='tesseract');
    assert.equal(recorded.length,calls.length);
    assert.deepEqual(recorded.map(item=>item.cropSha256),calls);
    for(const reading of recorded)assert.deepEqual(reading.codes.map(code=>code.fullCode),codes);
    assert.ok(page.printCodeEvidence.observations.some(item=>item.status==='skipped'&&item.errorCode==='ocr-unavailable'));
    assert.equal(Object.hasOwn(page,'windowsFallbackFile'),false);
    assert.equal(Object.hasOwn(page,'windowsFallbackSha256'),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('actual PDF index preserves failed OCR locally and restores sparse mode before stopping',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-literal-failure-'));
  try {
    const document=await PDFDocument.create();document.addPage([842,595]);
    const pdf=path.join(dir,'synthetic.pdf');fs.writeFileSync(pdf,await document.save());
    const parameters=[];let calls=0;
    const worker={setParameters:async value=>parameters.push(value.tessedit_pageseg_mode),recognize:async()=>{
      if(++calls===2)throw Error('synthetic-private-error');return {data:{text:'269-1-12',confidence:90}};
    }};
    await assert.rejects(indexPdfCodes(worker,[pdf],'269',path.join(dir,'work')),/synthetic-private-error/);
    const partial=JSON.parse(fs.readFileSync(path.join(dir,'work','pdf-code-evidence.partial.json')));
    assert.equal(partial.complete,false);
    assert.equal(partial.pages[0].observations.at(-1).status,'error');
    assert.equal(partial.pages[0].observations.at(-1).errorCode,'ocr-failed');
    assert.equal(JSON.stringify(partial).includes('synthetic-private-error'),false);
    assert.deepEqual(parameters,['11','7']);
    assert.equal(validatePdfPrintCodeEvidence(partial.pages[0],{pdfSha256:hash(fs.readFileSync(pdf)),pageNumber:1}),true);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('Windows PDF fallback retains a rejected foreign code before expected-prefix/set filtering',()=>{
  const source={pdfSha256:'a'.repeat(64),pageNumber:1};
  const page={printCodeEvidence:createPdfPrintCodeEvidence(source),windowsFallbackSha256:'b'.repeat(64)};
  assert.equal(appendWindowsPdfCodeEvidence(page,{text:'2610-1-12'},'269','windows-ocr-top-right',new Set([12])),false);
  assert.equal(page.printCodeEvidence.observations[0].codes[0].fullCode,'2610-1-12');
  assert.equal(validatePdfPrintCodeEvidence(page.printCodeEvidence,source),true);
  assert.equal(page.rawNumber,undefined);
});
