import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCompletePrintedCodes,independentCodeConsensus,recheckReliablePhotoClaimsWithPdf,reconcileDuplicatePhotoNumbers} from '../src/photo-prepare.mjs';

for(let month=1;month<=12;month++) {
  const prefix=`26${month}`;
  assert.deepEqual(parseCompletePrintedCodes(`${prefix} - 1 - 1234`,prefix).numbers,[1234]);
  assert.deepEqual(parseCompletePrintedCodes(`${prefix}·1·32`,prefix).numbers,[32]);
  for(const text of [`${prefix}-132`,`${prefix}132`,`${prefix}-1-3 2`,'32','2026']) {
    assert.deepEqual(parseCompletePrintedCodes(text,prefix).numbers,[],`not a complete printed code: ${text}`);
  }
}
assert.deepEqual(parseCompletePrintedCodes('269-1-32 269-1-9999','269').numbers,[32,9999],
  'raw observations retain numbers absent from the current PDF');
const observation=(number,engine,crop)=>({number,engine,crop,fullCodeValidated:true,prefixDistance:0});
const good=['paddle','tesseract'].flatMap(engine=>['a','b'].map(crop=>observation(68,engine,crop)));
const evidence={method:'independent-ocr-engines-full-code-consensus',independentEngines:['paddle','tesseract'],
  observations:good,votes:2,prefixDistance:0,maxConfidence:null};
assert.equal(independentCodeConsensus([...good,observation(9999,'windows','c')]),null);
const unproven={file:'unread-source.jpg',number:68,reliable:true,evidence:{...evidence,observations:undefined,maxConfidence:99}};
const result=await recheckReliablePhotoClaimsWithPdf([unproven],[{number:68,_localShapeFingerprint:[1]}]);
assert.equal(result.confirmed,0,'legacy method names and scores cannot replace missing observations');
assert.equal(result.rejected,1);
assert.equal(unproven.pdfRecheck.reason,'independent-code-evidence-incomplete-or-conflicting');

const duplicateItems=[
  {number:68,reliable:true,evidence:{method:'photo-code-multi-crop-consensus',votes:4,prefixDistance:0,maxConfidence:95}},
  {number:68,reliable:true,evidence},
];
assert.deepEqual(reconcileDuplicatePhotoNumbers(duplicateItems,new Set([66,68])),[],
  'full observed code cannot be moved into a missing slot because null score becomes zero');
assert.equal(duplicateItems[1].number,68);
const source=fs.readFileSync(new URL('../src/photo-prepare.mjs',import.meta.url),'utf8');
const conflictAudit=source.slice(source.indexOf('export async function auditConflictingPhotoCode'),source.indexOf('export async function matchPdfPagesLocally'));
assert.doesNotMatch(conflictAudit,/parseOcrCandidates\(text,expectedPrefix,expectedNumbers\)/,
  'do not delete contrary codes with the PDF set before consensus');
assert.match(conflictAudit,/parseCompletePrintedCodes\(text,expectedPrefix\)/);
console.log('Independent full-code provenance regression PASS');
