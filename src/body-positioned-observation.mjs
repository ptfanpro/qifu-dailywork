// Structural validation of private OCR observations, never page/order identity.
// A valid transcript is insufficient when a caller requires field positions.
import {visualBodyViewNames} from './pdf-visual-body-evidence.mjs';
import {horizontalBodyCrop, verticalBodyCrop} from './vertical-body-regions.mjs';

const regionKeys = ['left', 'top', 'width', 'height', 'score'];
const sameRecord = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length
  && Object.keys(b).every(key => Object.hasOwn(a, key) && a[key] === b[key]);

export function validPositionedBodyViews(views) {
  try {
    if (!Array.isArray(views) || views.length !== visualBodyViewNames.length
      || !visualBodyViewNames.every(name => views.filter(view => view?.view === name).length === 1)) return false;
    let dimensions;
    const observedRegions = new Map(), layoutCounts = new Map();
    for (const view of views) {
      const vertical = view.view.startsWith('chinese-vertical-');
      const padding = view.view.endsWith('-0.35') ? .35 : .65;
      const limit = vertical ? 80 : 300, positioned = view.positioned;
      if (view.errors !== 0 || view.truncated !== false || typeof view.text !== 'string'
        || !Number.isInteger(view.regions) || view.regions < 0 || view.regions > limit
        || !Number.isInteger(view.lineCount) || view.lineCount < 0 || view.lineCount > view.regions
        || positioned?.schemaVersion !== 1 || !Array.isArray(positioned.fields)
        || positioned.fields.length !== view.lineCount) return false;
      const size = positioned.dimensions;
      if (!size || !['width', 'height'].every(key => Number.isSafeInteger(size[key]) && size[key] > 0)
        || Object.keys(size).length !== 2 || (dimensions && !sameRecord(size, dimensions))) return false;
      dimensions = size;
      if (layoutCounts.has(vertical) && layoutCounts.get(vertical) !== view.regions) return false;
      layoutCounts.set(vertical, view.regions);
      let lastRegionIndex = -1;
      for (const field of positioned.fields) {
        if (!field || !Number.isInteger(field.regionIndex) || field.regionIndex <= lastRegionIndex
          || field.regionIndex >= 1000 || typeof field.text !== 'string'
          || !Number.isFinite(field.confidence) || field.confidence < .65 || field.confidence > 1) return false;
        lastRegionIndex = field.regionIndex;
        const region = field.region;
        if (!region || Object.keys(region).length !== regionKeys.length
          || !regionKeys.every(key => Number.isFinite(region[key])) || region.score < 0 || region.score > 1) return false;
        const crop = (vertical ? verticalBodyCrop : horizontalBodyCrop)(region, size, padding);
        if (!crop || !sameRecord(field.crop, crop)) return false;
        const previous = observedRegions.get(field.regionIndex);
        if (previous && !sameRecord(previous, region)) return false;
        observedRegions.set(field.regionIndex, region);
      }
      if (view.text !== positioned.fields.map(field => field.text).join('。')) return false;
    }
    return true;
  } catch { return false; }
}
