import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readDetectedCodes} from '../src/detected-code-reader.mjs';
import {summarizeDetectedCodeRead} from '../src/photo-prepare.mjs';
import {sealDetectionRow,canReuseDetectionRow} from './experiments/detection-cache.mjs';

const region={left:.3,top:.2,width:.2,height:.02,score:.95};
const original={info:{width:1000,height:500,channels:3},data:Buffer.alloc(1000*500*3,255)};
const good={text:'269-1-168',confidence:.96},goodT={text:'269-1-168',confidence:86};
async function collect(paddle,tesseract,regions=[region]) {
  let a=0,b=0;
  const read=await readDetectedCodes({detect:async()=>({regions,original})},null,Buffer.alloc(0),'269',{
    recognizeLine:async()=>{const r=paddle[a++];if(r instanceof Error)throw r;return r||{text:'',confidence:0};},
    worker:{recognize:async()=>{const r=tesseract[b++];if(r instanceof Error)throw r;return {data:r||{text:'',confidence:0}};}},
  });
  return {read,paddleCalls:a,tesseractCalls:b};
}

test('a blank second engine gets one bounded review before an otherwise consistent code is rejected',async()=>{
  const {read,tesseractCalls}=await collect([good,good],[{text:'',confidence:0},{text:'',confidence:0},goodT,goodT]);
  assert.equal(tesseractCalls,4,'read both existing paddings once more, not an unbounded crop search');
  assert.equal(read.readings.filter(r=>r.engine==='tesseract'&&r.codeCount===0).length,2,'retain both original blank reads');
  assert.equal(read.review.completed,true);
  assert.equal(read.review.attemptedRegions,1);
  assert.equal(read.confirmed,168);
  assert.equal(summarizeDetectedCodeRead(read,'269',new Set([168])).number,168);
  assert.equal(summarizeDetectedCodeRead(read,'269',new Set([169])).number,null,'review does not infer a missing PDF number');
  assert.equal(read.bindingVerified,false);
});

test('already confirmed and complete contrary observations do not start extra retries',async()=>{
  const confirmed=await collect([good,good],[goodT,goodT]);
  assert.equal(confirmed.tesseractCalls,2);
  for(const contrary of [{text:'268-1-168',confidence:0},{text:'269-1-169',confidence:0}]) {
    const result=await collect([good,good],[contrary,goodT,goodT,goodT]);
    assert.equal(result.tesseractCalls,2);
    assert.equal(result.read.confirmed,null);
    assert.ok(result.read.independent.some(o=>o.fullCode===contrary.text));
  }
});

test('review preserves new disagreement, tail fragments, errors and blank results as failures',async()=>{
  for(const retry of [
    [{text:'269-1-169',confidence:1},goodT],
    [{text:'268-1-168',confidence:1},goodT],
    [{text:'269-1-16 8',confidence:90},goodT],
    [new Error('synthetic private failure'),goodT],
    [{text:'',confidence:0},goodT],
  ]) {
    const {read,tesseractCalls}=await collect([good,good],[{text:'',confidence:0},{text:'',confidence:0},...retry]);
    assert.equal(tesseractCalls,4);
    assert.equal(read.confirmed,null);
    assert.equal(summarizeDetectedCodeRead(read,'269',new Set([168])).number,null);
    assert.ok(!JSON.stringify(read).includes('synthetic private failure'));
  }
});

test('review cannot bypass failed first-pass coverage or missing independent engines',async()=>{
  const error=await collect([good,new Error('private')],[goodT,goodT,goodT,goodT]);
  assert.equal(error.tesseractCalls,2);assert.equal(error.read.confirmed,null);
  const noCode=await collect([],[]);
  assert.equal(noCode.tesseractCalls,2);assert.equal(noCode.read.confirmed,null);
  const fragment=await collect([good,{text:'269-1-16 8',confidence:.9}],[]);
  assert.equal(fragment.tesseractCalls,2);assert.equal(fragment.read.confirmed,null);
});

test('more than four code-bearing regions are not silently truncated to a convenient subset',async()=>{
  const {read,tesseractCalls}=await collect(Array(10).fill(good),Array(20).fill(null),
    Array.from({length:5},(_,i)=>({...region,top:.1+i*.1})));
  assert.equal(tesseractCalls,10);assert.equal(read.confirmed,null);assert.equal(read.review,undefined);
});

test('saved incomplete or altered supplemental reads cannot authorize a plan or a resume',async()=>{
  const {read}=await collect([good,good],[null,null,goodT,goodT]);
  const identity={sourceVersion:'a'.repeat(64),modelSha256:'b'.repeat(64),date:'2026-01-02',sha256:'c'.repeat(64)};
  const sealed=value=>sealDetectionRow({...value,sha256:identity.sha256,sourceUnchanged:true},identity);
  assert.equal(canReuseDetectionRow(sealed(read),identity,identity.sha256),true);
  for(const mutate of [
    r=>r.review.completed=false,r=>r.review.readings.pop(),r=>r.review.recipe='unknown',
    r=>r.review.readings[0].crop.left++,r=>r.review.attemptedRegions=9,
    r=>r.review.readings[0].errorCode='contrast-reader-unavailable',
    r=>r.review.readings[0].padding=.2,
  ]) {
    const broken=structuredClone(read);mutate(broken);
    assert.equal(summarizeDetectedCodeRead(broken,'269',new Set([168])).number,null);
    assert.equal(canReuseDetectionRow(sealed(broken),identity,identity.sha256),false);
  }
});
