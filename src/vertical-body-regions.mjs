// Experimental geometry only, not evidence of document or order identity.
// Preserve the detector's region; never choose a crop from an expected code.
export function horizontalBodyCrop(region, {width, height}, padding) {
  if (![width, height].every(v => Number.isInteger(v) && v > 0)) throw Error('Invalid image dimensions');
  if (!Number.isFinite(padding) || padding < 0 || padding > 1) throw Error('Invalid region padding');
  if (!region || !['left', 'top', 'width', 'height'].every(k => Number.isFinite(region[k]) && region[k] >= 0)
    || region.width <= 0 || region.height <= 0
    || region.left + region.width > 1.000000001 || region.top + region.height > 1.000000001) throw Error('Invalid normalized region');
  const pixelWidth = region.width * width, pixelHeight = region.height * height;
  // Detector coordinates have different denominators on each axis. Compare
  // actual pixels, and pad both axes by the same physical short-side distance.
  if (pixelWidth < pixelHeight * 1.4 || region.height > .12) return null;
  const pad = pixelHeight * padding;
  const left = Math.max(0, Math.floor(region.left * width - pad));
  const top = Math.max(0, Math.floor(region.top * height - pad));
  const right = Math.min(width, Math.ceil(region.left * width + pixelWidth + pad));
  const bottom = Math.min(height, Math.ceil(region.top * height + pixelHeight + pad));
  return {left, top, width: right - left, height: bottom - top};
}

export function verticalBodyCrop(region, {width, height}, padding) {
  if (![width, height].every(v => Number.isInteger(v) && v > 0)) throw Error('Invalid image dimensions');
  if (!Number.isFinite(padding) || padding < 0 || padding > 1) throw Error('Invalid region padding');
  if (!region || !['left', 'top', 'width', 'height'].every(k => Number.isFinite(region[k]) && region[k] >= 0)
    || region.width <= 0 || region.height <= 0
    || region.left + region.width > 1.000000001 || region.top + region.height > 1.000000001) throw Error('Invalid normalized region');
  const pixelWidth = region.width * width, pixelHeight = region.height * height;
  if (pixelHeight < pixelWidth * 2.5) return null;
  const pad = pixelWidth * padding;
  const left = Math.max(0, Math.floor(region.left * width - pad));
  const top = Math.max(0, Math.floor(region.top * height - pad));
  const right = Math.min(width, Math.ceil((region.left + region.width) * width + pad));
  const bottom = Math.min(height, Math.ceil((region.top + region.height) * height + pad));
  return {left, top, width: right - left, height: bottom - top, rotation: 270};
}
