// Local Chinese body observation reader. It never assigns numbers or orders.
// Fixed RapidAI v3.9.2 model. Its embedded character metadata is authoritative;
// an English dictionary cannot be substituted. Resize/normalization follows
// PaddleOCR release/2.7 tools/infer/predict_rec.py (BGR, CHW, [-1, 1]).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {decodePaddleCtc} from './local-ocr.mjs';
import {createTextDetector} from './body-text-detector.mjs';
import {verticalBodyCrop} from './vertical-body-regions.mjs';
const require = createRequire(import.meta.url), sharp = require('sharp');
export const CHINESE_BODY_MODEL_SHA256 = '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b';

// Read length-delimited metadata only; not a graph parser or model evaluator.
// ONNX v1.16.2 ModelProto field 14 / StringStringEntryProto fields 1 and 2.
function lengthFields(buffer) {
  let position = 0;
  function varint() {
    let value = 0;
    for (let shift = 0; shift <= 49; shift += 7) {
      if (position >= buffer.length) throw Error('Truncated ONNX metadata');
      const byte = buffer[position++];
      value += (byte & 127) * 2 ** shift;
      if (byte < 128 && Number.isSafeInteger(value)) return value;
    }
    throw Error('Invalid ONNX metadata varint');
  }
  const result = [];
  while (position < buffer.length) {
    const tag = varint(), field = Math.floor(tag / 8), wire = tag % 8;
    if (!field) throw Error('Invalid ONNX metadata field');
    if (wire === 0) varint();
    else if (wire === 2) {
      const length = varint(), end = position + length;
      if (end > buffer.length || !Number.isSafeInteger(end)) throw Error('Truncated ONNX metadata');
      result.push([field, buffer.subarray(position, end)]);
      position = end;
    } else if (wire === 1) position += 8;
    else if (wire === 5) position += 4;
    else throw Error('Unsupported ONNX metadata wire type');
    if (position > buffer.length) throw Error('Truncated ONNX metadata');
  }
  return result;
}

export function embeddedChineseDictionary(buffer) {
  const candidates = lengthFields(buffer).filter(([field]) => field === 14).map(([, value]) => lengthFields(value))
    .filter(fields => fields.some(([field, value]) => field === 1 && value.toString('utf8') === 'character'));
  if (candidates.length !== 1) throw Error('Missing or duplicate character metadata');
  const values = candidates[0].filter(([field]) => field === 2);
  if (values.length !== 1) throw Error('Missing or duplicate character dictionary');
  const dictionary = values[0][1].toString('utf8').split(/\r?\n/);
  // Space is appended by Paddle's CTC decoder, not part of the source alphabet.
  if (dictionary.at(-1) === '') dictionary.pop();
  if (!dictionary.length || dictionary.some(character => !character)) throw Error('Empty character entry');
  return dictionary;
}

export async function createChineseBodyReader(appRoot, modelRoot) {
  const modelFile = path.join(modelRoot, 'ch_PP-OCRv4_rec_mobile.onnx');
  const bytes = fs.readFileSync(modelFile);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== CHINESE_BODY_MODEL_SHA256) throw Error('Untrusted Chinese model');
  const dictionary = embeddedChineseDictionary(bytes);
  if (!dictionary.some(character => /\p{Script=Han}/u.test(character))) throw Error('Chinese dictionary required');
  const ort = require(path.join(appRoot, 'vendor/onnxruntime-node'));
  const session = await ort.InferenceSession.create(bytes, {executionProviders: ['cpu'], logSeverityLevel: 3,
    intraOpNumThreads: 2, interOpNumThreads: 1});
  let detector;
  try { detector = await createTextDetector(appRoot, path.join(modelRoot, 'ch_PP-OCRv4_det_mobile.onnx')); }
  catch (error) { await session.release(); throw error; }
  async function readLine(source) {
    const decoded = await sharp(source).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject: true});
    const height = 48, resizedWidth = Math.ceil(height * decoded.info.width / decoded.info.height);
    if (resizedWidth > 2048) return {text: '', confidence: 0, reason: 'line-too-wide'};
    const width = Math.max(320, resizedWidth);
    const rgb = await sharp(decoded.data, {raw: decoded.info}).resize(resizedWidth, height, {fit: 'fill', kernel: 'linear'}).raw().toBuffer();
    const plane = width * height, values = new Float32Array(plane * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < resizedWidth; x++) for (let c = 0; c < 3; c++) {
      values[c * plane + y * width + x] = (rgb[(y * resizedWidth + x) * 3 + 2 - c] / 255 - .5) / .5;
    }
    const outputs = await session.run({[session.inputNames[0]]: new ort.Tensor('float32', values, [1, 3, height, width])});
    return decodePaddleCtc(outputs[session.outputNames[0]], dictionary);
  }
  return {modelSha256: CHINESE_BODY_MODEL_SHA256, dictionaryLength: dictionary.length, readLine,
    async read(source, {includeVertical = false} = {}) {
      const {regions, original} = await detector.detect(source);
      const eligible = regions.filter(region => region.width / region.height >= 1.4 && region.height <= .12);
      const views = [];
      for (const padding of [.35, .65]) {
        const lines = []; let errors = 0;
        for (const region of eligible.slice(0, 300)) {
          const pad = region.height * padding;
          const left = Math.max(0, Math.floor((region.left - pad) * original.info.width));
          const top = Math.max(0, Math.floor((region.top - pad) * original.info.height));
          const right = Math.min(original.info.width, Math.ceil((region.left + region.width + pad) * original.info.width));
          const bottom = Math.min(original.info.height, Math.ceil((region.top + region.height + pad) * original.info.height));
          const crop = await sharp(original.data, {raw: original.info}).extract({left, top, width: right - left, height: bottom - top}).png().toBuffer();
          try {
            const reading = await readLine(crop);
            if (reading.confidence >= .65) lines.push(reading.text);
          } catch { errors++; }
        }
        views.push({view: `chinese-detected-${padding}`, text: lines.join('。'), lineCount: lines.length,
          errors, regions: eligible.length, truncated: eligible.length > 300});
      }
      // Opt-in while held-out evaluation is in progress. These are additional
      // views of ONE model, never independent engines or automatic bindings.
      if (includeVertical) for (const padding of [.35, .65]) {
        const crops = regions.map(r => verticalBodyCrop(r, original.info, padding)).filter(Boolean);
        const lines = []; let errors = 0;
        for (const {rotation, ...extract} of crops.slice(0, 80)) {
          try {
            const crop = await sharp(original.data, {raw: original.info}).extract(extract).rotate(rotation).png().toBuffer();
            const reading = await readLine(crop);
            if (reading.confidence >= .65) lines.push(reading.text);
          } catch { errors++; }
        }
        views.push({view: `chinese-vertical-${padding}`, text: lines.join('。'), lineCount: lines.length,
          errors, regions: crops.length, truncated: crops.length > 80});
      }
      return views;
    },
    async release() { try { await detector.release(); } finally { await session.release(); } },
  };
}
