import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createAsciiClipTokenizer,clipImageValues,unitVector,roleCosines,summarizeRoleViews,verifyClipAssets,clipExperimentFingerprint} from './clip-role-reader.mjs';
const sharp=createRequire(import.meta.url)('sharp');
test('ASCII BPE merges by rank; does not silently accept or truncate arbitrary text',()=>{
  const tokenize=createAsciiClipTokenizer({model:{vocab:{'cat</w>':2368,'dog</w>':1929,'.</w>':269},
    merges:['c a','ca t</w>','d o','do g</w>'],end_of_word_suffix:'</w>'}});
  assert.deepEqual(tokenize('  CAT dog.'),[49406,2368,1929,269,49407]);
  assert.throws(()=>tokenize('客户资料'));assert.throws(()=>tokenize('<|endoftext|>'));
  assert.throws(()=>tokenize('unknown'));assert.throws(()=>tokenize('cat '.repeat(76)));
});
test('finite normalized vectors and every class/view are required; agreement grants no business authority',()=>{
  assert.throws(()=>unitVector([0,0]));assert.throws(()=>unitVector([NaN,1]));
  assert.throws(()=>roleCosines([1,0],{paper:[1]}));
  const roles={paper:[1,0],water:[0,1],lamp:[-1,0],other:[0,-1]};
  const a={view:'center-crop',ranking:roleCosines([1,0],roles)};
  const b={view:'full-frame',ranking:roleCosines([1,0],roles)};
  const same=summarizeRoleViews([a,b]);assert.equal(same.candidate,'paper');
  assert.equal(same.semanticVerified,false);assert.equal(same.bindingVerified,false);
  assert.equal(same.mayUploadScene,false);assert.equal(same.mayAssignNumber,false);
  assert.equal(summarizeRoleViews([a,{...b,ranking:roleCosines([0,1],roles)}]).candidate,null);
  assert.throws(()=>summarizeRoleViews([a,a]));assert.throws(()=>summarizeRoleViews([a]));
  assert.throws(()=>summarizeRoleViews([a,{...b,ranking:b.ranking.slice(0,3)}]));
});
test('actual image preprocessing is RGB CHW and EXIF-oriented; no source writes',async()=>{
  const png=await sharp({create:{width:448,height:224,channels:3,background:{r:255,g:0,b:0}}}).png().toBuffer();
  const saved=Buffer.from(png),center=await clipImageValues(png,'center-crop');
  assert.equal(center.length,224*224*3);
  assert.ok(Math.abs(center[0]-(1-.48145466)/.26862954)<1e-6);
  assert.ok(Math.abs(center[224*224]-(-.4578275)/.26130258)<1e-6);
  const full=await clipImageValues(png,'full-frame');
  assert.ok(full[224*224]>0);assert.deepEqual(png,saved);
  const jpeg=await sharp(png).withMetadata({orientation:6}).jpeg().toBuffer();
  const rotated=await sharp(jpeg).rotate().png().toBuffer();
  assert.deepEqual(await clipImageValues(jpeg,'full-frame'),await clipImageValues(rotated,'full-frame'));
  await assert.rejects(clipImageValues(png,'unsupported'));
});
test('model not installed is a failure, never a semantic pass',()=>{
  assert.throws(()=>verifyClipAssets('Z:/nonexistent-clip-test-assets'));
});
test('experiment fingerprint excludes run clock and selected dates, includes source/model/recipe',()=>{
  const a={reader:{model:'pinned',prompts:'fixed'},sourceFiles:[['code','a'.repeat(64)]],runtimeSha256:'b'.repeat(64),startedAt:'first',dates:['day1']};
  assert.equal(clipExperimentFingerprint(a),clipExperimentFingerprint({...a,startedAt:'later',dates:['day2']}));
  assert.notEqual(clipExperimentFingerprint(a),clipExperimentFingerprint({...a,reader:{...a.reader,prompts:'changed'}}));
  assert.notEqual(clipExperimentFingerprint(a),clipExperimentFingerprint({...a,sourceFiles:[['code','c'.repeat(64)]]}));
  assert.throws(()=>clipExperimentFingerprint({...a,sourceFiles:[]}));
});
