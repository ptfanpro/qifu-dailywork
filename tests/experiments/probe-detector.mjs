import fs from 'node:fs';
import {createTextDetector,readDetectedCodes} from './text-regions.mjs';
const [modelFile,prefix,...files]=process.argv.slice(2);
const detector=await createTextDetector(process.cwd(),modelFile);
try {
  for(const [index,file] of files.entries()) {
    const result=await readDetectedCodes(detector,process.cwd(),fs.readFileSync(file),prefix);
    console.log(JSON.stringify({index,...result}));
  }
} finally {await detector.release();}
