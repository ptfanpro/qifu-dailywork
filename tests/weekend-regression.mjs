import assert from 'node:assert/strict';
import { isLikelyScene, classifySceneVisualScore } from '../src/photo-prepare.mjs';
import { measureFlameStructure } from '../src/scene-structure.mjs';

const pixels = new Uint8Array(320*240*3).fill(20);
function rectangle(x,y,w,h) { for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) pixels.set([255,210,80],(yy*320+xx)*3); }
assert.equal(measureFlameStructure(pixels,320,240).distributed,false);
rectangle(20,100,220,100);
assert.equal(measureFlameStructure(pixels,320,240).distributed,false,'one yellow sheet is not distributed flames');
pixels.fill(20);
for(const y of [110,150,190]) for(const x of [25,75,125,175,225]) rectangle(x,y,3,4);
assert.equal(measureFlameStructure(pixels,320,240).distributed,true);
pixels.fill(20);
for(const x of [25,75,125,175,225]) rectangle(x,110,3,4);
assert.equal(measureFlameStructure(pixels,320,240).distributed,false,'one row lacks spatial evidence');

// Anonymous measurements from the two failed weekend lamp photographs.
// Spatial evidence is tested independently with pixels in scene-structure tests.
for (const [boxArea, edgeDensity, upperEdgeDensity, uniformity, luminance, warmBrightRatio, darkRatio] of [
  [.12625,.1124349,.097890625,.5366797,51.78061,.0415104,.7086458],
  [.144140625,.1014583,.0795703,.5564844,50.34533,.0319271,.7499479],
]) {
  const sample = {
    reliable:false, number:null,
    paperGeometry:{usablePaper:false,rectangularPaper:false,boxArea,width:.42,height:.4,score:.068,fill:.44},
    visualMetrics:{edgeDensity,upperEdgeDensity,uniformity},
    sceneMetrics:{luminance,warmBrightRatio,darkRatio,flameStructure:{distributed:true}},
  };
  assert.equal(isLikelyScene(sample), true, 'distributed lamps must not become unreadable blessing sheets');
  assert.equal(isLikelyScene({...sample,reliable:true,number:123,evidence:{method:'photo-code-multi-crop-consensus'}}),false);
  assert.equal(isLikelyScene({...sample,paperGeometry:{...sample.paperGeometry,usablePaper:true,rectangularPaper:true}}),false);
}
console.log('Weekend role regression PASS');

// Anonymous measurements: a brighter lamp array rejected by the old dark-only
// entry gate, despite the downstream classifier already identifying lamps.
const brighterLamp = {
  reliable:false, number:null,
  paperGeometry:{left:0,top:.2833333333,width:1,height:.7166666667,
    score:.3098697917,fill:.4323764535,boxArea:.7166666667,
    usablePaper:false,rectangularPaper:false},
  visualMetrics:{edgeDensity:.1099739583,upperEdgeDensity:.0482942708,uniformity:.5548828125},
  sceneMetrics:{luminance:89.0851869583,warmBrightRatio:.1374479167,darkRatio:.4051041667,
    flameStructure:{count:130,columns:5,rows:6,spanX:.9940625,spanY:.5929924242,distributed:true}},
};
assert.equal(classifySceneVisualScore(brighterLamp.sceneMetrics),'scene-lamp');
assert.equal(isLikelyScene(brighterLamp),true,'a no-paper distributed lamp classification must reach scene assignment');
for(const [darkRatio,luminance,warmBrightRatio] of [[.33,105,.11],[.41,89,.137],[.58,78,.06],[.75,50,.032]]) {
  const sample={...brighterLamp,sceneMetrics:{...brighterLamp.sceneMetrics,darkRatio,luminance,warmBrightRatio}};
  assert.equal(classifySceneVisualScore(sample.sceneMetrics),'scene-lamp');
  assert.equal(isLikelyScene(sample),true,'entry and category must agree across lamp exposures');
}
for(const geometry of [{usablePaper:true,rectangularPaper:true},{usablePaper:true,rectangularPaper:false},{usablePaper:false,rectangularPaper:true}]) {
  assert.equal(isLikelyScene({...brighterLamp,paperGeometry:{...brighterLamp.paperGeometry,...geometry}}),false,'flames cannot overrule paper evidence');
}
assert.equal(isLikelyScene({...brighterLamp,sceneMetrics:{...brighterLamp.sceneMetrics,flameStructure:{distributed:false}}}),false);
assert.equal(isLikelyScene({...brighterLamp,sceneMetrics:{...brighterLamp.sceneMetrics,flameStructure:undefined}}),false);
assert.equal(isLikelyScene({...brighterLamp,reliable:true,number:123,evidence:{method:'photo-code-multi-crop-consensus'}}),false);
console.log('Brighter lamp role/category consistency PASS');

// Real anonymous counterexamples: paper-box detection failed on two sheets
// photographed among candles. Flame count alone must never decide their role.
for(const [width,top,height,fill,score,edgeDensity,upperEdgeDensity,uniformity,luminance,warmBrightRatio,darkRatio,count] of [
  [.9375,.2416666667,.5166666667,.3002956989,.1454557292,.1556380208,.1218098958,.4272916667,94.6204391667,.0974479167,.3652604167,22],
  [1,.5583333333,.4416666667,.5235259434,.2312239583,.245859375,.1831510417,.3915885417,93.7057331563,.1955208333,.3745833333,97],
]) {
  assert.equal(isLikelyScene({reliable:false,number:null,
    paperGeometry:{usablePaper:false,rectangularPaper:false,width,top,height,bottom:top+height,fill,score,boxArea:width*height},
    visualMetrics:{edgeDensity,upperEdgeDensity,uniformity},
    sceneMetrics:{luminance,warmBrightRatio,darkRatio,flameStructure:{count,distributed:true}},
  }),false,'candle-lit detailed sheets stay eligible for numbering even when paper detection fails');
}
assert.equal(isLikelyScene({...brighterLamp,visualMetrics:{...brighterLamp.visualMetrics,edgeDensity:undefined}}),false,'missing text evidence must not open the new route');
console.log('Candle-lit paper counterexamples PASS');
