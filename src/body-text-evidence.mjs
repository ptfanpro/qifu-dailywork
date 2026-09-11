// Diagnostic evidence only: no filename, printed number, inferred sequence or
// highest-score-to-assignment conversion. Product use is veto-only; these
// observations never grant or repair an order binding.
import crypto from 'node:crypto';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

export function bodyTextGrams(text, size = 4) {
  if (!Number.isInteger(size) || size < 3) throw Error('Body grams must contain at least three characters');
  const result = new Set();
  // Ignore digits/Latin codes; whitespace within Chinese OCR lines is harmless.
  // Keep punctuation/digit boundaries so unrelated text is not glued together.
  const segments = String(text || '').split(/[\r\n\u2028\u2029]+/u)
    .flatMap(line => line.normalize('NFKC').replace(/\s+/gu, '').match(/\p{Script=Han}+/gu) || []);
  for (const segment of segments) {
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
    if (page.supplementalText !== undefined && (!Array.isArray(page.supplementalText)
      || page.supplementalText.some(text => typeof text !== 'string'))) throw Error('Invalid supplemental body text');
    if (page.fieldTexts !== undefined && (!Array.isArray(page.fieldTexts)
      || page.fieldTexts.some(text => typeof text !== 'string'))) throw Error('Invalid extracted body fields');
    // Union sources rather than concatenating them. A phrase split between a
    // text layer and an OCR view is not an observed phrase on the actual page.
    // Extraction order is not spatial adjacency. When item boundaries exist,
    // keep them even if a legacy display string concatenates the whole page.
    const extracted = page.fieldTexts ?? [page.text || ''];
    const grams = new Set([...extracted, ...(page.supplementalText || [])].flatMap(text => [...bodyTextGrams(text)]));
    // A lone OCR typo on a PDF is an observation, not a page-specific fact.
    // Preserve it in the raw corpus/frequency, but corroborate negative page
    // evidence using the extracted text or both views of the same layout.
    // Never join fragments, cross orientations or infer from the photo answer.
    const corroborated = new Set(extracted.flatMap(text => [...bodyTextGrams(text)]));
    if (page.visibleFieldViews !== undefined) {
      const views = page.visibleFieldViews;
      if (!Array.isArray(views) || views.length !== visualBodyViewNames.length
        || page.supplementalText?.length !== visualBodyViewNames.length) throw Error('Incomplete PDF visual views');
      const ordered = visualBodyViewNames.map(name => views.filter(v => v?.view === name));
      if (ordered.some(rows => rows.length !== 1)) throw Error('Duplicate or missing PDF visual view');
      const readings = ordered.flat();
      if (readings.some((v,i) => v.errors !== 0 || v.truncated !== false || typeof v.text !== 'string'
        || v.text !== page.supplementalText[i])) throw Error('Invalid PDF visual source');
      for (const offset of [0,2]) {
        const first = bodyTextGrams(readings[offset].text), second = bodyTextGrams(readings[offset+1].text);
        for (const gram of first) if (second.has(gram)) corroborated.add(gram);
      }
    }
    return {id, pdfSha256: page.pdfSha256, pageNumber: page.pageNumber, grams, corroborated};
  });
  const frequency = new Map();
  for (const page of records) for (const gram of page.grams) frequency.set(gram, (frequency.get(gram) || 0) + 1);
  const observed = bodyTextGrams(photoText);
  const ranked = records.map(page => {
    const matched = [...page.grams].filter(gram => observed.has(gram));
    const unique = matched.filter(gram => frequency.get(gram) === 1);
    const corroboratedUnique = unique.filter(gram => page.corroborated.has(gram));
    return {pdfSha256: page.pdfSha256, pageNumber: page.pageNumber, pageGrams: page.grams.size,
      matchedGrams: matched.length, uniqueMatchedGrams: unique.length,
      corroboratedUniqueMatchedGrams: corroboratedUnique.length,
      corroboratedUniqueEvidenceSha256: sha(corroboratedUnique.sort().join('\n')),
      uniqueEvidenceSha256: sha(unique.sort().join('\n'))};
  }).sort((a, b) => b.uniqueMatchedGrams - a.uniqueMatchedGrams || b.matchedGrams - a.matchedGrams
    || a.pdfSha256.localeCompare(b.pdfSha256) || a.pageNumber - b.pageNumber);
  return {status: 'diagnostic-only-not-binding', observedGrams: observed.size,
    textBearingPages: records.filter(page => page.grams.size > 0).length, totalPages: pages.length,
    topUniqueTieCount: ranked.filter(page => page.uniqueMatchedGrams === ranked[0]?.uniqueMatchedGrams).length,
    ranked};
}
