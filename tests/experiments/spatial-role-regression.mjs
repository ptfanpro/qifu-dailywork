import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSpatialRoles,SPATIAL_WINDOWS} from './spatial-role-reader.mjs';
const rows=roles=>SPATIAL_WINDOWS.map((w,i)=>({name:w.name,result:{candidate:roles[i]}}));
test('foreground experiment is diagnostic only even when windows agree',()=>{
  for(const role of ['water','lamp','paper']) {
    const evidence=summarizeSpatialRoles(rows([role,role,role,role]));
    assert.equal(evidence.candidate,role);
    for(const name of ['bindingVerified','semanticVerified','mayAssignNumber','mayUploadScene','mayClearCodeConflict'])assert.equal(evidence[name],false);
  }
  assert.equal(summarizeSpatialRoles(rows(['lamp','lamp','water','lamp'])).candidate,null);
  assert.equal(summarizeSpatialRoles(rows(['water','water',null,null])).candidate,null);
});
test('missing or duplicated spatial views are not an apparent agreement',()=>{
  assert.throws(()=>summarizeSpatialRoles(rows(['water','water','water','water']).slice(1)),/Incomplete/);
  const duplicated=rows(['lamp','lamp','lamp','lamp']);duplicated[3].name=duplicated[2].name;
  assert.throws(()=>summarizeSpatialRoles(duplicated),/Incomplete/);
});
