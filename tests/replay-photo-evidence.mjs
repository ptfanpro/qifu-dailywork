import fs from 'node:fs';
import path from 'node:path';
import { inferPhotoSequences } from '../src/photo-prepare.mjs';

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
inferPhotoSequences(plan.recognized, new Set(plan.pdfPages.map((page) => page.number)));
console.log(JSON.stringify(plan.recognized.map((item) => ({ name: path.basename(item.file), reliable: item.reliable, number: item.number, method: item.evidence?.method })), null, 2));
