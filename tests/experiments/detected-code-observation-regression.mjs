import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readDetectedCodes} from './text-regions.mjs';
const region={left:.3,top:.2,width:.2,height:.02,score:.95};
const original={info:{width:1000,height:500,channels:3},data:Buffer.alloc(1000*500*3,255)};
const synthetic=(paddle,tess,{regions=[region],...options}={})=>{
 let a=0,b=0;
 return readDetectedCodes({detect:async()=>({regions,original})},null,Buffer.alloc(0),'269',{
  recognizeLine:async()=>{const v=paddle[a++];if(v instanceof Error)throw v;return v||{text:'',confidence:0};},
  worker:{recognize:async()=>{const v=tess[b++];if(v instanceof Error)throw v;return {data:v||{text:'',confidence:0}};}},...options,
 });
};
const good={text:'269-1-68',confidence:.95},goodT={text:'269-1-68',confidence:90};
test('detected two-view diagnostic preserves foreign prefix even at low score',async()=>{
 const r=await synthetic([good,good,{text:'268-1-68',confidence:.2}],
  [goodT,goodT],{regions:[region,{...region,top:.5}]});
 assert.equal(r.confirmed,null,'a complete contrary prefix must survive expected-prefix/score filters');
 assert.ok(r.observations.some(o=>o.fullCode==='268-1-68'));
 assert.equal(r.bindingVerified,false);
});
test('both engines read each view, including portable blank and second-view disagreement',async()=>{
 const r=await synthetic([good,good,{text:'',confidence:0}],
  [goodT,goodT,{text:'269-1-6900',confidence:12}],{regions:[region,{...region,top:.5}]});
 assert.equal(r.confirmed,null);
 assert.ok(r.independent.some(o=>o.fullCode==='269-1-6900'));
 assert.equal(r.readings.length,8);
});
test('full observations retain all code strings and pixel geometry, never customer text',async()=>{
 const r=await synthetic([good,good],[goodT,goodT]);
 assert.equal(r.confirmed,68);
 assert.equal(r.observations.length,2);assert.equal(r.independent.length,2);
 assert.ok(r.observations.every(o=>o.fullCode==='269-1-68'&&o.physicalCodeExtent==='unverified'));
 assert.deepEqual(r.readings[0].crop,{left:295,top:95,width:210,height:20});
 assert.equal(r.bindingVerified,false);assert.equal(r.coverage.completed,true);
 const privateText=await synthetic([{text:'synthetic private body',confidence:.99}],[]);
 assert.ok(!JSON.stringify(privateText).includes('synthetic private body'));
 assert.equal(privateText.confirmed,null);
});
test('tail-only, incomplete tail, reader failure and budget exhaustion cannot confirm',async()=>{
 const tail=await synthetic([{text:'68',confidence:.99},{text:'68',confidence:.99}],[goodT,goodT]);
 assert.equal(tail.confirmed,null);
 const split=await synthetic([good,{text:'269-1-6 8',confidence:.99}],[goodT,goodT]);
 assert.equal(split.confirmed,null);assert.equal(split.incompleteTailObserved,true);
 const failure=await synthetic([good,new Error('private failure detail')],[goodT,goodT]);
 assert.equal(failure.confirmed,null);assert.equal(failure.coverage.completed,false);
 assert.ok(!JSON.stringify(failure).includes('private failure detail'));
 assert.ok(failure.observations.some(o=>o.fullCode==='269-1-68'));
 const budget=await synthetic([good,good],[goodT,goodT],{regions:[region,{...region,top:.5}],maxRegions:1});
 assert.equal(budget.confirmed,null);assert.equal(budget.coverage.completed,false);
});
