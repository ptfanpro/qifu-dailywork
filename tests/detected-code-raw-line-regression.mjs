import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readDetectedCodes,validDetectedCodeReview} from '../src/detected-code-reader.mjs';
import {summarizeDetectedCodeRead} from '../src/photo-prepare.mjs';

const region={left:.2,top:.2,width:.3,height:.03,score:.99};
const original={info:{width:400,height:200,channels:3},data:Buffer.alloc(400*200*3,255)};
const good={text:'269-1-168',confidence:.95},confirmed={text:'269-1-168',confidence:85},blank={text:'',confidence:0};
async function collect(raw=[confirmed,confirmed],earlier=Array(6).fill(blank),resetFails=false) {
  let calls=0,resets=0,terminated=false;const modes=[];
  const worker={
    recognize:async(bytes,opts)=>{modes.push(opts?.tessedit_pageseg_mode||'7');const value=[...earlier,...raw][calls++]||blank;if(value instanceof Error)throw value;return {data:value};},
    setParameters:async(p)=>{assert.equal(p.tessedit_pageseg_mode,'7');resets++;if(resetFails&&resets===2)throw Error('private reset details');},
    terminate:async()=>{terminated=true;},
  };
  return {run:()=>readDetectedCodes({detect:async()=>({regions:[region],original})},null,Buffer.alloc(0),'269',{worker,recognizeLine:async()=>good}),
    get calls(){return calls;},get resets(){return resets;},get terminated(){return terminated;},modes};
}

test('one fixed raw-line review recovers an otherwise unconfirmed full code without changing thresholds',async()=>{
  const trial=await collect(),read=await trial.run();
  assert.equal(read.confirmed,168);
  assert.equal(trial.calls,8);assert.equal(trial.resets,2);
  assert.deepEqual(trial.modes,['7','7','7','7','8','8','13','13']);
  assert.equal(read.rawLineReview.completed,true);assert.equal(read.rawLineReview.restoreCompleted,true);
  assert.equal(read.independent.filter(o=>o.preprocessing==='red-96-raw-line-v1').length,2);
  assert.equal(read.readings.filter(o=>o.engine==='tesseract'&&o.codeCount===0).length,2);
  assert.equal(summarizeDetectedCodeRead(read,'269',new Set([168])).number,168);
  assert.equal(summarizeDetectedCodeRead(read,'269',new Set([169])).number,null);
  assert.equal(read.bindingVerified,false);
});

test('raw-line review never runs after confirmation, previous contradictions, fragments or errors',async()=>{
  for(const earlier of [[confirmed,confirmed],[blank,blank,confirmed,confirmed],
    [blank,blank,blank,blank,confirmed,confirmed],
    [blank,blank,blank,blank,{text:'268-1-168',confidence:0},blank],
    [blank,blank,blank,blank,{text:'269-1-169',confidence:0},blank],
    [blank,blank,blank,blank,{text:'269-1-16 8',confidence:80},blank],
    [blank,blank,blank,blank,new Error('private details'),blank]]) {
    const trial=await collect(undefined,earlier),read=await trial.run();
    assert.equal(read.rawLineReview,undefined);assert.ok(!trial.modes.includes('13'));
  }
});

test('raw-line failures retain contrary and partial results; blanks never become confirmations',async()=>{
  for(const raw of [[{text:'268-1-168',confidence:0},confirmed],[{text:'269-1-169',confidence:0},confirmed],
    [{text:'269-1-16 8',confidence:80},confirmed],[new Error('private image text'),confirmed],
    [blank,confirmed],[{...confirmed,confidence:29},{...confirmed,confidence:29}]]) {
    const trial=await collect(raw),read=await trial.run();
    assert.equal(trial.calls,8);assert.equal(trial.resets,2);assert.equal(read.confirmed,null);
    assert.equal(summarizeDetectedCodeRead(read,'269',new Set([168])).number,null);
    assert.ok(!JSON.stringify(read).includes('private image text'));
  }
});

test('raw-line receipt requires both original crops and the completed preceding reviews',async()=>{
  const trial=await collect(),read=await trial.run();assert.ok(read.rawLineReview);
  for(const mutate of [r=>delete r.rawLineReview,r=>delete r.segmentationReview,r=>r.segmentationReview.completed=false,
    r=>r.rawLineReview.completed=false,r=>r.rawLineReview.restoreCompleted=false,r=>r.rawLineReview.readings.pop(),
    r=>r.rawLineReview.readings[0].crop.left++,r=>r.rawLineReview.readings[0].padding=.3,
    r=>r.rawLineReview.readings[0].errorCode='failed',r=>r.rawLineReview.recipe='unknown',
    r=>r.independent.at(-1).preprocessing='unknown',r=>r.rawLineReview.attemptedRegions=5]) {
    const broken=structuredClone(read);mutate(broken);
    assert.equal(validDetectedCodeReview(broken),false);
    assert.equal(summarizeDetectedCodeRead(broken,'269',new Set([168])).number,null);
  }
});

test('raw-line restore failure terminates the worker before another photo can use it',async()=>{
  const trial=await collect(undefined,undefined,true);
  await assert.rejects(trial.run(),/detected-code-settings-restore-failed/);
  assert.equal(trial.terminated,true);
});
