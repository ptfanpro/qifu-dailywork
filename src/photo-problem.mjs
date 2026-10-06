import path from 'node:path';

// Missing readback is not proof of a wrong handwritten number. Only describe
// the evidence we have, and keep the filenames visible for manual comparison.
export function formatManualUploadProblem({files, readback, uploadEvidence}) {
  const duplicate = uploadEvidence?.responseOutcomes?.some(item => item.reason === 'duplicate-image');
  const missing = readback.missingNames;
  const heading = duplicate
    ? '后台提示“该图片已上传”，可能有编号或已有图片重复。后台没有指出具体文件，暂时无法确定哪张编号有误。'
    : uploadEvidence?.applicationFailure === true
      ? '后台返回上传失败，没有指出具体文件。'
      : '还不能确认这些照片是否已传到对应订单；这不代表它们的编号都写错了。';
  const list = missing.map(name => {
    const number = path.parse(name).name;
    return `${name}${/^\d+$/.test(number) ? `（文件编号 ${number}）` : ''}：还没确认对应订单收到这张照片。`;
  }).join('\n');
  const confirmedCount=readback.confirmedCount ?? readback.matched.length;
  return `${heading}\n本批 ${files.length} 张，已确认 ${confirmedCount} 张，以下 ${missing.length} 张的结果还不确定：\n${list}\n${readback.scanned === 0 ? '该日期目前没有可读取的已上传订单照片。\n' : ''}请对照纸面右上角编号检查文件名：例如纸面末号为 72，文件名应为 72.jpg。软件不会读取纸面编号或自动改名。已确认的照片会保留记录，本次没有再次上传。`;
}
