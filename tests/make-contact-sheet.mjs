import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const [sourceDir, output] = process.argv.slice(2);
const files = fs.readdirSync(sourceDir).filter((name) => /\.(?:jpe?g|png)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
const columns = 4;
const cellWidth = 360;
const cellHeight = 300;
const rows = Math.ceil(files.length / columns);
const composites = [];
for (let index = 0; index < files.length; index += 1) {
  const photo = await sharp(fs.readFileSync(path.join(sourceDir, files[index])))
    .rotate()
    .resize(cellWidth, cellHeight - 40, { fit: 'contain', background: '#111' })
    .jpeg({ quality: 82 })
    .toBuffer();
  const label = Buffer.from(`<svg width="${cellWidth}" height="40"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="27" font-size="22" font-family="Arial">${index + 1}: ${files[index].replace(/&/g, '&amp;')}</text></svg>`);
  const cell = await sharp({ create: { width: cellWidth, height: cellHeight, channels: 3, background: '#fff' } })
    .composite([{ input: photo, top: 0, left: 0 }, { input: label, top: cellHeight - 40, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  composites.push({ input: cell, left: (index % columns) * cellWidth, top: Math.floor(index / columns) * cellHeight });
}
await sharp({ create: { width: columns * cellWidth, height: rows * cellHeight, channels: 3, background: '#ddd' } })
  .composite(composites)
  .jpeg({ quality: 90 })
  .toFile(output);
