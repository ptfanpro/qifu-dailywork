// Local semantic observations only. No OCR/page identity, order decisions,
// credentials, downloads, model training, or caller-supplied expected category.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {prepareSemanticPixels,SEMANTIC_PIXEL_RECIPE} from './scene-semantic-pixels.mjs';
const require=createRequire(import.meta.url);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const SEMANTIC_MODEL_SHA256='0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70';
export const SEMANTIC_VIEWS=Object.freeze(['center-crop','full-frame']);
const ROLES=Object.freeze(['paper','lamp','water','mixed-scene']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const finiteArray=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(x=>typeof x==='number'&&Number.isFinite(x));
const ownedHeads=new WeakSet();
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

export function loadSemanticHead(bytes,expectedSha256){
  if(!Buffer.isBuffer(bytes)||bytes.length>2_000_000||!/^[a-f0-9]{64}$/.test(expectedSha256||'')||hash(bytes)!==expectedSha256)
    throw Error('Semantic head integrity mismatch');
  const head=JSON.parse(bytes.toString('utf8'));
  if(head.schemaVersion!==1||head.encoderSha256!==SEMANTIC_MODEL_SHA256||head.dimensions!==768||head.minGap!==.15
    ||!same(head.roles,ROLES)||!same(head.views,SEMANTIC_VIEWS)||!Array.isArray(head.heads)||head.heads.length!==2)
    throw Error('Unexpected semantic head contract');
  for(let i=0;i<2;i++){
    const h=head.heads[i];
    if(h?.view!==SEMANTIC_VIEWS[i]||!finiteArray(h.mean,768)||!finiteArray(h.bias,4)
      ||!Array.isArray(h.weights)||h.weights.length!==768||!h.weights.every(row=>finiteArray(row,4)))
      throw Error('Incomplete semantic head');
  }
  const result=freeze({...head,sha256:expectedSha256});ownedHeads.add(result);return result;
}
export function scoreSemanticViews(head,views){
  if(!ownedHeads.has(head)||!Array.isArray(views)||views.length!==2)throw Error('Verified semantic model and views required');
  const results=views.map((v,index)=>{
    if(v?.view!==SEMANTIC_VIEWS[index]||!finiteArray(v.embedding,768))throw Error('Invalid semantic view');
    const norm=Math.hypot(...v.embedding);if(!Number.isFinite(norm)||norm<1e-8)throw Error('Zero semantic embedding');
    const h=head.heads[index],scores=[...h.bias];
    for(let i=0;i<768;i++)for(let k=0;k<4;k++)scores[k]+=(v.embedding[i]/norm-h.mean[i])*h.weights[i][k];
    if(!finiteArray(scores,4))throw Error('Nonfinite semantic scores');
    const order=[0,1,2,3].sort((a,b)=>scores[b]-scores[a]||a-b);
    return {view:v.view,role:ROLES[order[0]],gap:scores[order[0]]-scores[order[1]],scores};
  });
  let candidate=results[0].role===results[1].role&&results.every(v=>v.gap>=head.minGap)?results[0].role:null;
  if(candidate==='mixed-scene')candidate=null;
  return {candidate,views:results,independentEngines:1,bindingVerified:false,mayAuthorizeUpload:false,mayClearCodeConflict:false};
}

export async function createSemanticRoleReader({appRoot,modelFile,headFile,expectedHeadSha256}){
  const head=loadSemanticHead(fs.readFileSync(headFile),expectedHeadSha256);
  const model=fs.readFileSync(modelFile);
  if(hash(model)!==SEMANTIC_MODEL_SHA256)throw Error('Semantic encoder integrity mismatch');
  const ort=require(path.join(appRoot,'vendor/onnxruntime-node'));
  // Load the bytes that were verified, not a path that can change between the
  // digest check and session creation. CPU-only; one lazily owned session.
  const session=await ort.InferenceSession.create(model,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});
  if(session.inputNames.join(',')!=='pixel_values'||!session.outputNames.includes('pooler_output')){
    await session.release();throw Error('Unexpected semantic encoder contract');
  }
  let released=false,busy=false;
  return {async read(source){
    if(released||busy)throw Error('Semantic reader is closed or busy');busy=true;
    try{
      const input=await prepareSemanticPixels(source);
      const result=await session.run({pixel_values:new ort.Tensor('float32',input.pixels,[2,3,224,224])});
      const output=result.pooler_output;
      if(output?.dims?.join(',')!=='2,768'||output.data?.length!==1536)throw Error('Unexpected semantic output');
      const views=SEMANTIC_VIEWS.map((view,i)=>({view,embedding:Array.from(output.data.slice(i*768,(i+1)*768))}));
      return {schemaVersion:1,inputSha256:input.inputSha256,dimensions:input.dimensions,
        encoderSha256:SEMANTIC_MODEL_SHA256,headSha256:head.sha256,recipe:SEMANTIC_PIXEL_RECIPE,
        ...scoreSemanticViews(head,views)};
    }finally{busy=false;}
  },async release(){
    if(busy)throw Error('Semantic read is still running');
    if(!released){released=true;await session.release();}
  }};
}
