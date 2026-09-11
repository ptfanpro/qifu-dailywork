// Model identity is part of the application, not the machine's cache history.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const ENGLISH_MODEL=Object.freeze({
  relativePath:'ocr-data/eng.traineddata.gz',compressedBytes:10923060,
  compressedSha256:'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468',
  bytes:23466654,sha256:'daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047',
});

function readPinnedArchive(appRoot) {
  try {
    const file=path.join(appRoot,ENGLISH_MODEL.relativePath),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==ENGLISH_MODEL.compressedBytes)throw Error();
    const compressed=fs.readFileSync(file);
    if(hash(compressed)!==ENGLISH_MODEL.compressedSha256)throw Error();
    return compressed;
  } catch {throw Error('OCR model integrity check failed; reinstall the matching application package.');}
}

export function loadPinnedEnglishModel(appRoot) {
  const data=gunzipSync(readPinnedArchive(appRoot),{maxOutputLength:32*1024*1024});
  if(data.length!==ENGLISH_MODEL.bytes||hash(data)!==ENGLISH_MODEL.sha256)throw Error('OCR model integrity check failed');
  return data;
}

export async function createPinnedEnglishWorker(appRoot,parameters={},services={}) {
  readPinnedArchive(appRoot);
  const factory=services.createWorker||require('tesseract.js').createWorker;
  // Tesseract normally loads <cachePath>/eng.traineddata BEFORE langPath or
  // even explicitly supplied data. Disabling cache reads AND writes is vital.
  // Use the local language path: the bundled JS version's object-language
  // initializer incorrectly treats binary data as a language name. Verify the
  // bytes INSIDE the worker before returning it (including path-change races).
  // No existing machine cache is deleted or changed; no CDN fallback is set.
  const worker=await factory('eng',1,{langPath:path.resolve(appRoot,'ocr-data'),gzip:true,cacheMethod:'none'});
  try {
    const loaded=await worker.FS('readFile',['eng.traineddata']);
    if(loaded?.data?.length!==ENGLISH_MODEL.bytes||hash(loaded.data)!==ENGLISH_MODEL.sha256)
      throw Error('OCR model integrity check failed inside worker');
    await worker.setParameters(parameters);
    Object.defineProperty(worker,'modelIdentity',{value:Object.freeze({
      language:'eng',sha256:ENGLISH_MODEL.sha256,bytes:ENGLISH_MODEL.bytes,cachePolicy:'none',
    }),enumerable:true});
    return worker;
  } catch(error) {try{await worker.terminate();}catch{} throw error;}
}
