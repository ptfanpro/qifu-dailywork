// Pixel-only evidence. No filenames, PDF counts, dates, or OCR guesses participate.
// Count small isolated bright warm components spread across the lower scene.
// A large yellow sheet or one bright lamp must not satisfy this test.
export function measureFlameStructure(data, width, height, channels = 3) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16
    || channels < 3 || data.length !== width * height * channels) throw new Error('Invalid RGB scene buffer');
  const n = width * height;
  const mask = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2];
    mask[i] = r >= 180 && g >= 125 && r >= g * .98 && g >= b * 1.12 ? 1 : 0;
  }
  const points = [];
  for (let seed = 0; seed < n; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0, tail = 0, sx = 0, sy = 0, minX = width, maxX = 0, minY = height, maxY = 0;
    queue[tail++] = seed; seen[seed] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      sx += x; sy += y; minX = Math.min(minX,x); maxX = Math.max(maxX,x); minY = Math.min(minY,y); maxY = Math.max(maxY,y);
      for (const next of [x > 0 ? i-1 : -1, x+1 < width ? i+1 : -1, y > 0 ? i-width : -1, y+1 < height ? i+width : -1]) {
        if (next >= 0 && mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    const x = sx / tail / width, y = sy / tail / height;
    if (tail >= 2 && tail <= n * .003 && (maxX-minX+1)/width <= .07 && (maxY-minY+1)/height <= .09 && y >= .35) points.push({x,y});
  }
  const columns = new Set(points.map(p=>Math.floor(p.x * 5))).size;
  const rows = new Set(points.map(p=>Math.floor(p.y * 8))).size;
  const spanX = points.length ? Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)) : 0;
  const spanY = points.length ? Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)) : 0;
  return { count:points.length, columns, rows, spanX, spanY,
    distributed:points.length >= 10 && columns >= 3 && rows >= 2 && spanX >= .35 && spanY >= .12 };
}
