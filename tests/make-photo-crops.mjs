import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const [file, outputDir] = process.argv.slice(2);
const layouts = [
  { name: 'tablet', left: 0.46, top: 0.31, width: 0.20, height: 0.12 },
  { name: 'temple', left: 0.50, top: 0.37, width: 0.20, height: 0.13 },
  { name: 'outdoor', left: 0.48, top: 0.49, width: 0.20, height: 0.14 },
  { name: 'temple-current-code', left: 0.56, top: 0.44, width: 0.32, height: 0.14 },
  { name: 'outdoor-current-code', left: 0.62, top: 0.28, width: 0.34, height: 0.18 },
];
fs.mkdirSync(outputDir, { recursive: true });
const input = fs.readFileSync(file);
const sourceMetadata = await sharp(input).metadata();
const metadata = [5, 6, 7, 8].includes(Number(sourceMetadata.orientation || 1))
  ? { ...sourceMetadata, width: sourceMetadata.height, height: sourceMetadata.width }
  : sourceMetadata;
console.log(JSON.stringify({ sourceWidth: sourceMetadata.width, sourceHeight: sourceMetadata.height, orientation: sourceMetadata.orientation, width: metadata.width, height: metadata.height }));
for (const layout of layouts) {
  const left = Math.floor(metadata.width * layout.left);
  const top = Math.floor(metadata.height * layout.top);
  const width = Math.floor(metadata.width * layout.width);
  const height = Math.floor(metadata.height * layout.height);
  const base = sharp(input).rotate().extract({ left, top, width, height }).resize({ width: 1200 });
  await base.clone().png().toFile(path.join(outputDir, `${layout.name}.png`));
  await base.clone().greyscale().normalize().sharpen({ sigma: 1 }).png().toFile(path.join(outputDir, `${layout.name}-gray.png`));
  await base.clone().greyscale().normalize().threshold(160).png().toFile(path.join(outputDir, `${layout.name}-binary.png`));
}
