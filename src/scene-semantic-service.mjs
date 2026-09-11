import path from 'node:path';
import crypto from 'node:crypto';
import {createSemanticRoleReader} from './scene-semantic-reader.mjs';
import {SEMANTIC_HEAD_SHA256,semanticRole} from './scene-semantic-policy.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

export function semanticAssetPaths(appRoot) {
  return {modelFile:path.join(appRoot,'models/scene-semantic-v1/vision_model_int8.onnx'),
    headFile:path.join(appRoot,'models/scene-semantic-v1/role-head.json')};
}

// One lazy, local-only session per planning run. No initialization at GUI
// startup, no online fallback, no retry storm when portable assets are absent.
// assetPaths/readerFactory are explicit offline test seams, not user settings.
export function createSemanticSceneService({appRoot,assetPaths=semanticAssetPaths(appRoot),
  readerFactory=createSemanticRoleReader,runtimeFingerprint=null}) {
  let pending=null,closed=false,busy=false;
  const stats={reads:0,unavailable:0,modelLoads:0};
  return {stats,async read(source) {
    if(closed||busy)throw Error('Semantic planning session is closed or busy');
    if(!Buffer.isBuffer(source))throw Error('Semantic planning requires image bytes');
    busy=true;
    const bytes=Buffer.from(source),inputSha256=hash(bytes);
    try {
      if(!pending) {
        stats.modelLoads++;
        pending=Promise.resolve().then(()=>readerFactory({appRoot,...assetPaths,expectedHeadSha256:SEMANTIC_HEAD_SHA256}));
      }
      stats.reads++;
      const result=await (await pending).read(bytes);
      if(result?.inputSha256!==inputSha256)throw Error('Semantic source identity changed');
      // Unknown and mixed observations remain unknown; retain both view scores.
      // Never turn unavailable/invalid evidence into the old colour heuristic.
      if(result.candidate!==null&&!semanticRole(result,inputSha256))throw Error('Invalid semantic observation');
      return {...result,runtimeFingerprint};
    }catch {
      stats.unavailable++;
      return {schemaVersion:1,status:'unavailable',errorCode:'semantic-reader-unavailable',inputSha256,
        candidate:null,runtimeFingerprint,mayAuthorizeUpload:false,mayClearCodeConflict:false};
    }finally{busy=false;}
  },async release() {
    if(busy)throw Error('Semantic planning read is still running');
    if(closed)return;closed=true;
    await (await pending?.catch(()=>null))?.release();
  }};
}
