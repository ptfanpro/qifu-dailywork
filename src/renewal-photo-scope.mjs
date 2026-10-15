import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hashIds=rows=>crypto.createHash('sha256').update(rows.map(row=>String(row.id)).sort().join('\n')).digest('hex');
export function validateRenewalPhotoScope(scope,date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')) || !scope || scope.businessDate!==date || !Array.isArray(scope.rows) || !scope.rows.length
    || scope.rows.some(row=>!row || typeof row.id!=='string' || !row.id.trim()
      || typeof row.blessingCode!=='string' || !row.blessingCode.trim())
    || new Set(scope.rows.map(row=>row.id)).size!==scope.rows.length
    || hashIds(scope.rows)!==scope.orderIdHash) {
    throw new Error('续费照片核对清单的日期、订单 ID 或哈希不一致；没有上传照片。');
  }
  return scope;
}

export function resolveRenewalPhotoScope({date,receipt,manifest}) {
  if (!receipt) return null;
  if (receipt.businessDate!==date || !Number.isFinite(Date.parse(receipt.verifiedAt))
    || !Array.isArray(receipt.outputs) || !receipt.outputs.length
    || receipt.outputs.some(item=>!Number.isInteger(item.pageCount)||item.pageCount<1||!/^[a-f0-9]{64}$/.test(item.sha256||''))) {
    throw new Error('当天续费导出凭据不完整；不能自动确认续费照片。');
  }
  let rows=receipt.coveredRows;
  let orderIdHash=receipt.coveredOrderIdHash;
  if (!orderIdHash) {
    // Older exports recorded a hash for the latest pending batch, rather than
    // the union of every export that day. Only use the matching manifest.
    rows=manifest?.rows;
    orderIdHash=receipt.orderIdHash;
    if (manifest?.businessDate!==date || manifest.orderIdHash!==orderIdHash
      || !Array.isArray(rows) || rows.length!==receipt.orderCount
      || rows.some(row=>!receipt.coveredRows?.some(covered=>covered.id===row.id && covered.blessingCode===row.blessingCode))) {
      throw new Error('旧版续费导出凭据与当天订单清单不一致；不能自动确认续费照片。');
    }
  }
  return validateRenewalPhotoScope({businessDate:date,orderIdHash,rows},date);
}

export function loadRenewalPhotoScope(dayDir,date) {
  const read=name=>{
    const file=path.join(dayDir,name);
    return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):null;
  };
  return resolveRenewalPhotoScope({date,receipt:read('renewal-pdf-receipt.json'),manifest:read('renewal-manifest.json')});
}
