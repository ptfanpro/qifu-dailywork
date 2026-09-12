// Exercise the actual app-local production service, not synthetic rule scores.
// Generated pixels are not a classification/annual/business accuracy test.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createSemanticSceneService} from '../src/scene-semantic-service.mjs';
import {SEMANTIC_MODEL_SHA256,SEMANTIC_VIEWS} from '../src/scene-semantic-reader.mjs';
import {SEMANTIC_HEAD_SHA256} from '../src/scene-semantic-policy.mjs';
const require=createRequire(import.meta.url),hash=b=>crypto.createHash('sha256').update(b).digest('hex');

export async function smokeSemanticPackage(appRoot) {
  assert(typeof appRoot==='string'&&path.isAbsolute(appRoot),'Explicit absolute app package required');
  const source=await require('sharp')({create:{width:320,height:240,channels:3,background:'#808080'}}).png().toBuffer();
  const service=createSemanticSceneService({appRoot});
  try {
    for(let i=0;i<2;i++) {
      const result=await service.read(source);
      assert.notEqual(result.status,'unavailable','App-local semantic assets/runtime unavailable; package cannot pass');
      assert.equal(result.inputSha256,hash(source));
      assert.equal(result.encoderSha256,SEMANTIC_MODEL_SHA256);assert.equal(result.headSha256,SEMANTIC_HEAD_SHA256);
      assert.deepEqual(result.views.map(v=>v.view),SEMANTIC_VIEWS);
      for(const view of result.views) {
        assert.equal(view.scores.length,4);assert(view.scores.every(Number.isFinite));assert(Number.isFinite(view.gap));
      }
      assert.equal(result.mayAuthorizeUpload,false);assert.equal(result.mayClearCodeConflict,false);
    }
    assert.deepEqual(service.stats,{reads:2,unavailable:0,modelLoads:1});
    return {passed:true,reads:2,modelLoads:1,encoderSha256:SEMANTIC_MODEL_SHA256,headSha256:SEMANTIC_HEAD_SHA256,
      actualOcrAccuracy:false,businessAcceptance:false,releaseAccepted:false};
  } finally {await service.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await smokeSemanticPackage(process.argv[2])));}
  catch {console.error('Semantic package smoke failed: required app-local assets/runtime did not produce verified observations.');process.exitCode=1;}
}
