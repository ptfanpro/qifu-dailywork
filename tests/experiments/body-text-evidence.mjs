// Diagnostic evidence only: no filename, printed number, inferred sequence or
// highest-score-to-assignment conversion. Do not import into the product until
// held-out content-binding validation establishes a safe decision contract.
import crypto from 'node:crypto';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

export function bodyTextGrams(text, size = 4) {
  if (!Number.isInteger(size) || size < 3) throw Error('Body grams must contain at least three characters');
  const result = new Set();
  // Ignore digits/Latin codes; whitespace within Chinese OCR lines is harmless.
  // Keep punctuation/digit boundaries so unrelated text is not glued together.
  const normalized = String(text || '').normalize('NFKC').replace(/\s+/gu, '');
  for (const segment of normalized.match(/\p{Script=Han}+/gu) || []) {
    const chars = [...segment];
    for (let i = 0; i + size <= chars.length; i++) result.add(sha(chars.slice(i, i + size).join('')));
  }
  return result;
}

export function rankBodyTextEvidence(photoText, pages) {
  const ids = new Set();
  const records = pages.map(page => {
    if (!/^[a-f0-9]{64}$/.test(page.pdfSha256 || '') || !Number.isInteger(page.pageNumber) || page.pageNumber < 1) {
      throw Error('Body evidence requires PDF content hash and page identity');
    }
    const id = `${page.pdfSha256}:${page.pageNumber}`;
    if (ids.has(id)) throw Error('Duplicate PDF page identity');
    ids.add(id);
    return {id, pdfSha256: page.pdfSha256, pageNumber: page.pageNumber, grams: bodyTextGrams(page.text)};
  });
  const frequency = new Map();
  for (const page of records) for (const gram of page.grams) frequency.set(gram, (frequency.get(gram) || 0) + 1);
  const observed = bodyTextGrams(photoText);
  const ranked = records.map(page => {
    const matched = [...page.grams].filter(gram => observed.has(gram));
    const unique = matched.filter(gram => frequency.get(gram) === 1);
    return {pdfSha256: page.pdfSha256, pageNumber: page.pageNumber, pageGrams: page.grams.size,
      matchedGrams: matched.length, uniqueMatchedGrams: unique.length,
      uniqueEvidenceSha256: sha(unique.sort().join('\n'))};
  }).sort((a, b) => b.uniqueMatchedGrams - a.uniqueMatchedGrams || b.matchedGrams - a.matchedGrams
    || a.pdfSha256.localeCompare(b.pdfSha256) || a.pageNumber - b.pageNumber);
  return {status: 'diagnostic-only-not-binding', observedGrams: observed.size,
    textBearingPages: records.filter(page => page.grams.size > 0).length, totalPages: pages.length,
    topUniqueTieCount: ranked.filter(page => page.uniqueMatchedGrams === ranked[0]?.uniqueMatchedGrams).length,
    ranked};
}
