import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readDetectedCodes,validDetectedCodeReview} from '../src/detected-code-reader.mjs';
import {summarizeDetectedCodeRead} from '../src/photo-prepare.mjs';

const region={left:.2,top:.2,width:.3,height:.03,score:.99};
const original={info:{width:400,height:200,channels:3},data:Buffer.alloc(400*200*3,255)};
const good={text:'269-1-168',confidence:.95},confirmed={text:'269-1-168',confidence:85},blank={text:'',confidence:0};
async function collect(word=[confirmed,confirmed],initial=[blank,blank,blank,blank],options={}) {
  let calls=0,reset=0,terminated=false;const modes=[];
  const worker={
    recognize:async(bytes,opts)=>{modes.push(opts?.tessedit_pageseg_mode||'7');const value=[...initial,...word][calls++]||blank;if(value instanceof Error)throw value;return {data:value};},
    setParameters:async(params)=>{assert.equal(params.tessedit_pageseg_mode,'7');reset++;if(options.resetFails)throw Error('private reset details');},
    terminate:async()=>{terminated=true;},
  };
  const run=()=>readDetectedCodes({detect:async()=>({regions:[region],original})},null,Buffer.alloc(0),'269',{worker,recognizeLine:async()=>good});
  return {run,get calls(){return calls;},modes,get reset(){return reset;},get terminated(){return terminated;}};
}

test('otherwise unconfirmed detected code gets one whole-token review on both original views',async()=>{
  const trial=await collect(),read=await trial.run();
  assert.equal(read.confirmed,168);
  assert.equal(trial.calls,6);
  assert.deepEqual(trial.modes,['7','7','7','7','8','8']);
  assert.equal(trial.reset,1);
  assert.equal(read.segmentationReview.completed,true);
  assert.equal(read.independent.filter(o=>o.preprocessing==='gray-96-word-v1').length,2);
  assert.equal(summarizeDetectedCodeRead(read,'269',new Set([168])).number,168);
  assert.equal(summarizeDetectedCodeRead(read,'269',new Set([169])).number,null);
  assert.equal(read.bindingVerified,false);
});

test('word review cannot vote away contrary originals or expand already confirmed reads',async()=>{
  for(const initial of [[confirmed,confirmed],[{text:'268-1-168',confidence:0},confirmed],[{text:'269-1-169',confidence:0},confirmed]]) {
    const trial=await collect(undefined,initial),read=await trial.run();
    assert.equal(trial.calls,2);assert.equal(read.segmentationReview,undefined);assert.equal(trial.reset,0);
  }
});

test('word review keeps opposite/partial/failed evidence and restores mode even after a read error',async()=>{
  for(const word of [[{text:'269-1-169',confidence:0},confirmed],[{text:'268-1-168',confidence:0},confirmed],
    [{text:'269-1-16 8',confidence:90},confirmed],[new Error('private image details'),confirmed],[blank,confirmed]]) {
    const trial=await collect(word),read=await trial.run();
    // A blank view alone can now reach the fixed final raw-line review;
    // contrary/partial/error evidence must still stop before that review.
    const rawReviewAllowed=word[0]===blank;
    assert.equal(trial.calls,rawReviewAllowed?8:6);assert.equal(trial.reset,rawReviewAllowed?2:1);assert.equal(read.confirmed,null);
    assert.equal(Boolean(read.rawLineReview),rawReviewAllowed);
    assert.equal(summarizeDetectedCodeRead(read,'269',new Set([168])).number,null);
    assert.ok(!JSON.stringify(read).includes('private image'));
  }
});

test('word-review receipts bind both paddings, exact crops, engine and recipe',async()=>{
  const trial=await collect(),read=await trial.run();assert.ok(read.segmentationReview);
  for(const mutate of [r=>r.segmentationReview.completed=false,r=>r.segmentationReview.restoreCompleted=false,
    r=>r.segmentationReview.readings.pop(),r=>r.segmentationReview.recipe='unbounded',
    r=>r.segmentationReview.readings[0].crop.left++,r=>r.segmentationReview.readings[0].padding=.3,
    r=>r.segmentationReview.readings[0]=null,r=>r.segmentationReview.attemptedRegions=5,
    r=>r.independent.at(-1).preprocessing='unknown',r=>delete r.segmentationReview]) {
    const broken=structuredClone(read);mutate(broken);
    assert.equal(validDetectedCodeReview(broken),false);
    assert.equal(summarizeDetectedCodeRead(broken,'269',new Set([168])).number,null);
  }
});

test('failed parameter restoration destroys the worker instead of contaminating the next photo',async()=>{
  const trial=await collect(undefined,undefined,{resetFails:true});
  await assert.rejects(trial.run(),/detected-code-settings-restore-failed/);
  assert.equal(trial.terminated,true);
});
