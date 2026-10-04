import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {resolveBlessingUploadResponseCount,resolveBlessingUploadResponseOutcome,watchBlessingUploadTransport} from '../src/site.mjs';

for (const payload of [
  {result:{state:0,message:'12'}},
  {result:{state:false,message:'12'}},
  {result:{state:-1,message:'12'}},
  {result:{state:2,message:'12'}},
  {result:{ok:false,message:'12'}},
  {success:false,uploadedCount:12},
  {result:{state:1,message:'成功'},ok:false,count:12},
]) {
  const outcome=resolveBlessingUploadResponseOutcome(payload,12);
  assert.equal(outcome.category,'business-failure');
  assert.equal(outcome.uploadedCount,undefined,'explicit failure must override matching numbers');
  assert.equal(resolveBlessingUploadResponseCount(payload,12).uploadedCount,undefined);
}
for (const payload of [
  {result:{state:1,message:'成功'}},
  {message:'成功'},
  {message:'上传成功！'},
  '成功',
]) {
  assert.deepEqual(resolveBlessingUploadResponseOutcome(payload,12),{
    uploadedCount:undefined,numericMessages:[],category:'success-without-count',
  });
}
assert.equal(resolveBlessingUploadResponseOutcome({result:{state:1,message:'12'}},12).uploadedCount,12);
assert.equal(resolveBlessingUploadResponseOutcome({result:{message:'12'}},12).uploadedCount,12);
assert.equal(resolveBlessingUploadResponseOutcome({code:1,orderId:12},12).category,'unrecognized-response');
assert.equal(resolveBlessingUploadResponseOutcome({result:{state:1,message:'9'}},12).uploadedCount,undefined);

const request=()=>({method:()=> 'POST',url:()=> 'http://fixture.test/blessing/mind/uploadPic/name'});
const response=(owner,body,status=200)=>({request:()=>owner,url:owner.url,
  ok:()=>status>=200&&status<300,status:()=>status,text:async()=>JSON.stringify(body)});
const page=new EventEmitter();
const stages=[];
const watcher=watchBlessingUploadTransport(page,12,(stage,detail)=>stages.push({stage,detail}));
const stale=request(),current=request();
page.emit('response',response(stale,{result:{state:1,message:'12'}}));
assert.equal(await watcher.uploadedCount(),undefined);
assert.equal(watcher.state.responseCount,0,'a request started before this watcher cannot provide its receipt');
page.emit('request',current);
page.emit('response',response(stale,{result:{state:1,message:'12'}}));
page.emit('response',response(current,{result:{state:1,message:'成功'}}));
assert.equal(await watcher.uploadedCount(),undefined,'success without a count is evidence for readback, not a fabricated count');
assert.equal(watcher.state.responseCount,1);
assert.deepEqual(stages.at(-1),{stage:'transport-outcome',detail:{category:'success-without-count',status:200,numericCountSeen:false}});
assert.equal(JSON.stringify(stages).includes('成功'),false,'persisted transport diagnostics contain only outcome categories');
watcher.stop();
assert.equal(page.listenerCount('request'),0);
assert.equal(page.listenerCount('response'),0);

for (const [body,status] of [[{result:{state:0,message:'12'}},200],[{result:{state:1,message:'12'}},500]]) {
  const p=new EventEmitter(),w=watchBlessingUploadTransport(p,12),r=request();
  p.emit('request',r);p.emit('response',response(r,body,status));
  assert.equal(await w.uploadedCount(),undefined);
  w.stop();
}
const stalledPage=new EventEmitter();
const stalled=watchBlessingUploadTransport(stalledPage,12);
const stalledRequest=request();
stalledPage.emit('request',stalledRequest);
stalledPage.emit('response',{...response(stalledRequest,null),text:()=>new Promise(()=>{})});
let deadline;
try {
  const outcome=await Promise.race([
    stalled.uploadedCount().then(value=>({returned:true,value})),
    new Promise(resolve=>{deadline=setTimeout(()=>resolve({returned:false}),1500)}),
  ]);
  assert.deepEqual(outcome,{returned:true,value:undefined},'an unfinished body must release polling before its deadline');
} finally {clearTimeout(deadline)}
stalled.stop();
const concurrentPage=new EventEmitter();
const concurrent=watchBlessingUploadTransport(concurrentPage,12);
const otherRequest=request(),ownRequest=request();
concurrentPage.emit('request',otherRequest);concurrentPage.emit('request',ownRequest);
concurrentPage.emit('response',response(otherRequest,{result:{state:1,message:'12'}}));
assert.equal(await concurrent.uploadedCount(),undefined,'concurrent uploads cannot lend each other a matching receipt');
concurrent.stop();
console.log('Upload outcome regression PASS: success without counts, explicit failures, request correlation and bounded body wait');
