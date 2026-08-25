import fs from 'node:fs';
import path from 'node:path';
import { diagnosePhotoCode } from '../src/photo-prepare.mjs';

const [appRoot, sourceDir, cropDir, ...names] = process.argv.slice(2);
for (const name of names) {
  const result = await diagnosePhotoCode({
    appRoot,
    file: path.join(sourceDir, name),
    expectedPrefix: '268',
    expectedNumbers: Array.from({ length: 16 }, (_, index) => 319 + index),
    cropDir: path.join(cropDir, String(names.indexOf(name))),
  });
  console.log(JSON.stringify({ name, reliable: result.reliable, number: result.number, evidence: result.evidence, candidates: result.candidates }));
}
