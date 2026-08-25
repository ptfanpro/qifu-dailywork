import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');

export async function verifyPdf(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 16 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error(`不是 PDF：${file}`);
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1');
  if (!tail.includes('%%EOF')) throw new Error(`PDF 不完整（缺少 EOF）：${file}`);
  const document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false });
  const pageCount = document.getPageCount();
  if (pageCount < 1) throw new Error(`PDF 没有页面：${file}`);
  return { file, bytes: bytes.length, pageCount, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function listFilesRecursive(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFilesRecursive(full));
    else result.push(full);
  }
  return result;
}

export async function waitForNewPdf(downloadDir, before, timeoutMs = 25000, alternateResult = null) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set(before);
  while (Date.now() < deadline) {
    const alternate = alternateResult ? alternateResult() : null;
    if (alternate) return alternate;
    const candidates = listFilesRecursive(downloadDir).filter((f) => !seen.has(f));
    for (const candidate of candidates) {
      try { return { path: candidate, verification: await verifyPdf(candidate) }; } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}
