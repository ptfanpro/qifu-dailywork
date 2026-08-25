import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
for (const file of process.argv.slice(2)) {
  const { data, info } = await sharp(fs.readFileSync(file)).rotate().resize({ width: 160, height: 120, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  let yellow = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
    if (r > 105 && r > g * 1.45 && b > g * 1.05 && r > b * 1.10) red += 1;
    if (r > 140 && g > 100 && b < 115 && r > g * 1.05 && r - g < 105) yellow += 1;
  }
  console.log(JSON.stringify({ file, red, yellow, pixels: info.width * info.height, redRatio: red / (info.width * info.height), yellowRatio: yellow / (info.width * info.height) }));
}
