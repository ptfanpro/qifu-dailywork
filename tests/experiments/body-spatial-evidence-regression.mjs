import test from 'node:test';import assert from 'node:assert/strict';
import {spatialBodyCorrespondences,pdfTextItemCenter} from './body-spatial-evidence.mjs';
const page=(n,fields)=>({pdfSha256:'a'.repeat(64),pageNumber:n,fields});
const f=(text,x=.2,y=.3)=>({text,x,y});
const views=fields=>['chinese-detected-0.35','chinese-detected-0.65'].map(view=>({view,errors:0,truncated:false,fields:fields.map((r,regionIndex)=>({...r,regionIndex}))}));

test('text axes are transformed before page viewport including ninety-degree source layout',()=>{
 const ordinary=pdfTextItemCenter({transform:[12,0,0,12,10,20],width:40,height:12},{transform:[1,0,0,-1,0,100],width:100,height:100});
 assert.deepEqual(ordinary,{x:.3,y:.74});
 const rotated=pdfTextItemCenter({transform:[0,12,-12,0,212,94.5],width:36,height:12},{transform:[0,1,1,0,0,0],width:842,height:595});
 assert.deepEqual(rotated,{x:112.5/842,y:206/595});
 assert.deepEqual(pdfTextItemCenter({transform:[-12,0,0,-12,80,50],width:40,height:12},{transform:[1,0,0,-1,0,100],width:100,height:100}),{x:.6,y:.56});
});
test('invalid, singular and off-page PDF coordinates never become clipped matching points',()=>{
 const item={transform:[12,0,0,12,10,20],width:40,height:12},viewport={transform:[1,0,0,-1,0,100],width:100,height:100};
 for(const bad of [{...item,height:0},{...item,transform:[0,0,0,0,10,20]},{...item,transform:[12,0,0,12,100,20]},{...item,width:NaN}])assert.equal(pdfTextItemCenter(bad,viewport),null);
 assert.equal(pdfTextItemCenter(item,{...viewport,transform:[0,0,0,0,0,0]}),null);
});

test('whole unique field pairs retain exact positions and expose no raw text',()=>{
 const result=spatialBodyCorrespondences([page(1,[f('松柏青')]),page(2,[f('海月明')])],views([f('海月明',.6,.7)]));
 assert.equal(result[0].pairs.length,0);assert.equal(result[1].pairs.length,1);
 assert.deepEqual(result[1].pairs[0].pdfPoint,[.2,.3]);assert.deepEqual(result[1].pairs[0].photoPoint,[.6,.7]);
 assert.equal(result[1].mayAssign,false);assert.equal(result[1].mayClearCodeConflict,false);assert.doesNotMatch(JSON.stringify(result),/海月明|松柏青/);
});
test('shared, substring, duplicate and split-field observations are not unique correspondences',()=>{
 const corpus=[page(1,[f('海月明')]),page(2,[f('海月明祈福')])];assert(corpus);
 assert.equal(spatialBodyCorrespondences(corpus,views([f('海月明')]))[0].pairs.length,0);
 for(const fields of [[f('海月明'),f('海月明',.5,.6)],[f('海月\n明')]])assert.equal(spatialBodyCorrespondences([corpus[0]],views(fields))[0].pairs.length,0);
 assert.equal(spatialBodyCorrespondences([page(1,[f('海月明'),f('海月明',.5,.6)])],views([f('海月明')]))[0].pairs.length,0);
 assert.equal(spatialBodyCorrespondences([page(1,[f('海'),f('月'),f('明')])],views([f('海月明')]))[0].pairs.length,0);
});
test('different views cannot supply a synthetic paired region or position',()=>{
 for(const mutate of [v=>v[1].fields[0].text='其他名字',v=>v[1].fields[0].regionIndex=1,v=>v[1].fields[0].x=.21]){
   const observed=views([f('松柏青')]);mutate(observed);assert.equal(spatialBodyCorrespondences([page(1,[f('松柏青')])],observed)[0].pairs.length,0);
 }
});
test('source identity, failed views, duplicate regions and invalid positions fail closed',()=>{
 const corpus=[page(1,[f('松柏青')])];assert.throws(()=>spatialBodyCorrespondences([...corpus,...corpus],views([f('松柏青')])));
 for(const mutate of [v=>v.pop(),v=>v[0].errors=1,v=>v[1].truncated=true,v=>v[0].fields[0].x=NaN,
   v=>v[0].fields.push({...v[0].fields[0]}),v=>v[0].fields[0].y=1.01]){const v=views([f('松柏青')]);mutate(v);assert.throws(()=>spatialBodyCorrespondences(corpus,v));}
});
