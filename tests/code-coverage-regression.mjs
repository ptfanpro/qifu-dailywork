import assert from 'node:assert/strict';
import {localOcrCodeLayoutsForPhoto,hasAdjacentLocalOcrConsensus,independentCodeConsensus,recheckReliablePhotoClaimsWithPdf} from '../src/photo-prepare.mjs';
const layouts=localOcrCodeLayoutsForPhoto({});
const preferred=localOcrCodeLayoutsForPhoto({},['local-ocr-grid4-line-30','not-a-valid-crop']);
assert.equal(preferred[0].name,'local-ocr-grid4-line-30');
assert.deepEqual(new Set(preferred.map(r=>r.name)),new Set(layouts.map(r=>r.name)),'hints reorder, never remove fallback coverage');
// Simulated code rectangles: camera movement horizontally AND vertically.
// Narrow code windows must enclose the full code, not merely intersect it.
for(let x=.50;x<=.82;x+=.02) for(let y=.18;y<=.69;y+=.01) {
  assert.ok(layouts.some(r=>r.width<=.121 && r.left<=x+1e-6 && r.left+r.width>=x+.05-1e-6 && r.top<=y+1e-6 && r.top+r.height>=y+.01-1e-6),`uncovered printed code at ${x.toFixed(2)},${y.toFixed(2)}`);
}
assert.equal(hasAdjacentLocalOcrConsensus([{number:60,variant:'local-ocr-grid4-line-30:color',prefixDistance:0,confidence:97},{number:60,variant:'local-ocr-grid4-line-30:normalized',prefixDistance:0,confidence:93}],60),true);
assert.equal(hasAdjacentLocalOcrConsensus([{number:60,variant:'local-ocr-grid4-line-30:color',prefixDistance:1,confidence:97},{number:60,variant:'local-ocr-grid4-line-30:normalized',prefixDistance:1,confidence:93}],60),false);
const reading=(number,engine,crop,prefixDistance=0)=>({number,engine,crop,prefixDistance});
const correct=[reading(68,'paddle','a'),reading(68,'paddle','b'),reading(68,'tesseract','a'),reading(68,'tesseract','b')];
assert.equal(independentCodeConsensus(correct),68);
assert.equal(independentCodeConsensus([reading(58,'paddle','color'),reading(58,'paddle','normalized')]),null,'same model is not two engines');
assert.equal(independentCodeConsensus([...correct,...correct].filter(x=>x.crop==='a')),null,'repeated observations do not create a second physical crop');
assert.equal(independentCodeConsensus([...correct,...correct.map(x=>({...x,number:58}))]),null,'two conflicting independent consensuses must remain unresolved');
assert.equal(independentCodeConsensus(correct.map(x=>({...x,prefixDistance:1}))),null,'tail-only readings are insufficient');
assert.equal(independentCodeConsensus(correct.map(({prefixDistance,...x})=>x)),null);
const verified={file:'synthetic.jpg',number:68,reliable:true,evidence:{method:'independent-ocr-engines-full-code-consensus',votes:2,maxConfidence:88,prefixDistance:0,independentEngines:['paddle','tesseract']}};
const check=await recheckReliablePhotoClaimsWithPdf([verified],[{number:68,_localShapeFingerprint:[1]}]);
assert.equal(check.confirmed,1,'independent full-code evidence must survive later PDF index recheck');
console.log('Two-dimensional code coverage and independent-engine conflict tests PASS');
