// Diagnostic corpus construction only. Completing the read of every page does
// NOT prove that every visible character was recognized, nor permit binding.
export const visualBodyViewNames = ['chinese-detected-0.35', 'chinese-detected-0.65',
  'chinese-vertical-0.35', 'chinese-vertical-0.65'];

function pageIdentity(page) {
  if (!/^[a-f0-9]{64}$/.test(page.pdfSha256 || '') || !Number.isInteger(page.pageNumber) || page.pageNumber < 1) {
    throw Error('Invalid PDF page identity');
  }
  return `${page.pdfSha256}:${page.pageNumber}`;
}

export function buildVisualBodyPages(pages, readings) {
  if (!Array.isArray(pages) || !pages.length || !Array.isArray(readings) || pages.length !== readings.length) {
    throw Error('Incomplete visual PDF page set');
  }
  const identities = pages.map(pageIdentity);
  if (new Set(identities).size !== identities.length) throw Error('Duplicate source PDF page');
  const byId = new Map();
  for (const reading of readings) {
    const id = pageIdentity(reading);
    if (byId.has(id) || !identities.includes(id)) throw Error('Duplicate or unexpected visual PDF page');
    if (!Array.isArray(reading.views) || reading.views.length !== visualBodyViewNames.length) {
      throw Error('Incomplete visual PDF views');
    }
    const views = visualBodyViewNames.map(name => reading.views.filter(view => view.view === name));
    if (views.some(values => values.length !== 1)) throw Error('Incomplete or duplicate visual PDF views');
    if (views.flat().some(view => view.errors !== 0 || view.truncated !== false || typeof view.text !== 'string')) {
      throw Error('Failed or truncated visual PDF read');
    }
    byId.set(id, views.flat().map(view => view.text));
  }
  return pages.map((page, index) => ({...page, supplementalText: byId.get(identities[index])}));
}
