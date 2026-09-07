import assert from 'node:assert/strict';
import {summarizeWindowsCodeObservations,hasDirectVisibleCodeEvidence,recheckReliablePhotoClaimsWithPdf,reconcileDuplicatePhotoNumbers,parseLooseWindowsCodeCandidates} from '../src/photo-prepare.mjs';

const readings=(...texts)=>texts.map((text,index)=>({crop:`crop-${index}.png`,text}));
const good=summarizeWindowsCodeObservations(readings('269-1-32','269-1-32'),'269');
assert.equal(good.reliable,true);
assert.equal(good.number,32);
assert.equal(good.evidence.votes,2);
assert.equal(good.evidence.maxConfidence,null,'WinRT does not supply a numeric confidence');
assert.equal(summarizeWindowsCodeObservations(readings('269 · 1 · 123','269 - 1 - 123'),'269').number,123,
  'WinRT renders visible separators as middle dots; complete digits must stay intact');
assert.deepEqual(good.evidence.independentEngines,['windows-ocr'],'two crops are still one engine');
assert.ok(good.observations.every(o=>o.confidence===null&&o.fullCodeValidated));
assert.equal(summarizeWindowsCodeObservations(readings('269-1-32'),'269').reliable,false);
assert.equal(summarizeWindowsCodeObservations([{crop:'same',text:'269-1-32'},{crop:'same',text:'269-1-32'}],'269').reliable,false);
for(const text of ['32','2026','269','69 32','269 3','269 · 123','269 · 1 · 12 3']) {
  assert.equal(summarizeWindowsCodeObservations(readings(text,text),'269').reliable,false,`incomplete code: ${text}`);
}
const conflict=summarizeWindowsCodeObservations(readings('269-1-32','269-1-33'),'269');
assert.deepEqual(readings('269-1-32','269-1-33').flatMap(r=>parseLooseWindowsCodeCandidates(r.text,'269',new Set([32]))),[32],
  'reproduce old filtering: the contradictory 33 vanished before consensus');
assert.equal(conflict.reliable,false,'current PDF membership must not hide the other crop');
assert.deepEqual(conflict.candidates.map(c=>c.number),[32,33]);
assert.equal(summarizeWindowsCodeObservations(readings('269-1-32','269-1-32','269-1-33'),'269').reliable,false,'even minority full-code contradiction stays visible');
assert.equal(summarizeWindowsCodeObservations(readings('269-1-32 269-1-33','269-1-32'),'269').reliable,false);
assert.equal(summarizeWindowsCodeObservations(readings('268-1-32','268-1-32'),'269').reliable,false,'wrong month');
const outside=summarizeWindowsCodeObservations(readings('269-1-9999','269-1-9999'),'269');
assert.equal(outside.number,9999,'raw observation has no expected-PDF-set dependency');

const paper={file:'synthetic.jpg',number:32,reliable:true,evidence:good.evidence,paperGeometry:{},visualMetrics:{},candidates:good.candidates};
assert.equal(hasDirectVisibleCodeEvidence(paper),true,'explicit full-code provenance works without invented score');
const pdfs=[{number:32,portrait:false,_localShapeFingerprint:new Float32Array([1])}];
const recheck=await recheckReliablePhotoClaimsWithPdf([paper],pdfs);
assert.equal(recheck.confirmed,1);
const old={...paper,number:33,observedOcrNumber:32,observedOcrEvidence:good.evidence,evidence:{method:'existing-numeric-filename-claim'}};
const oldRecheck=await recheckReliablePhotoClaimsWithPdf([old],[{...pdfs[0],number:33}]);
assert.equal(oldRecheck.rejected,1,'null confidence must not hide an independently recorded filename disagreement');
const repeated=summarizeWindowsCodeObservations(readings('269-1-68','269-1-68'),'269');
const duplicateItems=[
  {...paper,number:68,evidence:{method:'photo-code-multi-crop-consensus',votes:4,prefixDistance:0,maxConfidence:95}},
  {...paper,number:68,evidence:repeated.evidence},
];
assert.deepEqual(reconcileDuplicatePhotoNumbers(duplicateItems,new Set([66,68])),[],
  'missing numerical confidence is not evidence that a full-code reading is weak');
assert.equal(duplicateItems[1].number,68);
console.log('Windows full-code provenance regression PASS');
