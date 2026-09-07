const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// A missing acknowledgement and an unchanged snapshot do NOT prove that a
// write failed. Poll read-only; never submit that batch again automatically.
export async function waitForUploadOrderOutcome(query,{attempts=3,sleepFn=pause,onSnapshot=()=>{}}={}) {
  let snapshot;
  for(let pass=0;pass<attempts;pass++) {
    if(pass) await sleepFn(2000);
    snapshot=await query();
    await onSnapshot(snapshot);
    if(snapshot.state==='all-uploaded' || snapshot.state==='ambiguous') break;
  }
  return snapshot;
}

// Each pass re-queries the original business date and only uploads scenes for
// orders still missing them. A late table update is not a permanent skip.
export async function finishScenePasses(site,date,modes,{expectedPhotoDir,attempts=3,sleepFn=pause,onStage=()=>{},onResult=()=>{},onRetry=()=>{}}={}) {
  let remaining;
  for(let pass=0;pass<attempts;pass++) {
    for(const [mode,files] of modes) {
      await onStage(mode);
      await onResult(await site.uploadSceneMode(date,mode,files,{expectedPhotoDir}));
    }
    remaining=await site.countUploadedWithoutScene(date);
    if(remaining===0) return;
    if(!Number.isSafeInteger(remaining) || remaining<0) throw new Error('场景查询数量无效，禁止批量完成。');
    if(pass+1<attempts) { await onRetry(remaining); await sleepFn(2000); }
  }
  throw new Error(`对应日期仍有 ${remaining} 条“场景图未上传”；已完成有限次数复查，不会执行批量完成。`);
}
