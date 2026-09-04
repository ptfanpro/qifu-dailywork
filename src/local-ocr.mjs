import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const MODEL_SHA256 = '70b2450eed39599af6b996c27a2f1a0ef30eeb49f9f66dd3e74f28f652befc89';
const DICTIONARY_SHA256 = '8459e5659185f87d62195cb495f2677493bade134182bfb8c54bf21757b28cdf';
const sessionCache = new Map();
const integrityCache = new Map();

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runtimePaths(appRoot) {
  const resolvedRoot = path.resolve(appRoot);
  return {
    runtimeRoot: path.join(resolvedRoot, 'vendor', 'onnxruntime-node'),
    model: path.join(resolvedRoot, 'models', 'paddleocr-en-v5', 'inference.onnx'),
    dictionary: path.join(resolvedRoot, 'models', 'paddleocr-en-v5', 'ppocrv5_en_dict.txt'),
  };
}

export function verifyLocalOcrAssets(appRoot) {
  const key = path.resolve(appRoot);
  if (integrityCache.has(key)) return integrityCache.get(key);
  const files = runtimePaths(appRoot);
  const result = { available: false, engine: 'paddleocr-en-v5-onnx-cpu', ...files };
  try {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error(`不支持的系统架构：${process.platform}/${process.arch}`);
    }
    for (const file of [files.model, files.dictionary, path.join(files.runtimeRoot, 'package.json')]) {
      if (!fs.existsSync(file)) throw new Error(`缺少本地 OCR 文件：${path.basename(file)}`);
    }
    const modelSha256 = sha256(files.model);
    const dictionarySha256 = sha256(files.dictionary);
    if (modelSha256 !== MODEL_SHA256) throw new Error('本地 OCR 模型哈希不一致。');
    if (dictionarySha256 !== DICTIONARY_SHA256) throw new Error('本地 OCR 字典哈希不一致。');
    result.available = true;
    result.modelSha256 = modelSha256;
    result.dictionarySha256 = dictionarySha256;
  } catch (error) {
    result.error = error.message;
  }
  integrityCache.set(key, result);
  return result;
}

async function loadSession(appRoot) {
  const key = path.resolve(appRoot);
  if (sessionCache.has(key)) return sessionCache.get(key);
  const pending = (async () => {
    const assets = verifyLocalOcrAssets(appRoot);
    if (!assets.available) throw new Error(assets.error);
    const ort = require(assets.runtimeRoot);
    const dictionary = fs.readFileSync(assets.dictionary, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line, index, rows) => line.length || index < rows.length - 1);
    if (dictionary.length !== 436) throw new Error(`本地 OCR 字典应为 436 项，实际 ${dictionary.length} 项。`);
    const session = await ort.InferenceSession.create(assets.model, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3,
    });
    return { ort, session, dictionary };
  })();
  sessionCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    sessionCache.delete(key);
    throw error;
  }
}

async function imageTensor(file, ort) {
  const metadata = await sharp(file).metadata();
  const sourceWidth = Number(metadata.width || 1);
  const sourceHeight = Number(metadata.height || 1);
  const resizedWidth = Math.max(8, Math.min(320, Math.ceil((48 * sourceWidth) / sourceHeight)));
  const { data } = await sharp(file)
    .removeAlpha()
    .resize({ width: resizedWidth, height: 48, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = 48 * 320;
  const values = new Float32Array(plane * 3);
  for (let y = 0; y < 48; y += 1) {
    for (let x = 0; x < resizedWidth; x += 1) {
      const source = (y * resizedWidth + x) * 3;
      const target = y * 320 + x;
      // PaddleOCR 的识别预处理使用 BGR、[-1, 1]、CHW；右侧留 0 填充。
      values[target] = (data[source + 2] / 255 - 0.5) / 0.5;
      values[plane + target] = (data[source + 1] / 255 - 0.5) / 0.5;
      values[plane * 2 + target] = (data[source] / 255 - 0.5) / 0.5;
    }
  }
  return new ort.Tensor('float32', values, [1, 3, 48, 320]);
}

function rowProbabilities(data, offset, classes) {
  let inProbabilityRange = true;
  let total = 0;
  for (let i = 0; i < classes; i += 1) {
    const value = data[offset + i];
    if (value < 0 || value > 1) inProbabilityRange = false;
    total += value;
  }
  if (inProbabilityRange && total > 0.8 && total < 1.2) return null;
  let maximum = -Infinity;
  for (let i = 0; i < classes; i += 1) maximum = Math.max(maximum, data[offset + i]);
  let denominator = 0;
  const probabilities = new Float32Array(classes);
  for (let i = 0; i < classes; i += 1) {
    probabilities[i] = Math.exp(data[offset + i] - maximum);
    denominator += probabilities[i];
  }
  for (let i = 0; i < classes; i += 1) probabilities[i] /= denominator;
  return probabilities;
}

export function decodePaddleCtc(output, dictionary) {
  const dimensions = output.dims || output.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length !== 3) throw new Error('本地 OCR 输出维度无效。');
  const steps = Number(dimensions[1]);
  const classes = Number(dimensions[2]);
  if (classes !== dictionary.length + 2) throw new Error(`本地 OCR 输出类别 ${classes} 与字典不匹配。`);
  const characters = [];
  const confidences = [];
  let previous = -1;
  for (let step = 0; step < steps; step += 1) {
    const offset = step * classes;
    const probabilities = rowProbabilities(output.data, offset, classes);
    let best = 0;
    let confidence = -Infinity;
    for (let index = 0; index < classes; index += 1) {
      const value = probabilities ? probabilities[index] : output.data[offset + index];
      if (value > confidence) {
        confidence = value;
        best = index;
      }
    }
    if (best !== 0 && best !== previous) {
      const character = best === classes - 1 ? ' ' : dictionary[best - 1];
      if (character != null) {
        characters.push(character);
        confidences.push(confidence);
      }
    }
    previous = best;
  }
  return {
    text: characters.join(''),
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0,
  };
}

export async function recognizeLocalTextLine(appRoot, file) {
  const { ort, session, dictionary } = await loadSession(appRoot);
  const tensor = await imageTensor(file, ort);
  const output = await session.run({ [session.inputNames[0]]: tensor });
  return decodePaddleCtc(output[session.outputNames[0]], dictionary);
}

export const LOCAL_OCR_MODEL_SHA256 = MODEL_SHA256;
export const LOCAL_OCR_DICTIONARY_SHA256 = DICTIONARY_SHA256;
