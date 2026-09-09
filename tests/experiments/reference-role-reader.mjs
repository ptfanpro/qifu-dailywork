// Explicit, offline reference-image experiment. Never an upload/classification gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {CLIP_VIEWS,CLIP_REVISION,verifyClipAssets,clipImageValues,unitVector} from './clip-role-reader.mjs';
const require=createRequire(import.meta.url);
export const REFERENCE_ROLES=Object.freeze(['paper','lamp','water']);
export const REFERENCE_NEIGHBORS=3;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validSha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const validDate=x=>typeof x==='string'&&/^2026-\d\d-\d\d$/.test(x)
  &&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;

export function referenceExperimentFingerprint({sourceFiles,calibrationLabelSha256,model}){
  if(!validSha(calibrationLabelSha256)||!validSha(model?.fingerprint)||!Array.isArray(sourceFiles)||!sourceFiles.length
    ||sourceFiles.some(r=>!Array.isArray(r)||r.length!==2||!r[0]||!validSha(r[1]))
    ||new Set(sourceFiles.map(r=>r[0])).size!==sourceFiles.length)throw Error('Incomplete reference experiment identity');
  return hash({sourceFiles:[...sourceFiles].sort((a,b)=>a[0].localeCompare(b[0])),calibrationLabelSha256,modelFingerprint:model.fingerprint});
}

function vectors(views){
  if(!Array.isArray(views)||views.length!==2)throw Error('Incomplete image views');
  return Object.fromEntries(CLIP_VIEWS.map(view=>{
    const rows=views.filter(v=>v.view===view);
    if(rows.length!==1||rows[0].embedding?.length!==512)throw Error('Invalid image embedding shape');
    return [view,unitVector(rows[0].embedding)];
  }));
}

export function createReferenceRoleClassifier(calibration,encoderIdentity){
  if(!encoderIdentity||!validSha(encoderIdentity.fingerprint)||!Array.isArray(calibration)||!calibration.length)
    throw Error('Missing reference identity');
  const seen=new Set(),dates=new Set();
  const rows=calibration.map(r=>{
    if(!validSha(r.sha256)||seen.has(r.sha256)||!validDate(r.date)
      ||r.reviewed!==true||!REFERENCE_ROLES.includes(r.role))throw Error('Invalid or unreviewed reference');
    seen.add(r.sha256);dates.add(r.date);
    return {sha256:r.sha256,date:r.date,role:r.role,vectors:vectors(r.views)};
  });
  if(dates.size<2||REFERENCE_ROLES.some(role=>rows.filter(r=>r.role===role).length<REFERENCE_NEIGHBORS
    ||new Set(rows.filter(r=>r.role===role).map(r=>r.date)).size<2))
    throw Error('Insufficient independent-date role references');
  const identity={schemaVersion:1,encoder:structuredClone(encoderIdentity),neighbors:REFERENCE_NEIGHBORS,
    roles:REFERENCE_ROLES,views:CLIP_VIEWS,calibration:rows.map(r=>({sha256:r.sha256,date:r.date,role:r.role,
      embeddingsSha256:hash(Object.fromEntries(CLIP_VIEWS.map(v=>[v,[...r.vectors[v]]])))}))};
  const fingerprint=hash(identity);
  return {
    identity:{...identity,fingerprint},
    predict({sha256,date,views}){
      // The source identity is a leakage guard, never a lookup for its role.
      if(!validSha(sha256)||seen.has(sha256)||dates.has(date)||!validDate(date))
        throw Error('Evaluation source overlaps calibration or has invalid identity');
      const input=vectors(views),results=CLIP_VIEWS.map(view=>{
        const nearest=rows.map(r=>({sourceSha256:r.sha256,role:r.role,
          cosine:input[view].reduce((sum,x,i)=>sum+x*r.vectors[view][i],0)}))
          .sort((a,b)=>b.cosine-a.cosine||a.sourceSha256.localeCompare(b.sourceSha256));
        const top=nearest.slice(0,REFERENCE_NEIGHBORS),agrees=top.every(r=>r.role===top[0].role);
        const competitor=nearest.find(r=>r.role!==top[0].role);
        return {view,neighbors:top,candidate:agrees?top[0].role:null,
          marginToOtherRole:top.at(-1).cosine-competitor.cosine};
      });
      const candidate=results[0].candidate&&results.every(r=>r.candidate===results[0].candidate
        &&r.marginToOtherRole>1e-6)?results[0].candidate:null;
      return {fingerprint,candidate,views:results,semanticVerified:false,bindingVerified:false,
        mayAssignNumber:false,mayClearCodeConflict:false,mayUploadScene:false,
        note:'Nearest reference consensus is diagnostic, not calibrated probability or open-set recognition.'};
    },
  };
}

export async function createReferenceImageEncoder(appRoot,modelDir){
  appRoot=path.resolve(appRoot);modelDir=path.resolve(modelDir);
  const assets=verifyClipAssets(modelDir),ort=require(path.join(appRoot,'vendor/onnxruntime-node'));
  const runtimeSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot,'vendor/onnxruntime-node/package.json'))).digest('hex');
  const identity={revision:CLIP_REVISION,assets,runtimeSha256,views:CLIP_VIEWS,dimensions:512,
    preprocessing:'clipImageValues-RGB-224-cubic-center-and-full-frame'};
  identity.fingerprint=hash(identity);
  const session=await ort.InferenceSession.create(path.join(modelDir,'vision_model_quantized.onnx'),{
    executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});
  return {identity,async read(bytes){
    const views=[];
    for(const view of CLIP_VIEWS){
      const pixels=await clipImageValues(bytes,view);
      const result=await session.run({pixel_values:new ort.Tensor('float32',pixels,[1,3,224,224])});
      if(result.image_embeds?.dims.join(',')!=='1,512')throw Error('Invalid image model output');
      views.push({view,embedding:[...unitVector(result.image_embeds.data)]});
    }
    return views;
  },release:()=>session.release()};
}
