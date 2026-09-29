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
  return sharp(bytes).resize(180,135,{fit:'fill'}).removeAlpha().raw().toBuffer();
}

function meanAbsoluteDifference(left, right) {
  if (!Buffer.isBuffer(right) || left.length !== right.length) return Infinity;
  let sum = 0;
  for (let index=0;index<left.length;index++) sum += Math.abs(left[index]-right[index]);
  return sum / left.length;
}

export async function matchUploadedPhotoRaster(onlineBytes, localCandidates, pendingNames) {
  if (!Array.isArray(localCandidates) || localCandidates.length < 2 || !(pendingNames instanceof Set)) return null;
  const onlineRaster = await buildPhotoReadbackRaster(onlineBytes);
  const ranked = localCandidates.map(({name,raster}) => ({name,score:meanAbsoluteDifference(onlineRaster,raster)}))
    .sort((left,right) => left.score-right.score);
  const [best,second] = ranked;
  // The service re-encodes JPEGs. A very close pixel match must also be
  // clearly separated from every other photo from this same business day.
  if (!pendingNames.has(best.name) || best.score > 1.5 || second.score-best.score < 5) return null;
  return {name:best.name,score:best.score,secondScore:second.score};
}
