import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildPhotoReadbackRaster, inspectUploadedPhotoRaster} from './photo-readback.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Reconcile individual files using read-only evidence, even when other orders
// for the date still need photos. A successful match is persisted immediately
// by the caller so a later read failure cannot discard earlier confirmations.
export async function reconcileManualUploadedPhotos({
  site, date, files, allFiles = files, fileHashes, onMatch = async () => {},
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
    || !Array.isArray(files) || !Array.isArray(allFiles)) {
    throw new Error('照片回读缺少有效业务日期或文件清单。');
  }
  const targets = new Map();
  const candidates = [];
  const candidatePaths = new Map();
  for (const file of allFiles) {
    const name = path.basename(file);
    if (candidatePaths.has(name)) throw new Error('照片回读清单中有重复文件名。');
    candidatePaths.set(name, path.resolve(file));
    const bytes = fs.readFileSync(file);
    const hash = sha256(bytes);
    if (!fileHashes?.[name] || hash !== fileHashes[name]) {
      throw new Error(`${name} 与预检文件哈希不同；未回读线上照片，也未上传。`);
    }
    candidates.push({name, sha256:hash, raster:await buildPhotoReadbackRaster(bytes)});
  }
  for (const file of files) {
    const name = path.basename(file);
    if (targets.has(name) || candidatePaths.get(name) !== path.resolve(file)) {
      throw new Error('待核对照片与完整福单照片清单不一致。');
    }
    targets.set(name, fileHashes[name]);
  }
  const missingNames = new Set(targets.keys());
  const matched = [];
  const seenUrls = new Set();
  const diagnostics = {reasons:{}, images:[]};
  const recordReason = (reason) => {
    diagnostics.reasons[reason] = (diagnostics.reasons[reason] || 0) + 1;
  };
  let scanned = 0;
  try {
    for (const kind of ['tablet', 'lamp']) {
      if (!missingNames.size) break;
      const references = await site.queryUploadedPhotoReferences(date, kind);
      for (const reference of references) {
        if (!reference.url) { recordReason('missing-preview'); continue; }
        if (!reference.id || reference.kind !== kind) { recordReason('invalid-reference'); continue; }
        // One paper may be attached to many orders; fetch its URL only once.
        if (seenUrls.has(reference.url)) continue;
        seenUrls.add(reference.url);
        scanned++;
        let onlineBytes;
        try { onlineBytes = await site.readUploadedPhotoBytes(reference.url); }
        catch { recordReason('read-failed'); continue; }
        const onlineImageSha256 = sha256(onlineBytes);
        const exact = candidates.filter((candidate) => candidate.sha256 === onlineImageSha256);
        let comparison;
        if (exact.length === 1) {
          comparison = missingNames.has(exact[0].name)
            ? {reason:'exact-hash', name:exact[0].name, match:{name:exact[0].name, minimumDetailSeparation:null}}
            : {reason:'already-accounted', name:exact[0].name, match:null};
        } else {
          try { comparison = await inspectUploadedPhotoRaster(onlineBytes, candidates, missingNames); }
          catch { recordReason('invalid-image'); continue; }
        }
        recordReason(comparison.reason);
        diagnostics.images.push({name:comparison.name, reason:comparison.reason,
          score:comparison.score, secondScore:comparison.secondScore});
        if (!comparison.match) continue;
        const name = comparison.match.name;
        // Verify once more after network reads: files may have changed while
        // the browser was loading the remote image.
        if (sha256(fs.readFileSync(candidatePaths.get(name))) !== targets.get(name)) {
          throw new Error(`${name} 在照片回读期间发生变化；未补记该照片上传回执。`);
        }
        const item = {name, sha256:targets.get(name), evidence:'online-image-readback',
          businessDate:date, onlineOrderIdHash:sha256(`${kind}:${reference.id}`),
          onlineImageSha256, minimumDetailSeparation:comparison.match.minimumDetailSeparation,
          matchMethod:comparison.reason === 'exact-hash' ? 'sha256' : 'unique-raster'};
        await onMatch(item);
        matched.push(item);
        missingNames.delete(name);
        if (!missingNames.size) break;
      }
    }
  } finally {
    await site.closePhotoReadback();
  }
  return {matched, missingNames:[...missingNames], scanned, diagnostics};
}
