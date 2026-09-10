import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
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

const redigest=evidence=>{
  evidence.digest=crypto.createHash('sha256').update(JSON.stringify({schemaVersion:evidence.schemaVersion,
    recipe:evidence.recipe,pdfSha256:evidence.pdfSha256,pageNumber:evidence.pageNumber,
    observations:evidence.observations})).digest('hex');
  return evidence;
};
const validLedger=()=>appendPdfPrintCodeObservation(createPdfPrintCodeEvidence(source),input());

test('PDF evidence rejects malformed observations even when their checksum was recomputed',()=>{
  const mutations=[
    item=>{item.sequence=2;},item=>{item.engine='unknown';},item=>{item.layout='';},
    item=>{item.status='success';},item=>{item.cropSha256=null;},
    item=>{item.sourceCropSha256='not-a-hash';},item=>{item.modelSha256='not-a-hash';},
    item=>{item.confidence=101;},item=>{item.confidence='94';},item=>{item.confidenceScale=1;},
    item=>{item.blank=true;},item=>{item.blank='false';},item=>{item.incompleteTailObserved=0;},
    item=>{item.codes[0].number=13;},item=>{item.codes[0].prefix='2610';},
    item=>{item.codes[0].fullCode='269-1-12-extra';},item=>{item.codes.push({...item.codes[0]});},
    item=>{item.codes=null;},item=>{item.errorCode='ocr-failed';},
    item=>{item.privateCustomerText='synthetic-private-content';},
  ];
  for(const mutate of mutations){
    const evidence=validLedger();mutate(evidence.observations[0]);redigest(evidence);
    assert.equal(validatePdfPrintCodeEvidence(evidence,source),false,mutate.toString());
  }
});

test('PDF evidence validates status-specific crop, confidence and empty-result invariants',()=>{
  const evidence=createPdfPrintCodeEvidence(source);
  appendPdfPrintCodeObservation(evidence,input({status:'error',errorCode:'ocr-failed'}));
  appendPdfPrintCodeObservation(evidence,{engine:'paddle',layout:'paddle-trimmed',status:'skipped',
    sourceCropSha256:'b'.repeat(64),errorCode:'crop-normalization-failed'});
  assert.equal(validatePdfPrintCodeEvidence(JSON.parse(JSON.stringify(evidence)),source),true);
  const mutations=[
    value=>{value.observations[0].codes=[{prefix:'269',number:12,fullCode:'269-1-12'}];},
    value=>{value.observations[0].confidence=90;value.observations[0].confidenceScale=100;},
    value=>{value.observations[0].blank=false;},
    value=>{value.observations[1].sourceCropSha256=null;},
    value=>{value.observations[1].cropSha256='c'.repeat(64);},
  ];
  for(const mutate of mutations){
    const copy=structuredClone(evidence);mutate(copy);redigest(copy);
    assert.equal(validatePdfPrintCodeEvidence(copy,source),false,mutate.toString());
  }
  const windows=appendPdfPrintCodeObservation(createPdfPrintCodeEvidence(source),
    input({engine:'windows-ocr',confidence:null,confidenceScale:null}));
  windows.observations[0].confidence=100;windows.observations[0].confidenceScale=100;redigest(windows);
  assert.equal(validatePdfPrintCodeEvidence(windows,source),false,'WinRT cannot acquire invented numeric confidence');
});

test('PDF evidence appends are atomic when optional identity or engine confidence is invalid',()=>{
  for(const change of [{sourceCropSha256:'broken'},{engine:'paddle',confidence:94,confidenceScale:100},
    {engine:'windows-ocr',confidence:94,confidenceScale:100}]){
    const evidence=validLedger(),before=JSON.stringify(evidence);
    assert.throws(()=>appendPdfPrintCodeObservation(evidence,input(change)));
    assert.equal(JSON.stringify(evidence),before);
  }
  const damaged=validLedger();damaged.observations[0].sequence=99;redigest(damaged);
  const before=JSON.stringify(damaged);
  assert.throws(()=>appendPdfPrintCodeObservation(damaged,input()));
  assert.equal(JSON.stringify(damaged),before);
});

test('PDF evidence validation safely rejects non-records and retains syntactic OCR observations',()=>{
  for(const evidence of [null,undefined,{},[],{...validLedger(),observations:[null]},
    redigest({...validLedger(),observations:new Array(1)}),
    redigest({...validLedger(),observations:[null]})]){
    assert.doesNotThrow(()=>assert.equal(validatePdfPrintCodeEvidence(evidence,source),false));
  }
  const extended=validLedger();extended.privateCustomerText='synthetic-private-content';
  assert.equal(validatePdfPrintCodeEvidence(extended,source),false);
  const recursive=validLedger();recursive.observations[0].codes=[recursive];
  assert.doesNotThrow(()=>assert.equal(validatePdfPrintCodeEvidence(recursive,source),false));
  const evidence=appendPdfPrintCodeObservation(createPdfPrintCodeEvidence(source),
    input({text:'269-1-0012 2699-1-12 269-1-12 3'}));
  assert.equal(evidence.observations[0].incompleteTailObserved,true);
  assert.deepEqual(evidence.observations[0].codes.map(value=>value.fullCode),['269-1-0012','2699-1-12']);
  assert.equal(validatePdfPrintCodeEvidence(evidence,source),true,
    'a suspicious OCR month is still retained, not filtered to the business date');
});
