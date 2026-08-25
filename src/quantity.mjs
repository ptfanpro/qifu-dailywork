export function normalizeText(value) {
  return String(value ?? '').replace(/[\u00ad\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, '').trim();
}

function numberValue(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) throw new Error(`无效数量：${value}`);
  return n;
}

export function physicalCount(productName, singleQuantity, quantity) {
  const name = normalizeText(productName);
  let multiplier = numberValue(singleQuantity || 1);
  const bundle = name.match(/(7|49|108)盏/);
  if (bundle && /(佛缘|莲花)/.test(name)) multiplier = Number(bundle[1]);
  return multiplier * numberValue(quantity || 0);
}

export function calculateQuantities(rows) {
  const totals = { nine: 0, three: 0, one: 0, water: 0 };
  for (const row of rows) {
    const name = normalizeText(row.productName ?? row.name);
    const count = physicalCount(name, row.singleQuantity ?? 1, row.quantity ?? 0);
    if (/供水养净/.test(name)) totals.water += count;
    else if (/(莲花|往生).*(灯)|灯.*(莲花|往生)/.test(name)) totals.nine += count;
    else if (/吉祥.*灯|灯.*吉祥/.test(name)) totals.three += count;
    else if (/佛缘.*灯|灯.*佛缘/.test(name)) totals.one += count;
  }
  return totals;
}

export function venueMessage(totals) {
  return [
    '师兄 今天',
    `9元灯${totals.nine}盏`,
    `3元灯${totals.three}盏`,
    `1元灯${totals.one}盏`,
    `供水${totals.water}份`,
    '辛苦您',
  ].join('\n');
}
