import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPdfPrintCodeEvidence,appendPdfPrintCodeObservation,validatePdfPrintCodeEvidence} from '../src/pdf-print-code-evidence.mjs';

const source={pdfSha256:'a'.repeat(64),pageNumber:2};
const input=(overrides={})=>({engine:'tesseract',layout:'landscape-code',cropSha256:'b'.repeat(64),
  text:'269-1-12',confidence:94,confidenceScale:100,...overrides});

test('PDF literal evidence retains the ninth contrary reading and foreign namespaces before ranking',()=>{
  const evidence=createPdfPrintCodeEvidence(source);
  for(let index=0;index<9;index++)appendPdfPrintCodeObservation(evidence,input());
  appendPdfPrintCodeObservation(evidence,input({engine:'paddle',text:'2610-1-12',confidence:.01,confidenceScale:1}));
  assert.equal(evidence.observations.length,10);
  assert.deepEqual(evidence.observations[9].codes,[{prefix:'2610',number:12,fullCode:'2610-1-12'}]);
  assert.equal(evidence.observations[9].confidence,.01);
  assert.deepEqual(evidence.observations[0].codes,[{prefix:'269',number:12,fullCode:'269-1-12'}]);
  assert.equal(evidence.mayAuthorizeUpload,false);
  assert.equal(validatePdfPrintCodeEvidence(evidence,source),true);
});

test('PDF literal evidence retains blank, incomplete and failed observations without customer text',()=>{
  const evidence=createPdfPrintCodeEvidence(source);
  appendPdfPrintCodeObservation(evidence,input({text:'',confidence:0}));
  appendPdfPrintCodeObservation(evidence,input({text:'269-1-12 3 customer-private-text'}));
  appendPdfPrintCodeObservation(evidence,input({status:'error',errorCode:'ocr-failed',text:'secret exception'}));
  assert.equal(evidence.observations[0].blank,true);
  assert.equal(evidence.observations[1].incompleteTailObserved,true);
  assert.deepEqual(evidence.observations[1].codes,[]);
  assert.equal(evidence.observations[2].status,'error');
  assert.equal(evidence.observations[2].confidence,null);
  assert.equal(JSON.stringify(evidence).includes('private-text'),false);
  assert.equal(JSON.stringify(evidence).includes('secret exception'),false);
});

test('PDF literal evidence requires physical PDF/page and exact crop identities',()=>{
  assert.throws(()=>createPdfPrintCodeEvidence({...source,pageNumber:0}));
  assert.throws(()=>createPdfPrintCodeEvidence({...source,pdfSha256:'missing'}));
  const evidence=createPdfPrintCodeEvidence(source);
  assert.throws(()=>appendPdfPrintCodeObservation(evidence,input({cropSha256:null})));
  assert.throws(()=>appendPdfPrintCodeObservation(evidence,input({confidence:NaN})));
  appendPdfPrintCodeObservation(evidence,input());
  assert.equal(validatePdfPrintCodeEvidence(evidence,{...source,pageNumber:3}),false);
  assert.equal(validatePdfPrintCodeEvidence(evidence,{...source,pdfSha256:'c'.repeat(64)}),false);
  const copy=JSON.parse(JSON.stringify(evidence));copy.observations[0].cropSha256='c'.repeat(64);
  assert.equal(validatePdfPrintCodeEvidence(copy,source),false);
  evidence.mayAuthorizeUpload=true;
  assert.equal(validatePdfPrintCodeEvidence(evidence,source),false);
});

test('PDF literal evidence does not merge same tails from different prefixes or engines',()=>{
  const evidence=createPdfPrintCodeEvidence(source);
  appendPdfPrintCodeObservation(evidence,input({text:'269-1-12 2610-1-12'}));
  appendPdfPrintCodeObservation(evidence,input({engine:'windows-ocr',confidence:null,confidenceScale:null}));
  assert.equal(evidence.observations[0].codes.length,2);
  assert.equal(evidence.observations[1].engine,'windows-ocr');
  assert.equal(evidence.observations[1].confidence,null);
  assert.equal(validatePdfPrintCodeEvidence(JSON.parse(JSON.stringify(evidence)),source),true);
});
