// Explicit actual-model test, synthetic content only. Missing assets must fail.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServerCodeReader,literalCodeObservations} from './server-code-reader.mjs';
const sharp=createRequire(import.meta.url)('sharp');
const [appRoot,modelFile]=process.argv.slice(2);
assert.ok(appRoot&&modelFile,'Provide app root and pinned model file');
const reader=await createServerCodeReader(appRoot,modelFile);
try {
  for(const code of ['269-1-632','2610-1-1032','261-1-94']) {
    const png=await sharp({text:{text:code,font:'Arial 32',rgba:true}}).flatten({background:'#fff'}).png().toBuffer();
    const result=await reader.readLine(png);
    assert.deepEqual(literalCodeObservations(result.text).codes,[code]);
    assert.ok(Number.isFinite(result.confidence));
  }
  console.log(JSON.stringify({syntheticCodes:3,passed:3,dictionaryLength:reader.dictionaryLength,model:reader.modelSha256}));
}finally{await reader.release();}
