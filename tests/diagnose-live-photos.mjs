import fs from 'node:fs';
import path from 'node:path';
import { diagnosePhotoCode } from '../src/photo-prepare.mjs';

const [appRoot, sourceDir, cropDir, firstText, lastText, ...names] = process.argv.slice(2);
const first = Number(firstText);
const last = Number(lastText);
if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) {
  throw new Error('usage: node diagnose-live-photos.mjs <appRoot> <sourceDir> <cropDir> <first> <last> [names...]');
}
for (const name of names) {
  const result = await diagnosePhotoCode({
    appRoot,
    file: path.join(sourceDir, name),
    expectedPrefix: '268',
    expectedNumbers: Array.from({ length: last - first + 1 }, (_, index) => first + index),
    cropDir: path.join(cropDir, String(names.indexOf(name))),
  });
  console.log(JSON.stringify({ name, reliable: result.reliable, number: result.number, evidence: result.evidence, candidates: result.candidates }));
}
