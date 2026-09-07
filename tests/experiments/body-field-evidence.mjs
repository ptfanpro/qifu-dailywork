// Field availability diagnostic only. Neither short names, field coverage nor
// a unique page candidate proves full page/order binding. Never import in src.
import crypto from 'node:crypto';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const id = page => `${page.pdfSha256}:${page.pageNumber}`;
const normalize = text => text.normalize('NFKC').replace(/\s+/gu, '');
const runs = text => normalize(text).match(/\p{Script=Han}+/gu) || [];

export function compareBodyFieldEvidence(views, pages) {
  if (!Array.isArray(pages) || !pages.length || pages.some(p => !/^[a-f0-9]{64}$/.test(p.pdfSha256 || '')
    || !Number.isInteger(p.pageNumber) || p.pageNumber < 1 || !Array.isArray(p.fieldTexts)
    || p.fieldTexts.some(t => typeof t !== 'string') || !Array.isArray(p.supplementalText)
    || p.supplementalText.some(t => typeof t !== 'string'))) throw Error('Invalid field corpus');
  if (new Set(pages.map(id)).size !== pages.length) throw Error('Duplicate field page identity');
  if (!Array.isArray(views) || views.length !== visualBodyViewNames.length
    || visualBodyViewNames.some(name => views.filter(v => v.view === name).length !== 1)) throw Error('Incomplete field views');
  if (views.some(v => typeof v.text !== 'string' || v.errors !== 0 || v.truncated !== false)) {
    throw Error('Failed or truncated field views');
  }
  const corpus = pages.map(page => {
    // One PDF text item is one extraction boundary. Do not form a name by
    // joining adjacent fields, page fragments, or text/visual sources.
    const fields = page.fieldTexts.flatMap(runs).filter(t => [...t].length >= 2 && [...t].length <= 40);
    const allVisibleRuns = [...page.fieldTexts, ...page.supplementalText].flatMap(runs);
    return {...page, fields, terms: [...new Set(fields)], allVisibleRuns};
  });
  const frequency = new Map();
  for (const term of new Set(corpus.flatMap(p => p.terms))) {
    // Equality of extracted fields is insufficient: also exclude terms inside
    // longer fields or visible template OCR on ANY other candidate page.
    frequency.set(term, corpus.filter(p => p.allVisibleRuns.some(text => text.includes(term))).length);
  }
  const readings = visualBodyViewNames.map(name => {
    const view = views.find(v => v.view === name), observed = new Set(runs(view.text));
    const ranked = corpus.map(page => {
      const exact = page.terms.filter(term => observed.has(term));
      const specific = exact.filter(term => frequency.get(term) === 1);
      return {pdfSha256: page.pdfSha256, pageNumber: page.pageNumber,
        extractedFields: page.fields.length, distinctExtractedFields: page.terms.length,
        exactFields: exact.length, missingExtractedFields: page.terms.length - exact.length,
        specificExactFields: specific.length, shortSpecificFields: specific.filter(t => [...t].length <= 3).length,
        observedAllExtractedDistinctFields: page.terms.length > 0 && exact.length === page.terms.length,
        evidenceSha256: sha(specific.sort().join('\n'))};
    }).sort((a, b) => b.specificExactFields - a.specificExactFields || b.exactFields - a.exactFields
      || a.pdfSha256.localeCompare(b.pdfSha256) || a.pageNumber - b.pageNumber);
    const candidates = ranked.filter(p => p.specificExactFields > 0);
    return {view: name, observedDistinctRuns: observed.size, ranked,
      state: candidates.length > 1 ? 'multiple-page-field-evidence'
        : candidates.length === 1 ? 'single-page-field-candidate' : 'no-specific-field-evidence'};
  });
  const layouts = [readings.slice(0, 2), readings.slice(2)];
  let state = 'no-specific-field-evidence';
  if (readings.some(r => r.state === 'multiple-page-field-evidence')) state = 'multiple-page-field-evidence';
  else {
    const informative = layouts.filter(pair => pair.some(r => r.state === 'single-page-field-candidate'));
    if (informative.length) {
      if (informative.some(pair => pair.some(r => r.state !== 'single-page-field-candidate')
        || id(pair[0].ranked[0]) !== id(pair[1].ranked[0]))) state = 'inconsistent-field-views';
      else if (new Set(informative.map(pair => id(pair[0].ranked[0]))).size > 1) state = 'inconsistent-field-views';
      else state = 'single-page-field-candidate';
    }
  }
  return {status: 'diagnostic-only-not-binding', state, pages: pages.length, readings,
    note: 'Exact short fields and extracted-field coverage do not prove visual completeness, region alignment, multiplicity or order identity. No assignments.'};
}
