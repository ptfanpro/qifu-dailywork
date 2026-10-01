import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

export function parseUploadedPhotoPreview(onclick) {
  const match = /^see\((['"])(https:\/\/[^'"\s]+)\1\);?$/.exec(String(onclick || '').trim());
  if (!match) return null;
  let url;
  try { url = new URL(match[2]); } catch { return null; }
  return url.hostname === 'stqifu-prod.oss-cn-qingdao.aliyuncs.com'
    && url.pathname.startsWith('/service/stqf/blessing/') && !url.username && !url.password
    ? url.href : null;
}

export async function buildPhotoReadbackRaster(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new Error('照片回读数据无效或过大。');
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== 1800 || metadata.height !== 1350) throw new Error('照片回读尺寸与上传标准不一致。');
  const pixels=sharp(bytes).removeAlpha().toColourspace('srgb');
  return {
    coarse:await pixels.clone().resize(180,135,{fit:'fill'}).raw().toBuffer(),
    detail:await pixels.clone().resize(720,540,{fit:'fill'}).raw().toBuffer(),
  };
}

function meanAbsoluteDifference(left, right) {
  if (!Buffer.isBuffer(right) || left.length !== right.length) return Infinity;
  let sum = 0;
  for (let index=0;index<left.length;index++) sum += Math.abs(left[index]-right[index]);
  return sum / left.length;
}

export async function inspectUploadedPhotoRaster(onlineBytes, localCandidates, pendingNames) {
  if (!Array.isArray(localCandidates) || localCandidates.length < 2 || !(pendingNames instanceof Set)) return {reason:'insufficient-candidates',match:null};
  const onlineRaster = await buildPhotoReadbackRaster(onlineBytes);
  const ranked = localCandidates.map(({name,raster}) => ({name,raster,score:meanAbsoluteDifference(onlineRaster.coarse,raster?.coarse)}))
    .sort((left,right) => left.score-right.score);
  const [best,second] = ranked;
  const result={match:null,name:best.name,score:best.score,secondScore:second.score};
  if (!pendingNames.has(best.name)) return {...result,reason:'already-accounted'};
  // Keep the existing absolute similarity gate. Whole-image distance cannot
  // prove uniqueness when different papers share the same camera/background.
  if (best.score>1.5) return {...result,reason:'different-image'};
  const detail=onlineRaster.detail,bestDetail=best.raster.detail;
  if (meanAbsoluteDifference(detail,bestDetail)>2.5) return {...result,reason:'detail-mismatch'};
  let minimumDetailSeparation=Infinity;
  for (const other of ranked.slice(1)) {
    const alternative=other.raster.detail;
    if (!Buffer.isBuffer(alternative)||alternative.length!==detail.length) return {...result,reason:'invalid-candidate'};
    let informative=0,bestError=0,alternativeError=0;
    // Compare only pixels where the two LOCAL papers differ substantially.
    // Shared background is excluded, so a small wrong paper detail cannot be
    // hidden by a near-identical frame. JPEG noise is not distinctive evidence.
    for(let index=0;index<detail.length;index++) {
      if(Math.abs(bestDetail[index]-alternative[index])<16)continue;
      informative++;
      bestError+=Math.abs(detail[index]-bestDetail[index]);
      alternativeError+=Math.abs(detail[index]-alternative[index]);
    }
    if(informative<256)return {...result,reason:'indistinguishable-candidates'};
    bestError/=informative;alternativeError/=informative;
    if(bestError>6||alternativeError<Math.max(12,bestError*3))return {...result,reason:'ambiguous-detail'};
    minimumDetailSeparation=Math.min(minimumDetailSeparation,alternativeError-bestError);
  }
  return {...result,reason:'matched',match:{name:best.name,score:best.score,secondScore:second.score,minimumDetailSeparation}};
}

export async function matchUploadedPhotoRaster(onlineBytes,localCandidates,pendingNames) {
  return (await inspectUploadedPhotoRaster(onlineBytes,localCandidates,pendingNames)).match;
}
