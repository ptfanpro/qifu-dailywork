// Historical metric-only diagnostic; NOT recognition acceptance. No images or customer content in its output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {diagnosePhotoStructure,diagnoseLegacySceneMetrics} from '../src/photo-prepare.mjs';
const report={method:'legacy-metrics-comparison-not-recognition',mayAssign:false,checked:0,changedScenes:0,changedNumberedPapers:0,changedUnknown:0,changes:[]};
for(const dir of process.argv.slice(2)) {
  for(const file of fs.readdirSync(dir).filter(n=>/\.jpe?g$/i.test(n))) {
    const full=path.join(dir,file);
    const item=await diagnosePhotoStructure(full);
    const before=diagnoseLegacySceneMetrics({...item,sceneMetrics:{...item.sceneMetrics,flameStructure:undefined}}).likelyScene;
    report.checked++;
    if(before===item.likelyScene) continue;
    const kind=/^2\.[1256]\.jpg$/i.test(file)?'Scenes':/^\d+\.jpg$/i.test(file)?'NumberedPapers':'Unknown';
    report['changed'+kind]++;
    report.changes.push({sha256:crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'),kind,before,after:item.likelyScene});
  }
}
console.log(JSON.stringify(report,null,2));
if(report.changedNumberedPapers || report.changedUnknown) process.exitCode=1;
