import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createServerCodeReader,SERVER_CODE_MODEL_SHA256} from '../src/server-code-reader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(import.meta.url)('sharp');
const reader=await createServerCodeReader(root);
try{
 assert.equal(reader.modelSha256,SERVER_CODE_MODEL_SHA256);
 const blank=await sharp({create:{width:128,height:32,channels:3,background:'#fff'}}).png().toBuffer();
 const result=await reader.readLine(blank);
 assert.equal(typeof result.text,'string');assert(Number.isFinite(result.confidence));
 console.log('Pinned local prefix model loads and executes on CPU; no accuracy or business acceptance claimed');
}finally{await reader.release();}
