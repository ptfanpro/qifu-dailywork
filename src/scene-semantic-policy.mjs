import {SEMANTIC_MODEL_SHA256,SEMANTIC_VIEWS} from './scene-semantic-reader.mjs';
import {SEMANTIC_PIXEL_RECIPE} from './scene-semantic-pixels.mjs';

export const SEMANTIC_HEAD_SHA256='363faa187eacfc3535a7b409f7d8b68dd97a7a1e8e1a0e392ba6c18c3d2baa36';
const roles=['paper','lamp','water','mixed-scene'];
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);

// Validate the entire observation, not a saved category string. This is role
// evidence only: the caller must still preserve all printed-code/PDF vetoes.
export function semanticRole(observation,sourceSha256) {
  const o=observation;
  if(!digest(sourceSha256)||o?.schemaVersion!==1||o.inputSha256!==sourceSha256
    ||o.encoderSha256!==SEMANTIC_MODEL_SHA256||o.headSha256!==SEMANTIC_HEAD_SHA256
    ||o.recipe!==SEMANTIC_PIXEL_RECIPE||o.independentEngines!==1
    ||o.bindingVerified!==false||o.mayAuthorizeUpload!==false||o.mayClearCodeConflict!==false
    ||!Number.isInteger(o.dimensions?.width)||!Number.isInteger(o.dimensions?.height)
    ||o.dimensions.width<=0||o.dimensions.height<=0||o.dimensions.width*o.dimensions.height>30_000_000
    ||!Array.isArray(o.views)||o.views.length!==2)return null;
  const selected=[];
  for(let index=0;index<2;index++) {
    const v=o.views[index];
    if(v?.view!==SEMANTIC_VIEWS[index]||!Array.isArray(v.scores)||v.scores.length!==4
      ||!v.scores.every(x=>typeof x==='number'&&Number.isFinite(x)))return null;
    const rank=[0,1,2,3].sort((a,b)=>v.scores[b]-v.scores[a]||a-b);
    const gap=v.scores[rank[0]]-v.scores[rank[1]];
    if(!Number.isFinite(v.gap)||Math.abs(v.gap-gap)>1e-12||gap<.15||v.role!==roles[rank[0]])return null;
    selected.push(v.role);
  }
  if(selected[0]!==selected[1]||selected[0]==='mixed-scene'||o.candidate!==selected[0])return null;
  return selected[0];
}
