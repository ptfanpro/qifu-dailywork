import fs from 'node:fs';
import path from 'node:path';
import { diagnosePhotoCode } from '../src/photo-prepare.mjs';

const [appRoot, sourceDir, cropRoot, firstText, lastText, ...names] = process.argv.slice(2);
const first = Number(firstText);
const last = Number(lastText);
if (!appRoot || !sourceDir || !cropRoot || !Number.isInteger(first) || !Number.isInteger(last)) {
  throw new Error('usage: node regress-numbered-photos.mjs <appRoot> <sourceDir> <cropRoot> <first> <last> [names...]');
}
const selected = names.length ? names : fs.readdirSync(sourceDir).filter((name)=>/^\d+\.(?:jpe?g|png)$/i.test(name));
const expectedNumbers = Array.from({length:last-first+1},(_,index)=>first+index);
const rows=[];
for (let index=0; index<selected.length; index+=1) {
  const name=selected[index];
  const truth=Number(path.parse(name).name);
  const result=await diagnosePhotoCode({
    appRoot,file:path.join(sourceDir,name),expectedPrefix:'268',expectedNumbers,
    cropDir:path.join(cropRoot,String(index)),
  });
  rows.push({name,truth,reliable:result.reliable,number:result.number,correct:result.reliable&&result.number===truth,evidence:result.evidence,geometry:result.paperGeometry});
  console.log(JSON.stringify(rows.at(-1)));
}
const reliable=rows.filter((row)=>row.reliable);
const wrong=reliable.filter((row)=>!row.correct);
console.log(JSON.stringify({total:rows.length,reliable:reliable.length,correct:reliable.length-wrong.length,wrong:wrong.length,wrongNames:wrong.map((row)=>row.name)}));
if (wrong.length) process.exitCode=2;
