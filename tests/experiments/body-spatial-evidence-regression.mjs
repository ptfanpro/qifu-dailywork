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

test('complete mixed-script fields retain real field position without inventing substring coordinates',()=>{
 const corpus=[page(1,[f('姓名：松柏青'),f('供灯：7盏',.4,.6)]),page(2,[f('姓名：海月明'),f('供灯：49盏')])];
 const out=spatialBodyCorrespondences(corpus,views([f('姓名:松柏青',.3,.4),f('供灯:7盏',.5,.7)]));
 assert.equal(out[0].pairs.length,2);assert.equal(out[1].pairs.length,0);
 assert.deepEqual(out[0].pairs.map(p=>p.pdfPoint),[[.2,.3],[.4,.6]]);
 assert.equal(spatialBodyCorrespondences(corpus,views([f('松柏青')]))[0].pairs.length,0,'not a guessed subfield location');
});
test('paired punctuation and quantity differences remain differences',()=>{
 const corpus=[page(1,[f('姓名：松柏青'),f('供灯：7盏')])],v=views([f('姓名:松柏青'),f('供灯:7盏')]);
 v[1].fields[0].text='姓名松柏青';v[1].fields[1].text='供灯:49盏';
 assert.equal(spatialBodyCorrespondences(corpus,v)[0].pairs.length,0);
 assert.equal(spatialBodyCorrespondences(corpus,views([f('姓名:\n松柏青'),f('供灯:\u20287盏')]))[0].pairs.length,0);
});
test('a field also contained elsewhere on the same page cannot invent a unique occurrence',()=>{
 const corpus=[page(1,[f('松柏青'),f('姓名：松柏青',.6,.6)])];
 assert.equal(spatialBodyCorrespondences(corpus,views([f('松柏青')]))[0].pairs.length,0);
});
test('a printed code cannot re-enter as independent body location evidence',()=>{
 for(const text of ['编号:263-1-95','编号：263－1－95','263-1-95','编号：２６３－１－９５','编号:263_1_95','编号:263—1—95']){
  assert.equal(spatialBodyCorrespondences([page(1,[f(text)])],views([f(text)]))[0].pairs.length,0);
 }
});

test('an additional occurrence in either photo view prevents positional disambiguation',()=>{
 const corpus=[page(1,[f('松柏青')])];
 for(const which of [0,1]){
  const v=views([f('松柏青')]);
  v[which].fields.push({...f('姓名：松柏青',.5,.7),regionIndex:1});
  assert.equal(spatialBodyCorrespondences(corpus,v)[0].pairs.length,0);
 }
 const repeated=page(1,[f('松柏青'),f('松柏青松柏青',.5,.7)]);
 assert.equal(spatialBodyCorrespondences([repeated],views([f('松柏青')]))[0].pairs.length,0);
});
