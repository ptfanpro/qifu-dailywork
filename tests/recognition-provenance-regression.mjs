import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPdfIndexBinding,canReusePdfIndex} from '../src/recognition-provenance.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qifu-index-binding-test-'));
try {
  const a=path.join(dir,'a.pdf'),b=path.join(dir,'b.pdf');
  fs.writeFileSync(a,'synthetic PDF identity A');fs.writeFileSync(b,'synthetic PDF identity B');
  const binding=createPdfIndexBinding('2026-09-01',[a,b],'recognizer-a');
  const plan={businessDate:'2026-09-01',pdfIndexBinding:binding};
  assert.equal(canReusePdfIndex(plan,createPdfIndexBinding('2026-09-01',[b,a],'recognizer-a')),true);
  assert.equal(canReusePdfIndex(plan,createPdfIndexBinding('2026-09-01',[a],'recognizer-a')),false,'removed PDF');
  assert.equal(canReusePdfIndex(plan,createPdfIndexBinding('2026-09-02',[a,b],'recognizer-a')),false,'date change');
  assert.equal(canReusePdfIndex(plan,createPdfIndexBinding('2026-09-01',[a,b],'recognizer-b')),false,'upgraded rules');
  assert.equal(canReusePdfIndex({businessDate:plan.businessDate},binding),false,'legacy date-only cache');
  fs.writeFileSync(b,'synthetic PDF identity C');
  assert.equal(canReusePdfIndex(plan,createPdfIndexBinding('2026-09-01',[a,b],'recognizer-a')),false,'same filename and byte count, different content');
  console.log('PDF index content/rule binding regression PASS');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
