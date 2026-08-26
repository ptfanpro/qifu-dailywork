import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { verifyPdf } from './pdf.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

export const MAX_IMAGE_BYTES = 1_572_864;
export const MAX_UPLOAD_BATCH = 50;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const LAMP_SCENES = new Set(['2.1', '2.2']);
const WATER_SCENES = new Set(['2.5', '2.6']);

export function dayFolder(root, date) {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`无效业务日期：${date}`);
  return path.join(root, `${month}月${day}日`);
}

export function assertSceneFilesBelongToBusinessDate(root, date, files, mode) {
  const label = mode === 'water' ? '供水' : '供灯';
  const allowedNames = mode === 'water' ? WATER_SCENES : LAMP_SCENES;
  const expectedPhotoDir = path.resolve(dayFolder(root, date), '1');
  if (!fs.existsSync(expectedPhotoDir) || !fs.statSync(expectedPhotoDir).isDirectory()) {
    throw new Error(`${date} 没有对应照片目录：${expectedPhotoDir}`);
  }
  const expectedRealDir = fs.realpathSync.native(expectedPhotoDir);
  const verifiedFiles = [];
  for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label}场景图不存在：${file}`);
    const realFile = fs.realpathSync.native(file);
    if (path.dirname(realFile).toLowerCase() !== expectedRealDir.toLowerCase()) {
      throw new Error(`${date} 的${label}场景图必须来自该业务日期的“${expectedPhotoDir}”，禁止使用执行当天或其他日期的场景图：${file}`);
    }
    const stem = path.parse(realFile).name;
    if (!allowedNames.has(stem)) throw new Error(`${date} 的${label}场景图名称不符合规则：${path.basename(file)}`);
    verifiedFiles.push(realFile);
  }
  return {
    businessDate: date,
    photoDir: expectedRealDir,
    mode,
    files: verifiedFiles,
    fileHashes: Object.fromEntries(verifiedFiles.map((file) => [path.basename(file), hashFile(file)])),
  };
}

export function expectedPrintedPrefix(date) {
  const [year, month] = date.split('-').map(Number);
  return `${String(year).slice(-2)}${month}`;
}

export function hashFile(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function hashManifestFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    const stat = fs.statSync(file);
    hash.update(`${path.basename(file)}\0${stat.size}\0${hashFile(file)}\n`);
  }
  return hash.digest('hex');
}

async function inspectImage(file, kind) {
  const stat = fs.statSync(file);
  const errors = [];
  const warnings = [];
  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg'].includes(ext)) errors.push('必须输出为 JPG');
  if (stat.size > MAX_IMAGE_BYTES) errors.push('文件超过 1.5 MiB');
  let metadata = {};
  try {
    metadata = await sharp(file).metadata();
  } catch (error) {
    errors.push(`图片无法读取：${error.message}`);
  }
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) errors.push('图片尺寸无效');
  if (width && width !== 1800) warnings.push('宽度不是 1800 px');
  if (width && height && Math.abs(width / height - 4 / 3) > 0.03) warnings.push('比例不是接近 4:3，需人工检查裁剪或黑边');
  if (kind === 'blessing' && !/^\d+$/.test(path.parse(file).name)) errors.push('福单文件名必须是纯整数');
  return {
    file,
    name: path.basename(file),
    bytes: stat.size,
    width,
    height,
    format: metadata.format || null,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function parsePrintedCode(text, expectedPrefix) {
  const compact = String(text || '')
    .replace(/[—–_]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1');
  const exact = new RegExp(`${expectedPrefix}-?1-?(\\d{1,4})(?!\\d)`).exec(compact);
  if (!exact) return null;
  return { fullCode: `${expectedPrefix}-1-${Number(exact[1])}`, lastNumber: Number(exact[1]) };
}

async function makeOcrCrops(file, outputDir) {
  const sourceMetadata = await sharp(file).metadata();
  const metadata = [5, 6, 7, 8].includes(Number(sourceMetadata.orientation || 1))
    ? { ...sourceMetadata, width: sourceMetadata.height, height: sourceMetadata.width }
    : sourceMetadata;
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) return [];
  const definitions = [
    ['right-upper', 0.42, 0.05, 0.56, 0.58],
    ['right-middle', 0.42, 0.28, 0.56, 0.62],
    ['upper-wide', 0.20, 0.02, 0.78, 0.58],
  ];
  const outputs = [];
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, leftR, topR, widthR, heightR] of definitions) {
    const left = Math.max(0, Math.floor(width * leftR));
    const top = Math.max(0, Math.floor(height * topR));
    const cropWidth = Math.min(width - left, Math.max(1, Math.floor(width * widthR)));
    const cropHeight = Math.min(height - top, Math.max(1, Math.floor(height * heightR)));
    const output = path.join(outputDir, `${crypto.randomUUID()}-${name}.png`);
    await sharp(file)
      .rotate()
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize({ width: 1800, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toFile(output);
    outputs.push(output);
  }
  return outputs;
}

export async function recognizeUnexpectedImages(files, date, workDir) {
  if (!files.length) return [];
  const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const langPath = path.join(appRoot, 'ocr-data');
  const model = path.join(langPath, 'eng.traineddata.gz');
  if (!fs.existsSync(model)) return files.map((file) => ({ file, status: 'ocr-model-missing', candidates: [] }));
  let createWorker;
  let PSM;
  try {
    ({ createWorker, PSM } = require('tesseract.js'));
  } catch {
    return files.map((file) => ({ file, status: 'ocr-runtime-missing', candidates: [] }));
  }
  const cropDir = path.join(workDir, 'ocr-crops');
  const worker = await createWorker('eng', 1, { langPath, gzip: true });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: '0123456789-',
  });
  const expectedPrefix = expectedPrintedPrefix(date);
  const results = [];
  try {
    for (const file of files) {
      const crops = await makeOcrCrops(file, cropDir);
      const observations = [];
      for (const crop of crops) {
        const result = await worker.recognize(crop);
        const parsed = parsePrintedCode(result.data.text, expectedPrefix);
        if (parsed) observations.push({ ...parsed, confidence: Number(result.data.confidence || 0) });
      }
      const grouped = new Map();
      for (const item of observations) {
        const previous = grouped.get(item.fullCode) || { ...item, votes: 0, maxConfidence: 0 };
        previous.votes += 1;
        previous.maxConfidence = Math.max(previous.maxConfidence, item.confidence);
        grouped.set(item.fullCode, previous);
      }
      const candidates = [...grouped.values()].sort((a, b) => b.votes - a.votes || b.maxConfidence - a.maxConfidence);
      const best = candidates[0] || null;
      const unique = Boolean(best && (!candidates[1] || best.votes > candidates[1].votes));
      const reliable = Boolean(best && unique && (best.votes >= 2 || best.maxConfidence >= 60));
      results.push({
        file,
        status: reliable ? 'suggestion-only' : 'manual-review',
        suggestedCode: reliable ? best.fullCode : null,
        suggestedTarget: reliable ? `${best.lastNumber}.jpg` : null,
        votes: best?.votes || 0,
        confidence: best?.maxConfidence || 0,
        candidates: candidates.map(({ fullCode, votes, maxConfidence }) => ({ fullCode, votes, confidence: maxConfidence })),
      });
    }
  } finally {
    await worker.terminate();
  }
  return results;
}

export async function scanPhotoWorkday(root, date, workDir, { runOcr = true, expectedNumbers = null, expectedNumberModes = null } = {}) {
  const folder = dayFolder(root, date);
  const photoDir = path.join(folder, '1');
  if (!fs.existsSync(photoDir)) throw new Error(`没有找到照片目录：${photoDir}`);
  const imageFiles = fs.readdirSync(photoDir)
    .map((name) => path.join(photoDir, name))
    .filter((file) => fs.statSync(file).isFile() && IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const blessing = [];
  const foreignBlessing = [];
  const lampScenes = [];
  const waterScenes = [];
  const unexpected = [];
  for (const file of imageFiles) {
    const stem = path.parse(file).name;
    if (/^\d+$/.test(stem)) {
      const number = Number(stem);
      if (expectedNumbers && !expectedNumbers.has(number)) foreignBlessing.push(file);
      else blessing.push(file);
    }
    else if (LAMP_SCENES.has(stem)) lampScenes.push(file);
    else if (WATER_SCENES.has(stem)) waterScenes.push(file);
    else unexpected.push(file);
  }
  const duplicateNumbers = [...new Set(blessing.map((file) => Number(path.parse(file).name)).filter((value, index, all) => all.indexOf(value) !== index))];
  const allInspections = [];
  for (const file of blessing) allInspections.push(await inspectImage(file, 'blessing'));
  for (const file of lampScenes) allInspections.push(await inspectImage(file, 'scene-lamp'));
  for (const file of waterScenes) allInspections.push(await inspectImage(file, 'scene-water'));
  const pdfFiles = fs.readdirSync(folder).filter((name) => /\.pdf$/i.test(name)).map((name) => path.join(folder, name));
  let pdfPageCount = 0;
  const pdfs = [];
  for (const file of pdfFiles) {
    const checked = await verifyPdf(file);
    pdfPageCount += checked.pageCount;
    pdfs.push({ file, name: path.basename(file), pageCount: checked.pageCount, sha256: checked.sha256 });
  }
  const blockingErrors = allInspections.flatMap((item) => item.errors.map((message) => `${item.name}：${message}`));
  const manualIssues = [];
  const sceneManualIssues = [];
  if (!blessing.length) blockingErrors.push('没有发现纯整数命名的福单图');
  if (foreignBlessing.length) manualIssues.push(`有 ${foreignBlessing.length} 张纯数字照片不属于本日 PDF 唯一编号，已隔离且不会上传：${foreignBlessing.map((file)=>path.basename(file)).join('、')}`);
  if (unexpected.length) manualIssues.push(`有 ${unexpected.length} 张图片尚未确认编号或场景类别；已确认福单仍可继续处理`);
  if (duplicateNumbers.length) blockingErrors.push(`福单编号重复：${duplicateNumbers.join('、')}`);
  if (lampScenes.length > 2) {
    const message = '供灯场景图超过2张，需人工确认保留的2张';
    manualIssues.push(message); sceneManualIssues.push(message);
  }
  if (waterScenes.length > 2) {
    const message = '供水场景图超过2张，需人工确认保留的2张';
    manualIssues.push(message); sceneManualIssues.push(message);
  }
  if (!pdfFiles.length) blockingErrors.push('当天目录没有 PDF，无法做页数闭环校验');
  const missingBlessingCount = Math.max(0, pdfPageCount - blessing.length);
  const extraBlessingCount = Math.max(0, blessing.length - pdfPageCount);
  if (pdfFiles.length && extraBlessingCount > 0) manualIssues.push(`本日可用福单图比 PDF 页数多 ${extraBlessingCount} 张；超出项已进入人工清单，唯一确认项仍可继续`);
  // A day's PDFs can contain categories whose photos have not arrived yet.  Only
  // require scenes for blessing photos that are actually present in this batch.
  // Older checkpoints do not have a number-to-category index, so retain the
  // conservative whole-PDF fallback unless every present blessing is mapped.
  const presentBlessingNumbers = blessing.map((file) => Number(path.parse(file).name));
  const modeForNumber = (number) => expectedNumberModes instanceof Map
    ? expectedNumberModes.get(number)
    : expectedNumberModes?.[number] ?? expectedNumberModes?.[String(number)];
  const presentModes = presentBlessingNumbers.map(modeForNumber);
  const hasCompleteModeIndex = presentBlessingNumbers.length > 0
    && presentModes.every((mode) => ['water','lamp','tablet'].includes(mode));
  const requiredSceneModes = hasCompleteModeIndex
    ? ['water','lamp'].filter((mode) => presentModes.includes(mode))
    : [
        ...(pdfFiles.some((file) => /供水/.test(path.basename(file))) ? ['water'] : []),
        ...(pdfFiles.some((file) => !/供水/.test(path.basename(file))) ? ['lamp'] : []),
      ];
  const needsWaterScene = requiredSceneModes.includes('water');
  const needsLampScene = requiredSceneModes.includes('lamp');
  if (needsWaterScene && waterScenes.length < 1) {
    const message = '当天供水订单缺少已确认的供水场景图（2.5.jpg/2.6.jpg）';
    manualIssues.push(message); sceneManualIssues.push(message);
  }
  if (needsLampScene && lampScenes.length < 2) {
    const message = '当天供灯或牌位订单缺少2张已确认的供灯场景图（2.1.jpg、2.2.jpg）';
    manualIssues.push(message); sceneManualIssues.push(message);
  }
  const ocrSuggestions = runOcr && unexpected.length ? await recognizeUnexpectedImages(unexpected, date, workDir) : [];
  const digestFiles = [...blessing, ...lampScenes, ...waterScenes];
  const warnings = allInspections.flatMap((item) => item.warnings.map((message) => `${item.name}：${message}`));
  if (missingBlessingCount > 0) warnings.push(`仍缺少 ${missingBlessingCount} 张福单图；现有照片可先上传，补图后只处理新增文件`);
  const fileHashes = Object.fromEntries(digestFiles.map((file) => [path.basename(file), hashFile(file)]));
  const manifest = {
    schemaVersion: 3,
    businessDate: date,
    createdAt: new Date().toISOString(),
    folder,
    photoDir,
    expectedPrintedPrefix: expectedPrintedPrefix(date),
    counts: {
      allImages: imageFiles.length,
      blessing: blessing.length,
      lampScene: lampScenes.length,
      waterScene: waterScenes.length,
      unexpected: unexpected.length,
      foreignBlessing: foreignBlessing.length,
      pdf: pdfFiles.length,
      pdfPages: pdfPageCount,
      missingBlessing: missingBlessingCount,
      extraBlessing: extraBlessingCount,
    },
    files: { blessing, lampScenes, waterScenes, unexpected, foreignBlessing },
    inspections: allInspections,
    ocrSuggestions,
    pdfs,
    // errors 仅供旧版界面诊断读取；新流程以 blockingErrors 判断是否可安全继续。
    errors: [...blockingErrors, ...manualIssues],
    blockingErrors,
    manualIssues,
    sceneManualIssues,
    requiredSceneModes,
    warnings,
    blessingReady: blockingErrors.length === 0,
    uploadReady: blockingErrors.length === 0 && blessing.length > 0,
    batchCompleteReady: blockingErrors.length === 0 && manualIssues.length === 0 && missingBlessingCount === 0,
    fileHashes,
    fileSetHash: digestFiles.length ? hashManifestFiles(digestFiles) : null,
  };
  return manifest;
}

export function splitUploadBatches(files, size = MAX_UPLOAD_BATCH) {
  const batches = [];
  for (let index = 0; index < files.length; index += size) batches.push(files.slice(index, index + size));
  return batches;
}

export function assertUnchangedManifest(manifest) {
  const files = [...manifest.files.blessing, ...manifest.files.lampScenes, ...manifest.files.waterScenes];
  for (const file of files) if (!fs.existsSync(file)) throw new Error(`预检后文件已不存在：${file}`);
  const currentHash = hashManifestFiles(files);
  if (currentHash !== manifest.fileSetHash) throw new Error('预检后图片内容或文件名已经变化，请重新执行照片预检。');
}
