// Explicitly requires the pinned private weights; missing models must fail.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAsciiClipTokenizer,createClipRoleReader,ROLE_PROMPTS} from './clip-role-reader.mjs';
const [appRoot,modelDir]=process.argv.slice(2);
if(!appRoot||!modelDir)throw Error('APP_ROOT MODEL_DIR');
const tokenizer=createAsciiClipTokenizer(JSON.parse(fs.readFileSync(path.join(modelDir,'tokenizer.json'))));
assert.deepEqual(tokenizer('a photo of a cat'),[49406,320,1125,539,320,2368,49407]);
for(const prompts of Object.values(ROLE_PROMPTS))for(const prompt of prompts)assert.ok(tokenizer(prompt).length<=77);
const sharp=createRequire(import.meta.url)('sharp');
const bytes=await sharp({create:{width:320,height:240,channels:3,background:'red'}}).png().toBuffer();
const reader=await createClipRoleReader(appRoot,modelDir);
try{
  const first=await reader.read(bytes),second=await reader.read(bytes);
  assert.deepEqual(first,second);assert.equal(first.mayUploadScene,false);assert.equal(first.mayAssignNumber,false);
  console.log(JSON.stringify({actualModel:true,tokenizerReferencePassed:true,finiteDeterministicViews:2,
    businessRecognitionTested:false,identity:reader.identity}));
}finally{await reader.release();}
