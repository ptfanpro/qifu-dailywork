import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseLocalOcrCodeCandidates,inferTrailingUnreadPdfCodes,inferSequentialPdfCodes,appendWindowsPdfCodeEvidence} from '../src/photo-prepare.mjs';

// The short prefix is YY + unpadded month: October through December have four
// digits. They must not be parsed as a substring with the wrong prefix.
for(let month=1;month<=12;month++) {
  const prefix=`26${month}`;
  const candidates=parseLocalOcrCodeCandidates(`${prefix}-1-123`,prefix,new Set([123]));
  assert.ok(candidates.some(c=>c.number===123&&c.prefixDistance===0),`full month prefix ${month}`);
  for(const tail of [1,11,123,1234]) {
    assert.ok(parseLocalOcrCodeCandidates(`${prefix}1${tail}`,prefix,new Set([tail]))
      .some(c=>c.number===tail&&c.prefixDistance===0),`compact code ${prefix}/1/${tail}`);
  }
}

const unreadTail=[...Array.from({length:5},(_,i)=>({pdf:'batch红纸1.pdf',pageNumber:i+1,number:10+i,rawNumber:10+i})),
  {pdf:'batch红纸2.pdf',pageNumber:1,number:null,rawNumber:2027}];
assert.equal(inferTrailingUnreadPdfCodes(unreadTail),false,'an unread later export may start at ANY number; count does not prove 15');
assert.equal(unreadTail.at(-1).number,null);
const dateNoisePages=Array.from({length:3},(_,i)=>({pdf:'dates.pdf',pageNumber:i+1,number:null,rawNumber:2027,
  ocrObservations:[{number:2027,prefixDistance:99,confidence:98,layout:'wide'}]}));
inferSequentialPdfCodes(dateNoisePages);
assert.deepEqual(dateNoisePages.map(page=>page.number),[null,null,null],'three repeated printed years are not a three-page business-code sequence');

const fullCode=(number)=>[
  {number,prefixDistance:0,confidence:90,layout:'top-right-line'},
  {number,prefixDistance:0,confidence:85,layout:'top-right-wide'},
];
const alreadyDense=[90,91,92,93,94].map((n,i)=>({pdf:i===4?'yellow.pdf':'red.pdf',pageNumber:i===4?1:i+1,
  number:null,rawNumber:n,ocrObservations:[{number:n,prefixDistance:0,confidence:90,layout:'paddle-line'}]}));
inferSequentialPdfCodes(alreadyDense);
assert.deepEqual(alreadyDense.map(page=>page.number),[90,91,92,93,94],'a complete range must not shift its first page to the other end (90 -> 95)');
const gapPages=[100,101,105].map((n,i)=>({pdf:'batch.pdf',pageNumber:i+1,rawNumber:n,number:null,ocrObservations:fullCode(n)}));
inferSequentialPdfCodes(gapPages);
assert.deepEqual(gapPages.map(p=>p.number),[100,101,105],'a genuine export gap must not be rewritten into a dense sequence');
const highTail=[{pdf:'batch.pdf',pageNumber:1,rawNumber:1234,number:null,ocrObservations:fullCode(1234)}];
inferSequentialPdfCodes(highTail);
assert.equal(highTail[0].number,1234,'a verified four-digit tail is not a date merely because it exceeds 999');

const unknownMiddle=[
  {pdf:'a.pdf',pageNumber:1,number:100,rawNumber:100,ocrObservations:fullCode(100)},
  {pdf:'b.pdf',pageNumber:1,number:null,rawNumber:null},
  {pdf:'c.pdf',pageNumber:1,number:102,rawNumber:102,ocrObservations:fullCode(102)},
];
inferSequentialPdfCodes(unknownMiddle);
assert.equal(unknownMiddle[1].number,null,'one missing number is not evidence about an entirely unread PDF');
const originalEvidence={rawNumber:118,number:null,ocrObservations:[{number:118,prefixDistance:0,confidence:0,layout:'line'}]};
const windowsPage=structuredClone(originalEvidence);
assert.equal(appendWindowsPdfCodeEvidence(windowsPage,{number:261,text:'261'},'261'),false,'a month prefix alone is not a page number');
assert.deepEqual(windowsPage,originalEvidence,'a failed fallback must not erase existing observations');
assert.equal(appendWindowsPdfCodeEvidence(windowsPage,{number:2027,text:'2027'},'261'),false);
assert.equal(appendWindowsPdfCodeEvidence(windowsPage,{text:'261-1-118'},'261'),true);
assert.equal(windowsPage.rawNumber,118);assert.equal(windowsPage.ocrObservations.length,2);
assert.equal(windowsPage.ocrObservations[1].confidence,null,'WinRT has no numeric OCR confidence');
assert.equal(appendWindowsPdfCodeEvidence(windowsPage,{text:'261-1-118 261-1-119'},'261'),false);
const productionSource=fs.readFileSync(new URL('../src/photo-prepare.mjs',import.meta.url),'utf8');
assert.doesNotMatch(productionSource,/const manualEvidence = new Map/,'filename-only manual assignments must not return');
assert.doesNotMatch(productionSource,/manual-visual-review-2026-08-11/);
assert.match(productionSource,/if \(!evidence\.knownFilesHash\) return false/,'no historical filename-only batch may bypass recognition');
assert.doesNotMatch(productionSource,/page\.ocrObservations = \[\{ number: observation\.number/,'a fallback must retain the previous engines\' observations');
console.log('Annual code contract regression PASS');
