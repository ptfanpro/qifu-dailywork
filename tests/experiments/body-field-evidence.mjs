// Field availability diagnostic only. Neither short names, field coverage nor
// a unique page candidate proves full page/order binding. Never import in src.
import crypto from 'node:crypto';
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const id = page => `${page.pdfSha256}:${page.pageNumber}`;
const normalize = text => text.normalize('NFKC').replace(/\s+/gu, '');
// Horizontal whitespace may occur inside one field, but a line break is an
// observation boundary. Never join neighboring OCR lines into a short name.
const runs = text => text.split(/[\r\n\u2028\u2029]+/u)
  .flatMap(line => normalize(line).match(/\p{Script=Han}+/gu) || []);
const fieldTerms = text => runs(text).filter(t => [...t].length >= 2 && [...t].length <= 40);

function pairedVisibleFields(page) {
  if (page.visibleFieldViews === undefined) return [];
  const views = page.visibleFieldViews;
  if (!Array.isArray(views) || views.length !== visualBodyViewNames.length
    || page.supplementalText.length !== visualBodyViewNames.length) throw Error('Incomplete visible field sources');
  const ordered = visualBodyViewNames.map(name => views.filter(v => v.view === name));
  if (ordered.some(matches => matches.length !== 1)) throw Error('Incomplete visible field views');
  const readings = ordered.flat();
  if (readings.some((v, i) => typeof v.text !== 'string' || v.errors !== 0 || v.truncated !== false
    || v.text !== page.supplementalText[i])) throw Error('Invalid visible field source identity');
  // These are two views of ONE model, not two engines or verified semantic
  // fields. Require the complete normalized run in both views of a layout;
  // never assemble a run from adjacent PDF glyphs, lines or different views.
  const paired = [];
  for (const offset of [0, 2]) {
    const first = new Set(fieldTerms(readings[offset].text));
    const second = new Set(fieldTerms(readings[offset + 1].text));
    paired.push(...[...first].filter(term => second.has(term)));
  }
  return [...new Set(paired)];
}

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
    const fields = page.fieldTexts.flatMap(fieldTerms);
    const extractedTerms = [...new Set(fields)], visibleTerms = pairedVisibleFields(page);
    const allVisibleRuns = [...page.fieldTexts, ...page.supplementalText].flatMap(runs);
    return {...page, fields, extractedTerms, visibleTerms,
      terms: [...new Set([...extractedTerms, ...visibleTerms])], allVisibleRuns};
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
      const extractedExact = page.extractedTerms.filter(term => observed.has(term));
      return {pdfSha256: page.pdfSha256, pageNumber: page.pageNumber,
        extractedFields: page.fields.length, distinctExtractedFields: page.extractedTerms.length,
        visibleConsensusFields: page.visibleTerms.length, distinctCandidateFields: page.terms.length,
        exactFields: exact.length, extractedExactFields: extractedExact.length,
        missingExtractedFields: page.extractedTerms.length - extractedExact.length,
        missingCandidateFields: page.terms.length - exact.length,
        specificExactFields: specific.length, shortSpecificFields: specific.filter(t => [...t].length <= 3).length,
        extractedSpecificExactFields: specific.filter(t => page.extractedTerms.includes(t)).length,
        visibleSpecificExactFields: specific.filter(t => page.visibleTerms.includes(t)).length,
        observedAllExtractedDistinctFields: page.extractedTerms.length > 0 && extractedExact.length === page.extractedTerms.length,
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
