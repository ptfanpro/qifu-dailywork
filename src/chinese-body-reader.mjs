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
import {horizontalBodyCrop, verticalBodyCrop} from './vertical-body-regions.mjs';
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

// Keep optional field locations tied to the exact detector region and crop.
// Plain text remains the legacy default. Locations are observations, not proof
// of a foreground paper, page identity or authorization to clear a code audit.
export async function readDetectedBodyViews(original, regions, readLine,
  {includeVertical = false, includePositions = false, readLines = null} = {}) {
  const views = [];
  for (const vertical of includeVertical ? [false, true] : [false]) for (const padding of [.35, .65]) {
    const crops = regions.map((region, regionIndex) => ({region, regionIndex,
      crop: (vertical ? verticalBodyCrop : horizontalBodyCrop)(region, original.info, padding)})).filter(v => v.crop);
    const limit = vertical ? 80 : 300, lines = [], fields = []; let errors = 0;
    const prepared = [];
    for (const item of crops.slice(0, limit)) {
      try {
        const {rotation, ...extract} = item.crop;
        let image = sharp(original.data, {raw: original.info}).extract(extract);
        if (rotation) image = image.rotate(rotation);
        prepared.push({...item, source: await image.png().toBuffer()});
      } catch { errors++; }
    }
    let readings = [];
    if (prepared.length) {
      if (readLines) {
        try { readings = await readLines(prepared.map(item => item.source)); }
        catch {
          readings = [];
          for (const item of prepared) {
            try { readings.push(await readLine(item.source)); }
            catch (error) { readings.push({error}); }
          }
        }
      } else {
        for (const item of prepared) {
          try { readings.push(await readLine(item.source)); }
          catch (error) { readings.push({error}); }
        }
      }
    }
    for (let index = 0; index < prepared.length; index++) {
      const {region, regionIndex, crop} = prepared[index], reading = readings[index];
      if (!reading || reading.error) { errors++; continue; }
      if (reading.confidence >= .65) {
        lines.push(reading.text);
        if (includePositions) fields.push({regionIndex, region: {...region}, crop: {...crop},
          text: reading.text, confidence: reading.confidence});
      }
    }
    views.push({view: `chinese-${vertical ? 'vertical' : 'detected'}-${padding}`,
      text: lines.join('。'), lineCount: lines.length, errors, regions: crops.length, truncated: crops.length > limit,
      ...(includePositions ? {positioned: {schemaVersion: 1,
        dimensions: {width: original.info.width, height: original.info.height}, fields}} : {})});
  }
  return views;
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
  async function prepareLine(source) {
    const decoded = await sharp(source).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject: true});
    const height = 48, resizedWidth = Math.ceil(height * decoded.info.width / decoded.info.height);
    if (resizedWidth > 2048) return {skipped: {text: '', confidence: 0, reason: 'line-too-wide'}};
    const width = Math.max(320, resizedWidth);
    const rgb = await sharp(decoded.data, {raw: decoded.info}).resize(resizedWidth, height, {fit: 'fill', kernel: 'linear'}).raw().toBuffer();
    const plane = width * height, values = new Float32Array(plane * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < resizedWidth; x++) for (let c = 0; c < 3; c++) {
      values[c * plane + y * width + x] = (rgb[(y * resizedWidth + x) * 3 + 2 - c] / 255 - .5) / .5;
    }
    return {height, width, values};
  }
  async function runPrepared(prepared) {
    if (prepared.skipped) return prepared.skipped;
    const outputs = await session.run({[session.inputNames[0]]:
      new ort.Tensor('float32', prepared.values, [1, 3, prepared.height, prepared.width])});
    return decodePaddleCtc(outputs[session.outputNames[0]], dictionary);
  }
  async function readLine(source) {
    return runPrepared(await prepareLine(source));
  }
  async function mapLimited(items, concurrency, visit) {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await visit(items[index], index);
      }
    }));
    return results;
  }
  async function readLines(sources, {concurrency = 4} = {}) {
    if (!Array.isArray(sources)) throw Error('Chinese OCR batch input must be an array');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
      throw Error('Chinese OCR concurrency must be an integer from 1 to 4');
    }
    const prepared = await mapLimited(sources, Math.min(2, concurrency), async source => {
      try {
        return {prepared: await prepareLine(source)};
      } catch (error) { return {error}; }
    });
    const results = new Array(sources.length);
    const narrow = [], medium = [], wide = [];
    for (let index = 0; index < prepared.length; index++) {
      const item = prepared[index];
      if (item.error) results[index] = item;
      else if (item.prepared.skipped) results[index] = item.prepared.skipped;
      else (item.prepared.width <= 700 ? narrow : item.prepared.width <= 1200 ? medium : wide)
        .push({index, prepared: item.prepared});
    }
    // Every inference still receives the exact single-line tensor used by
    // readLine. Only independent narrow lines overlap; wide lines stay serial
    // because parallel wide tensors reduce throughput and increase memory.
    const runItems = async (items, limit) => mapLimited(items, limit, async item => {
      try { return await runPrepared(item.prepared); }
      catch (error) { return {error}; }
    });
    const narrowResults = await runItems(narrow, concurrency);
    narrow.forEach((item, index) => { results[item.index] = narrowResults[index]; });
    // Some ORT/CPU combinations may reject overlapping runs on one session.
    // Retry only those failures serially before reporting the line unavailable.
    for (const item of narrow.filter(item => results[item.index]?.error)) {
      try { results[item.index] = await runPrepared(item.prepared); }
      catch (error) { results[item.index] = {error}; }
    }
    const mediumResults = await runItems(medium, Math.min(2, concurrency));
    medium.forEach((item, index) => { results[item.index] = mediumResults[index]; });
    for (const item of medium.filter(item => results[item.index]?.error)) {
      try { results[item.index] = await runPrepared(item.prepared); }
      catch (error) { results[item.index] = {error}; }
    }
    const wideResults = await runItems(wide, 1);
    wide.forEach((item, index) => { results[item.index] = wideResults[index]; });
    return results;
  }
  return {modelSha256: CHINESE_BODY_MODEL_SHA256, dictionaryLength: dictionary.length, readLine, readLines,
    async read(source, options = {}) {
      const {regions, original} = await detector.detect(source);
      return readDetectedBodyViews(original, regions, readLine, {...options, readLines});
    },
    async release() { try { await detector.release(); } finally { await session.release(); } },
  };
}
