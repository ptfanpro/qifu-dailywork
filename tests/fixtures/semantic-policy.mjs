import {SEMANTIC_MODEL_SHA256,SEMANTIC_VIEWS} from '../../src/scene-semantic-reader.mjs';
import {SEMANTIC_PIXEL_RECIPE} from '../../src/scene-semantic-pixels.mjs';
// Synthetic policy observations only. Never use them as model-validation data.
export function policyObservation(role,inputSha256='a'.repeat(64)) {
  const roles=['paper','lamp','water','mixed-scene'];
  const i=roles.indexOf(role),scores=roles.map((_,k)=>k===i?1:0);
  return {schemaVersion:1,inputSha256,encoderSha256:SEMANTIC_MODEL_SHA256,
    headSha256:'363faa187eacfc3535a7b409f7d8b68dd97a7a1e8e1a0e392ba6c18c3d2baa36',
    recipe:SEMANTIC_PIXEL_RECIPE,dimensions:{width:400,height:300},
    candidate:i===3?null:role,independentEngines:1,bindingVerified:false,
    mayAuthorizeUpload:false,mayClearCodeConflict:false,
    views:SEMANTIC_VIEWS.map(view=>({view,role,gap:1,scores:[...scores]}))};
}
