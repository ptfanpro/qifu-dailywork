import assert from 'node:assert/strict';
import { isLikelyScene } from '../src/photo-prepare.mjs';
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
