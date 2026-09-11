import test from 'node:test';
import assert from 'node:assert/strict';
import {validLayoutResponse,isFreshLayoutObservation,matchPrintedLayouts} from '../src/layout-runtime.mjs';
const sha='a'.repeat(64),p='b'.repeat(64),q='c'.repeat(64);
function fixture(){
 const request={operation:'match',pages:[{id:p+':1',sha256:p}],photos:[{id:q,sha256:q}]};
 const result={schemaVersion:1,complete:true,operation:'match',requestSha256:sha,mayAssignNumber:false,
  mayClearCodeConflict:false,coordinateFrame:'printed-ink',runtime:{python:'3.12.14',numpy:'2.3.5',opencv:'4.13.0',
  isolated:true,noSite:true,localImports:true,localSearchPaths:true},results:[{id:q,imageSha256:q,shape:[400,600],
   pages:[{id:p+':1',imageSha256:p,shape:[400,600],evidence:{candidate:true,coordinateFrame:'printed-ink',
    paperVerified:false,foregroundVerified:false,physicalCodeExtentVerified:false,bindingVerified:false,
    mayClearCodeConflict:false,mayAssignNumber:false,mayUploadScene:false}}]}]};
 return {request,result};
}
test('layout protocol binds exact image set, runtime and request but cannot authorize assignment',()=>{
 const {request,result}=fixture();assert.equal(validLayoutResponse(result,request,sha),true);
 assert.equal(isFreshLayoutObservation(result),false,'a serialized response is not a fresh worker observation');
 for(const mutate of [r=>{r.complete=false;},r=>{r.requestSha256=p;},r=>{r.results=[];},
  r=>{r.results[0].pages=[];},r=>{r.results[0].id=p;},r=>{r.results[0].imageSha256=p;},
  r=>{r.results[0].pages[0].id=p+':2';},r=>{r.results[0].pages[0].imageSha256=q;},
  r=>{r.results[0].shape=[400,600.1];},r=>{r.results[0].pages[0].shape=[400,1801];},
  r=>{r.runtime.opencv='old';},r=>{r.runtime.localImports=false;},r=>{r.runtime.noSite=false;},
  r=>{r.mayAssignNumber=true;},r=>{r.results[0].pages[0].evidence.mayClearCodeConflict=true;},
  r=>{r.results[0].pages[0].evidence.bindingVerified=true;},r=>{r.coordinateFrame='canvas';}]){
   const bad=structuredClone(result);mutate(bad);assert.equal(validLayoutResponse(bad,request,sha),false);
 }
 assert.equal(validLayoutResponse(null,request,sha),false);
 assert.equal(validLayoutResponse(result,request,undefined),false);
});
test('layout rejects malformed input before locating any runtime or creating image files',async()=>{
 for(const change of [{pages:[],photos:[]},{pages:Array(33).fill({}),photos:[{}]},
  {pages:[{id:p,bytes:Buffer.from('not PNG')}],photos:[{id:q,bytes:Buffer.from('not PNG')}]}]){
  await assert.rejects(matchPrintedLayouts('does-not-exist',change),/budget|image input/i);
 }
});
