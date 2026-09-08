import assert from 'node:assert/strict';
import {isLikelyScene} from '../src/photo-prepare.mjs';

// A substantial yellow sheet in front of candles can satisfy the old dark/warm
// rule even when the colour component is not rectangular. No filename, target
// number, customer text or historical hash participates in this role decision.
const candleLitPaper = {
  reliable:false, number:null, candidates:[],
  paperGeometry:{left:.28,top:.40,width:.66,height:.48,right:.94,bottom:.88,
    score:.20,fill:.63,boxArea:.32,rectangularPaper:false,usablePaper:true},
  visualMetrics:{edgeDensity:.142,upperEdgeDensity:.074,uniformity:.483},
  sceneMetrics:{luminance:88,darkRatio:.46,warmBrightRatio:.196,
    flameStructure:{distributed:true}},
};
const before = structuredClone(candleLitPaper);
assert.equal(isLikelyScene(candleLitPaper),false,
  'dark/warm background must not bypass code fallback for a usable paper region');
assert.deepEqual(candleLitPaper,before,'role inspection must not mutate evidence');
assert.equal(isLikelyScene({...candleLitPaper,
  paperGeometry:{...candleLitPaper.paperGeometry,rectangularPaper:true}}),false);

// Keep the dim-scene path for an explicitly unusable, nonrectangular component.
const dimScene = {...candleLitPaper,
  visualMetrics:{...candleLitPaper.visualMetrics,uniformity:.45},
  paperGeometry:{left:.25,top:.40,width:.30,height:.30,right:.55,bottom:.70,
    score:.04,fill:.30,boxArea:.09,rectangularPaper:false,usablePaper:false}};
assert.equal(isLikelyScene(dimScene),true);
for (const usablePaper of [true,undefined,null]) {
  assert.equal(isLikelyScene({...dimScene,
    paperGeometry:{...dimScene.paperGeometry,usablePaper}}),false,
  'a missing no-paper assessment is not evidence permitting dark-scene bypass');
}
assert.equal(isLikelyScene({...dimScene,bodyReviewHistory:[{status:'conflicting-body-evidence'}]}),false);
assert.equal(isLikelyScene({...dimScene,codeAuditHistory:[{status:'inconclusive'}]}),false);
console.log('Foreground paper / dark-scene precedence regression passed.');
