import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { createWorker, PSM } = require('tesseract.js');
const { createCanvas } = require('@napi-rs/canvas');

const IMAGE_RE = /\.(?:jpe?g|png)$/i;
const MAX_IMAGE_BYTES = 1_572_864;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OCR_LAYOUTS = [
  // 2026-08-14 起的新构图：同一台相机分别拍竖版牌位、殿内横版福单和户外供水福单。
  // 三个框都只覆盖纸张右上角，命中完整 268-1-NNN 才能成为强证据。
  { name: 'temple-tablet-code-line', left: 0.58, top: 0.335, width: 0.11, height: 0.050 },
  { name: 'temple-page-code-line', left: 0.62, top: 0.425, width: 0.10, height: 0.050 },
  { name: 'outdoor-water-code-line', left: 0.60, top: 0.535, width: 0.11, height: 0.055 },
  { name: 'temple-tablet-code', left: 0.46, top: 0.31, width: 0.20, height: 0.12, sparse: true },
  { name: 'temple-page-code', left: 0.50, top: 0.37, width: 0.20, height: 0.13, sparse: true },
  { name: 'outdoor-water-code', left: 0.48, top: 0.49, width: 0.20, height: 0.14, sparse: true },
  // 当前线下相机构图的窄区域回退。动态纸张定位优先；只有定位失败才使用。
  { name: 'camera-portrait-code', left: 0.55, top: 0.245, width: 0.14, height: 0.12, sparse: true },
  { name: 'camera-landscape-code', left: 0.60, top: 0.325, width: 0.15, height: 0.12, sparse: true },
  // 8 月中旬开始，横版红/黄纸的编号被拍在画面偏下的位置；保留完整的
  // 右侧号码区，不能只截取前三位。它仍需要当天 PDF 编号范围收敛。
  { name: 'camera-lower-paper-code', left: 0.60, top: 0.475, width: 0.34, height: 0.15, sparse: true },
  { name: 'tablet-code', left: 0.615, top: 0.195, width: 0.11, height: 0.025 },
  { name: 'water-code', left: 0.745, top: 0.325, width: 0.115, height: 0.027 },
  { name: 'lamp-code', left: 0.705, top: 0.382, width: 0.09, height: 0.025 },
  // 新回传构图：纸张在画面中的高度和旧样例不同。宽区域只作为补充证据，
  // 仍必须匹配当天 PDF 明确编号范围，不能单独据此猜号。
  { name: 'upper-wide-code', left: 0.53, top: 0.18, width: 0.42, height: 0.19, sparse: true },
  { name: 'middle-wide-code', left: 0.53, top: 0.34, width: 0.42, height: 0.19, sparse: true },
];

// 2026-08-24 起线下回传的两种稳定构图。旧逻辑只使用纸色连通块定位，
// 红纸与底部红色桌布/灯座相连时会把“纸张顶边”算错，随后在错误位置穷举
// 数十次 OCR。固定的小编号框先行，既更快，也比错误的动态框可靠；只有这
// 四个小框未命中时才进入动态纸张布局和有限兜底。
const CURRENT_CAMERA_CODE_LAYOUTS = {
  temple: [
    // 2026-08-28 同一台相机出现两个新的稳定高度。供灯福单编号位于
    // y=41%~45%，供水福单位于 y=56%~59%；纸色与木架、神像相连时，
    // 动态纸框会从画面顶部一直延伸到底部，不能再由它推算编号位置。
    // 2026-08-25 起的新一批 4:3 原图把纸张整体下移，编号稳定落在
    // y=50%~53%。旧 top=47.5% 会只截到神像底座，清晰编号也会全部漏掉。
    { name: 'current-temple-code-line', left: 0.64, top: 0.49, width: 0.14, height: 0.055 },
    // 同一构图中编号实际只占画面约 12%×4%。保留上面的宽容框兼容轻微
    // 偏移，再用这个微型框隔离下方装饰线；Windows OCR 对原尺寸彩色微型框
    // 明显优于放大后的整块纸面。
    { name: 'current-temple-code-micro', left: 0.65, top: 0.495, width: 0.12, height: 0.040 },
    // 微型滑动带只保留编号本身，避开紧邻的花边。两种高度分别覆盖同批
    // 供灯福单和三张略有上下位移的供水福单。
    { name: 'current-temple-upper-code-line', left: 0.61, top: 0.405, width: 0.15, height: 0.025 },
    { name: 'current-temple-upper-code-line-shifted', left: 0.61, top: 0.415, width: 0.15, height: 0.025 },
    // 8 月 28 日末尾补拍的两张福单并不在同一高度：一张编号约在 y=54%~59%，
    // 另一张约在 y=57.5%~62%。旧窄行要么切掉数字上沿，要么把下方花边
    // 一起带入，Tesseract/Windows OCR 都会返回空。两个原彩小框只覆盖
    // “268-1-NNN”及少量纸面，供 Windows OCR 做受 PDF 编号集约束的读取。
    { name: 'current-temple-lower-code-box-high', left: 0.62, top: 0.540, width: 0.13, height: 0.050 },
    { name: 'current-temple-lower-code-box-low', left: 0.625, top: 0.575, width: 0.12, height: 0.045 },
    { name: 'current-temple-lower-code-line', left: 0.59, top: 0.570, width: 0.15, height: 0.025 },
    { name: 'current-temple-lower-code-line-shifted', left: 0.59, top: 0.585, width: 0.15, height: 0.025 },
    { name: 'current-temple-code-wide', left: 0.54, top: 0.47, width: 0.36, height: 0.16, sparse: true },
  ],
  outdoor: [
    { name: 'current-outdoor-code-line', left: 0.69, top: 0.33, width: 0.20, height: 0.080 },
    { name: 'current-outdoor-code-wide', left: 0.62, top: 0.28, width: 0.34, height: 0.18, sparse: true },
  ],
  portrait: [
    // 竖版黄纸/红纸在 1800×1350 成品图中只占画面中部，编号位于纸张
    // 右上角而不是整幅图右上角。旧版动态框贴着纸张顶边，稳定漏掉编号。
    // 牌位图存在上下两种稳定装框高度（约 y=35% 与 y=41%）。单独窄行会
    // 在两者间来回漏识别；这个窄带同时覆盖两处编号，又不包含牌位正文。
    { name: 'current-portrait-code-line', left: 0.59, top: 0.32, width: 0.15, height: 0.14 },
    { name: 'current-portrait-code-wide', left: 0.525, top: 0.305, width: 0.215, height: 0.125, sparse: true },
  ],
};

export function prioritizedPhotoLayouts(geometry, dynamicLayouts) {
  const geometryWidth = Number(geometry?.width || 0);
  const geometryHeight = Number(geometry?.height || 0);
  // 木架、红纸和背景色相连时，连通域会变成“略高于宽”的假竖版框。
  // 只有纸块本身较窄，或长宽比非常明显时才优先使用竖版裁框。
  const looksPortrait = geometryHeight > geometryWidth * 1.25
    && (geometryWidth < 0.60 || geometryHeight > geometryWidth * 1.50);
  const looksTemple = Number(geometry?.top || 0) >= 0.40;
  const looksOutdoor = Number(geometry?.width || 0) >= 0.72 && Number(geometry?.top || 0) < 0.35;
  const fixed = looksPortrait
    ? [...CURRENT_CAMERA_CODE_LAYOUTS.portrait, ...CURRENT_CAMERA_CODE_LAYOUTS.temple]
    : looksTemple
      ? [...CURRENT_CAMERA_CODE_LAYOUTS.temple, ...CURRENT_CAMERA_CODE_LAYOUTS.outdoor]
    : looksOutdoor
      ? [...CURRENT_CAMERA_CODE_LAYOUTS.outdoor, ...CURRENT_CAMERA_CODE_LAYOUTS.temple]
      : [...CURRENT_CAMERA_CODE_LAYOUTS.temple, ...CURRENT_CAMERA_CODE_LAYOUTS.outdoor];
  const ordered = [...fixed, ...(dynamicLayouts || []), ...OCR_LAYOUTS];
  const seen = new Set();
  return ordered.filter((layout) => !seen.has(layout.name) && seen.add(layout.name));
}

// 纸色连通域只用于决定尝试顺序，不能决定“只尝试哪一种构图”。木架、桌布
// 或灯座与纸张连色时，geometry 可能把横版福单误报成竖版。每种当前相机
// 构图各取一个窄编号行做有限复核，既避免恢复旧版全图穷举，也不会因单一
// 错误布局把清晰补图留在人工队列。
export function targetedCurrentCodeLayouts(layouts) {
  const seenModes = new Set();
  const selected = [];
  // prioritizedPhotoLayouts 已按构图证据把最可能的固定相机框放在首位。
  // 当纸张贴住画面底边时，动态框的 top 会随连通域漂移；先跑固定窄框可
  // 直接识别清晰编号，同时仍保留一个动态框兼容纸张位置真正变化的旧照片。
  const primaryMatch = /^current-(temple|portrait)-code-line$/.exec((layouts || [])[0]?.name || '');
  if (primaryMatch) {
    seenModes.add(primaryMatch[1]);
    selected.push(layouts[0]);
  }
  // 纸色连通域能够稳定框住整张福单时，纸张相对编号框比固定相机框更准。
  // V9.5.65 为提速把首轮限制为四个固定框，导致 2026-08-26 这批清晰
  // 供水福单右上角编号（529/531/532）完全落在首轮之外。这里只提升两个
  // 严格位于纸张右上角的窄框；完整业务前缀和当天 PDF 编号范围仍是采信
  // 前提，不恢复全图 OCR，也不会读取姓名和祈愿正文。
  for (const layoutName of [
    // 标准横版福单的编号紧贴纸张顶边。这个框原本只存在于动态布局，
    // V9.5.73 前却没有进入限量首轮，导致肉眼清晰的 268-1-529 被漏掉。
    'paper-relative-code-only',
    'paper-relative-landscape-code-upper-right',
    'paper-relative-landscape-code-lower-right',
  ]) {
    const layout = (layouts || []).find((item) => item.name === layoutName);
    if (layout && selected.length < 2) selected.push(layout);
  }
  // 新批次的上下两条严格编号带必须始终参与有限复核。它们都只覆盖右侧
  // 短编码，不读取正文；即使纸张定位把构图误判成 portrait，也能回到真实
  // 阻断位置，而不是继续围绕错误纸框重复 OCR。纸张相对框若可信仍保留
  // 原有最高优先级，避免改变已经稳定的历史批次。
  for (const layoutName of [
    'current-temple-lower-code-box-high', 'current-temple-lower-code-box-low',
    'current-temple-upper-code-line', 'current-temple-upper-code-line-shifted',
  ]) {
    const layout = (layouts || []).find((item) => item.name === layoutName);
    if (layout && !selected.some((item) => item.name === layout.name)) selected.push(layout);
  }
  for (const layout of layouts || []) {
    const match = /^current-(temple|outdoor|portrait)-code-line$/.exec(layout.name);
    if (!match || seenModes.has(match[1])) continue;
    seenModes.add(match[1]);
    selected.push(layout);
  }
  for (const mode of ['portrait', 'temple', 'outdoor']) {
    if (seenModes.has(mode)) continue;
    seenModes.add(mode);
    selected.push(CURRENT_CAMERA_CODE_LAYOUTS[mode][0]);
  }
  const templeMicro = (layouts || []).find((layout) => layout.name === 'current-temple-code-micro')
    || CURRENT_CAMERA_CODE_LAYOUTS.temple.find((layout) => layout.name === 'current-temple-code-micro');
  if (templeMicro && !selected.some((layout) => layout.name === templeMicro.name)) selected.push(templeMicro);
  return selected.slice(0, 8);
}

// PDF 模板既有横版福单，也有竖版牌位。竖版右上角编号的位置会随模板宽度
// 略微变化，不能只依赖一个很窄的固定框；多个候选框仍只读取右上角编号区，
// 最终必须由完整业务前缀或后续页序列证据收敛，避免把正文数字当作编号。
const PDF_CODE_LAYOUTS = {
  portrait: [
    { name: 'portrait-code-line', left: 0.610, top: 0.005, width: 0.350, height: 0.032 },
    { name: 'portrait-code-line-binary', left: 0.610, top: 0.005, width: 0.350, height: 0.032, threshold: 180 },
    { name: 'portrait-right', left: 0.705, top: 0.002, width: 0.255, height: 0.070, sparse: true },
    { name: 'portrait-wide', left: 0.620, top: 0.000, width: 0.350, height: 0.095, sparse: true },
  ],
  landscape: [
    { name: 'landscape-line', left: 0.830, top: 0.004, width: 0.160, height: 0.043 },
    { name: 'landscape-wide', left: 0.790, top: 0.000, width: 0.205, height: 0.070, sparse: true },
  ],
};

function isPaperColor(r, g, b) {
  // 红纸偏洋红（B 明显高于 G），寺庙背景多为橙红（B 低于 G），据此断开背景。
  const red = r > 105 && r > g * 1.45 && b > g * 1.05 && r > b * 1.10;
  // 黄纸是连续的高亮黄块；灯焰虽然更亮但只形成零散小块。
  // 竖版往生牌位在实拍中常因曝光、白平衡而变成低饱和浅黄色，蓝通道会
  // 高于旧版固定上限 115。改用相对色差保留这类纸张；寺院金色灯架即使
  // 命中，也通常形成横跨画面的连通块，后续 sprawlingLights 会继续把它
  // 判为场景，不能仅凭“黄色”直接认定为福单。
  const yellow = r > 125 && g > 92
    && b < Math.min(r, g) * 0.84
    && r > g * 1.015
    && r - g < 110;
  return red || yellow;
}

function largestPaperGeometry(data, info) {
  const width = info.width;
  const height = info.height;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * info.channels;
    mask[index] = isPaperColor(data[offset], data[offset + 1], data[offset + 2]) ? 1 : 0;
  }
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best = null;
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (x > 0) { const next = current - 1; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
      if (x + 1 < width) { const next = current + 1; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
      if (y > 0) { const next = current - width; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
      if (y + 1 < height) { const next = current + width; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
    }
    if (!best || count > best.count) best = { count, minX, maxX, minY, maxY };
  }
  if (!best) return null;
  const boxWidth = best.maxX - best.minX + 1;
  const boxHeight = best.maxY - best.minY + 1;
  const boxArea = boxWidth * boxHeight;
  const geometry = {
    left: best.minX / width,
    top: best.minY / height,
    width: boxWidth / width,
    height: boxHeight / height,
    right: (best.maxX + 1) / width,
    bottom: (best.maxY + 1) / height,
    score: best.count / (width * height),
    fill: best.count / Math.max(boxArea, 1),
    boxArea: boxArea / (width * height),
  };
  geometry.rectangularPaper = geometry.score >= 0.12
    && geometry.boxArea >= 0.13
    && geometry.width >= 0.24
    && geometry.height >= 0.18
    && geometry.fill >= 0.42
    && geometry.left > 0.08
    && geometry.right < 0.94
    && geometry.top > 0.12
    && geometry.bottom < 0.97;
  // 实拍福单经常贴近画面右侧或底边。旧条件要求纸张四周都留出背景，
  // 会把肉眼清晰的福单排除在 OCR 和页面指纹之外。usablePaper 只证明
  // “存在足够大的连续纸色区域”，不单独证明编号；最终仍须完整编号、
  // 唯一页面指纹或双锚点序列等独立证据才能改名。
  geometry.usablePaper = geometry.score >= 0.075
    && geometry.boxArea >= 0.10
    && geometry.width >= 0.20
    && geometry.height >= 0.15
    && geometry.fill >= 0.34
    && geometry.width < 0.985;
  return geometry;
}

const VERIFIED_BATCH_EVIDENCE = {
  '2026-08-12': {
    expectedNumbers: Array.from({ length: 21 }, (_, index) => 263 + index),
    blessing: {
      '微信图片_20260813081822_7384_139.jpg': 268,
      '微信图片_20260813081822_7385_139.jpg': 269,
      '微信图片_20260813081823_7386_139.jpg': 270,
      '微信图片_20260813081824_7387_139.jpg': 271,
      '微信图片_20260813081825_7388_139.jpg': 272,
      '微信图片_20260813081826_7389_139.jpg': 273,
      '微信图片_20260813081827_7390_139.jpg': 274,
      '微信图片_20260813081827_7391_139.jpg': 275,
      '微信图片_20260813081828_7392_139.jpg': 276,
      '微信图片_20260813081829_7393_139.jpg': 277,
      '微信图片_20260813081829_7394_139.jpg': 278,
      '微信图片_20260813081830_7395_139.jpg': 279,
      '微信图片_20260813081831_7396_139.jpg': 281,
      '微信图片_20260813081832_7397_139.jpg': 280,
      '微信图片_20260813081833_7398_139.jpg': 282,
      '微信图片_20260813081834_7399_139.jpg': 283,
      '微信图片_20260813081835_7400_139.jpg': 263,
      '微信图片_20260813081835_7401_139.jpg': 264,
      '微信图片_20260813081836_7402_139.jpg': 265,
      '微信图片_20260813081837_7403_139.jpg': 266,
      '微信图片_20260813081840_7406_139.jpg': 267,
    },
    scenes: {
      '微信图片_20260813081321_7372_139.jpg': '2.1.jpg',
      '微信图片_20260813081322_7373_139.jpg': '2.2.jpg',
      '微信图片_20260813081841_7407_139.jpg': '2.5.jpg',
    },
    duplicates: {
      '微信图片_20260813081838_7404_139.jpg': 266,
      '微信图片_20260813081839_7405_139.jpg': 266,
    },
  },
  '2026-08-13': {
    expectedNumbers: Array.from({ length: 35 }, (_, index) => 284 + index),
    // 该哈希锁定下面 43 张已人工逐张复核的原图，包含 35 张福单、3 张场景图和 5 张重复照片。
    knownFilesHash: 'fe23635e245f646c0b27ac6c9268453738dbbdd6157d9d03bf9d5c78cff870e7',
    duplicateValidation: 'manual-visual-review',
    blessing: {
      '微信图片_20260814072223_7422_139.jpg': 316,
      '微信图片_20260814072711_7424_139.jpg': 317,
      '微信图片_20260814072712_7426_139.jpg': 318,
      '微信图片_20260814072713_7427_139.jpg': 313,
      '微信图片_20260814072714_7428_139.jpg': 311,
      '微信图片_20260814072715_7429_139.jpg': 310,
      '微信图片_20260814072716_7430_139.jpg': 309,
      '微信图片_20260814072717_7431_139.jpg': 312,
      '微信图片_20260814072718_7432_139.jpg': 308,
      '微信图片_20260814072718_7433_139.jpg': 307,
      '微信图片_20260814072719_7434_139.jpg': 306,
      '微信图片_20260814072719_7435_139.jpg': 305,
      '微信图片_20260814072720_7436_139.jpg': 304,
      '微信图片_20260814072721_7437_139.jpg': 303,
      '微信图片_20260814072722_7438_139.jpg': 302,
      '微信图片_20260814072722_7439_139.jpg': 301,
      '微信图片_20260814072723_7440_139.jpg': 300,
      '微信图片_20260814072724_7441_139.jpg': 299,
      '微信图片_20260814072724_7442_139.jpg': 298,
      '微信图片_20260814072725_7443_139.jpg': 297,
      '微信图片_20260814072726_7444_139.jpg': 296,
      '微信图片_20260814072726_7445_139.jpg': 295,
      '微信图片_20260814072727_7446_139.jpg': 294,
      '微信图片_20260814072728_7447_139.jpg': 293,
      '微信图片_20260814072729_7448_139.jpg': 292,
      '微信图片_20260814072729_7449_139.jpg': 291,
      '微信图片_20260814072730_7450_139.jpg': 290,
      '微信图片_20260814072731_7452_139.jpg': 315,
      '微信图片_20260814072732_7453_139.jpg': 314,
      '微信图片_20260814123729_7475_139.jpg': 284,
      '微信图片_20260814123731_7476_139.jpg': 285,
      '微信图片_20260814123733_7479_139.jpg': 286,
      '微信图片_20260814123734_7481_139.jpg': 287,
      '微信图片_20260814123734_7480_139.jpg': 288,
      '微信图片_20260814123736_7483_139.jpg': 289,
    },
    scenes: {
      '微信图片_20260814072809_7454_139.jpg': '2.1.jpg',
      '微信图片_20260814072810_7455_139.jpg': '2.2.jpg',
      '微信图片_20260814123737_7484_139.jpg': '2.5.jpg',
    },
    duplicates: {
      '微信图片_20260814072711_7425_139.jpg': 316,
      '微信图片_20260814072731_7451_139.jpg': 316,
      '微信图片_20260814123731_7477_139.jpg': 285,
      '微信图片_20260814123732_7478_139.jpg': 285,
      '微信图片_20260814123735_7482_139.jpg': 287,
    },
  },
  '2026-08-21': {
    // 2026-08-22 已结合 PDF 页面编号与人工纠正结果复核：前四张是连续
    // 福单 447–450，后三张依次为两张供灯和一张供水场景。仅在当天 PDF
    // 唯一编号集仍完整等于 436–450 且这些原始文件名全部存在时才采用。
    expectedNumbers: Array.from({ length: 15 }, (_, index) => 436 + index),
    duplicateValidation: 'manual-visual-review',
    blessing: {
      '微信图片_20260822072129_985_92.jpg': 447,
      '微信图片_20260822072130_986_92.jpg': 448,
      '微信图片_20260822072130_987_92.jpg': 449,
      '微信图片_20260822072131_988_92.jpg': 450,
    },
    scenes: {
      '微信图片_20260822072136_995_92.jpg': '2.1.jpg',
      '微信图片_20260822072207_996_92.jpg': '2.2.jpg',
      '微信图片_20260822072207_997_92.jpg': '2.5.jpg',
    },
    duplicates: {},
  },
};

function paperCodeLayoutsFromGeometry(geometry) {
  if (!geometry?.usablePaper && !geometry?.rectangularPaper) return [];
  const portraitPaper = geometry.height > geometry.width * 1.25;
  return [
    !portraitPaper ? {
      name: 'paper-relative-landscape-code-upper-right',
      // 木架中纸张的露出高度会变化，纸色连通域也可能把木架阴影并入上边界。
      // 2026-08-26 实拍中编号位于纸张高度约 9%~14%，旧框从 14% 才开始，
      // 实际只裁到编号下沿的一条纯色红纸。扩大为仍然局限在右上角的编号带，
      // 既完整覆盖透视倾斜后的编号，也不会进入下方姓名和祈愿正文区域。
      left: geometry.left + geometry.width * 0.69,
      top: Math.max(0, geometry.top + geometry.height * 0.10),
      width: geometry.width * 0.23,
      height: geometry.height * 0.065,
      sparse: false,
    } : null,
    !portraitPaper ? {
      name: 'paper-relative-landscape-code-lower-right',
      // 第二条覆盖纸张放得较高时稍低、稍靠左的编号行。两个框都严格限制在
      // 纸张右上区域，不会读取姓名、祈愿或其他订单正文。
      left: geometry.left + geometry.width * 0.68,
      top: geometry.top + geometry.height * 0.2755,
      width: geometry.width * 0.1801,
      height: geometry.height * 0.033,
      sparse: false,
    } : null,
    {
      name: 'paper-relative-code-only',
      // 只覆盖纸张右上角第一行完整编码。实拍牌位的编号字号很小，旧的宽框
      // 同时带入日期和佛像线条，SPARSE_TEXT 容易漏掉肉眼清晰的 333/334。
      left: geometry.left + geometry.width * (portraitPaper ? 0.66 : 0.68),
      top: Math.max(0, geometry.top + geometry.height * (portraitPaper ? 0.015 : -0.005)),
      width: geometry.width * (portraitPaper ? 0.33 : 0.31),
      height: geometry.height * (portraitPaper ? 0.075 : 0.085),
      sparse: false,
    },
    {
      name: 'paper-relative-line',
      // 保留右上角足够的纵向余量：实拍纸张存在透视倾斜，编号并不总与检测框上边缘平行。
      left: geometry.left + geometry.width * 0.48,
      top: Math.max(0, geometry.top + geometry.height * (portraitPaper ? 0.025 : -0.005)),
      width: geometry.width * 0.43,
      height: geometry.height * (portraitPaper ? 0.13 : 0.11),
      sparse: true,
    },
    {
      name: 'paper-relative-wide',
      left: geometry.left + geometry.width * 0.49,
      top: Math.max(0, geometry.top - geometry.height * 0.025),
      width: geometry.width * 0.50,
      height: geometry.height * 0.25,
      sparse: true,
    },
  ].filter(Boolean);
}

async function detectPaperEvidence(file) {
  const { data, info } = await sharpFile(file).rotate().resize({ width: 320, height: 240, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const geometry = largestPaperGeometry(data, info);
  return { geometry, layouts: paperCodeLayoutsFromGeometry(geometry) };
}

export async function inspectPaperGeometry(file) {
  return (await detectPaperEvidence(file)).geometry;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

// NAS 同步目录中的占位/重解析文件不能交给 libvips 长时间持有文件句柄。
// 先完整读入内存并关闭 Windows 文件句柄，再让 sharp 处理 Buffer。
function sharpFile(file) {
  return sharp(fs.readFileSync(file));
}

function autoOrientedMetadata(metadata) {
  const orientation = Number(metadata?.orientation || 1);
  if ([5, 6, 7, 8].includes(orientation)) {
    return { ...metadata, width: metadata.height, height: metadata.width };
  }
  return metadata;
}

function destinationExistsError(destination) {
  const error = new Error(`目标文件已经存在，拒绝覆盖：${destination}`);
  error.code = 'EEXIST';
  return error;
}

const transientFileLockCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);

function waitSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function unlinkWithRetrySync(file, { attempts = 120, delayMs = 250 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.unlinkSync(file);
      return attempt;
    } catch (error) {
      if (!transientFileLockCodes.has(error?.code) || attempt === attempts) throw error;
      waitSync(delayMs);
    }
  }
  throw new Error(`Cannot remove file after ${attempts} attempts: ${file}`);
}

export function moveFileVerified(source, destination) {
  if (fs.existsSync(destination)) throw destinationExistsError(destination);
  try {
    fs.renameSync(source, destination);
    return { method: 'rename', sha256: sha256(destination) };
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
  }

  const sourceHash = sha256(source);
  let copied = false;
  try {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    copied = true;
    const handle = fs.openSync(destination, 'r+');
    try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    if (sha256(destination) !== sourceHash) {
      throw new Error(`跨盘复制校验失败，源文件保持不变：${path.basename(source)}`);
    }
    const unlinkAttempts = unlinkWithRetrySync(source);
    return { method: 'verified-copy-unlink', sha256: sourceHash, unlinkAttempts };
  } catch (error) {
    // 只有源文件仍存在时才删除未完成的目的副本；源文件已删除意味着跨盘移动
    // 已完成，不能误删唯一留下的隔离副本。
    if (copied && fs.existsSync(source)) {
      try { unlinkWithRetrySync(destination, { attempts: 20, delayMs: 250 }); } catch {}
    }
    throw error;
  }
}

function editDistance(left, right) {
  const a = String(left);
  const b = String(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function normalizeOcr(text) {
  return String(text || '')
    .replace(/[—–_]/g, '-')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateNumberVariants(text) {
  const variants = new Map([[String(text), 0]]);
  if (String(text).length === 4) {
    for (let index = 0; index < String(text).length; index += 1) {
      const value = String(text).slice(0, index) + String(text).slice(index + 1);
      // OCR 最常见的是把三位编号的首位重复一次（例如 318 -> 3318）。
      // 删除首个重复位优先；删除末位会改变真实尾号，必须给更高惩罚。
      const penalty = index === 0 && text[0] === text[1] ? 1 : 2 + index * 0.1;
      variants.set(value, Math.min(variants.get(value) ?? Infinity, penalty));
    }
  }
  return [...variants].map(([value, penalty]) => ({ value, penalty }));
}

function parseOcrCandidates(text, expectedPrefix, expectedNumbers = null) {
  const normalized = normalizeOcr(text);
  const found = [];
  const fullPattern = /(\d{2,3})-?1-?(\d{1,4})(?!\d)/g;
  // 先在保留空格边界的文本上匹配，防止把编号尾号与下一行日期开头粘连
  // （例如 "268-1-333 1--2027" 被压成 "268-1-3331--2027"）。
  // 只有分隔符内部存在空格时才做轻量归一；完全压紧文本作为最后回退并加罚分。
  const forms = [
    { value: normalized, penalty: 0 },
    { value: normalized.replace(/\s*-\s*/g, '-'), penalty: 0.1 },
    { value: normalized.replace(/\s+/g, ''), penalty: 1 },
  ];
  const seenForms = new Set();
  for (const form of forms) {
    if (seenForms.has(form.value)) continue;
    seenForms.add(form.value);
    for (const match of form.value.matchAll(fullPattern)) {
      for (const variant of candidateNumberVariants(match[2])) {
        const number = Number(variant.value);
        if (!Number.isInteger(number) || number <= 0 || (expectedNumbers && !expectedNumbers.has(number))) continue;
        found.push({
          number,
          prefixDistance: editDistance(match[1], expectedPrefix) + variant.penalty + form.penalty,
          normalized,
        });
      }
    }
  }
  if (!found.length && expectedNumbers) {
    const compact = normalized.replace(/\s+/g, '');
    const tailPattern = /(?:^|\D)1-(\d{1,4})(?!\d)/g;
    for (const match of compact.matchAll(tailPattern)) {
      const number = Number(match[1]);
      if (expectedNumbers.has(number)) found.push({ number, prefixDistance: 99, normalized });
    }
  }
  return found;
}

function parsePdfTailCandidate(text) {
  const compact = normalizeOcr(text).replace(/\s+/g, '');
  const explicit = /(?:^|\D)1-(\d{1,4})(?!\d)/.exec(compact);
  if (explicit) return Number(explicit[1]);
  const trailing = /-(\d{1,4})$/.exec(compact);
  return trailing ? Number(trailing[1]) : null;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || null;
}

function rawNumberAlternatives(value) {
  if (!Number.isInteger(value) || value <= 0) return [];
  const text = String(value);
  const alternatives = new Map([[value, 0]]);
  if (text.length === 4) {
    for (let index = 0; index < text.length; index += 1) {
      const candidate = Number(text.slice(0, index) + text.slice(index + 1));
      if (candidate > 0) alternatives.set(candidate, Math.min(alternatives.get(candidate) ?? Infinity, 0.7));
    }
  }
  return [...alternatives.entries()].map(([number, penalty]) => ({ number, penalty }));
}

function rawNumberCost(rawNumber, expectedNumber) {
  if (!Number.isInteger(rawNumber)) return 1.75;
  return Math.min(...rawNumberAlternatives(rawNumber).map((item) => item.penalty + editDistance(item.number, expectedNumber)));
}

function bestSequentialStart(group) {
  const starts = new Set();
  for (const page of group) {
    for (const alternative of rawNumberAlternatives(page.rawNumber)) {
      const start = alternative.number - (page.pageNumber - 1);
      if (start > 0 && start <= 9999) starts.add(start);
    }
  }
  const scored = [...starts].map((start) => {
    const costs = group.map((page) => rawNumberCost(page.rawNumber, start + page.pageNumber - 1));
    return {
      start,
      total: costs.reduce((sum, value) => sum + value, 0),
      exact: costs.filter((cost) => cost === 0).length,
      near: costs.filter((cost) => cost <= 1).length,
    };
  }).sort((a, b) => a.total - b.total || b.exact - a.exact || b.near - a.near || a.start - b.start);
  const best = scored[0] || null;
  const second = scored[1] || null;
  if (!best) return null;
  const margin = second ? second.total - best.total : Infinity;
  const accepted = group.length === 1
    ? best.total <= 0.7 && margin >= 0.5 && group[0]?.rawNumber <= 999
    : best.near >= Math.ceil(group.length * 0.7) && best.total / group.length <= 1.1 && margin >= 0.5;
  return accepted ? { ...best, margin } : null;
}

export function repairSinglePdfOutlier(pages) {
  if (pages.length < 5 || pages.some((page) => !Number.isInteger(page.number))) return false;
  const repairs = [];
  for (let outlierIndex = 0; outlierIndex < pages.length; outlierIndex += 1) {
    const others = pages.filter((_, index) => index !== outlierIndex).map((page) => page.number);
    if (new Set(others).size !== others.length) continue;
    const min = Math.min(...others);
    const starts = [];
    for (let start = min - pages.length + 1; start <= min; start += 1) {
      const end = start + pages.length - 1;
      if (!others.every((number) => number >= start && number <= end)) continue;
      const used = new Set(others);
      const missing = Array.from({ length: pages.length }, (_, index) => start + index).filter((number) => !used.has(number));
      if (missing.length !== 1) continue;
      const current = pages[outlierIndex].number;
      const replacement = missing[0];
      // 仅修复“其余页面形成唯一稠密区间 + 单个 OCR 字符混淆”的离群点。
      // 跨导出片段的真实编号缺口不会满足这个条件，不能被凭空补造。
      if (current >= start && current <= end) continue;
      if (Math.abs(current - replacement) < pages.length) continue;
      if (rawNumberCost(pages[outlierIndex].rawNumber, replacement) > 1.05) continue;
      starts.push({ start, replacement });
    }
    if (starts.length === 1) repairs.push({ outlierIndex, replacement: starts[0].replacement });
  }
  if (repairs.length !== 1) return false;
  const repair = repairs[0];
  const page = pages[repair.outlierIndex];
  page.number = repair.replacement;
  page.codeEvidence = 'pdf-single-ocr-outlier-in-dense-range';
  page.sequenceScore = { cost: rawNumberCost(page.rawNumber, repair.replacement), repairedFrom: page.rawNumber };
  return true;
}

function photoPdfBusinessRank(file) {
  const name = path.basename(file || '');
  if (/供水/.test(name)) return 0;
  const red = /红纸(\d+)/.exec(name);
  if (red) return 100 + Number(red[1]);
  const yellow = /黄纸(\d+)/.exec(name);
  if (yellow) return 200 + Number(yellow[1]);
  return 300;
}

// 跨 PDF 的最后一页/第一页面也可能发生单字符 OCR 混淆。典型情况是完整
// 区间 481–495 被读成 481–494 加一个重复 485。只在“恰好一个重复号、
// 相邻页面唯一推出缺号、替换后恰好形成完整连续区间”时修复，避免增量补单
// 或真实编号缺口被强行改写。
export function repairSingleAdjacentDuplicatePdfCode(pages) {
  if (pages.length < 3 || pages.some((page) => !Number.isInteger(page.number))) return false;
  const counts = new Map();
  for (const page of pages) counts.set(page.number, (counts.get(page.number) || 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count === 2).map(([number]) => number);
  if (duplicates.length !== 1 || [...counts.values()].some((count) => count > 2)) return false;

  const ordered = [...pages].sort((a, b) => photoPdfBusinessRank(a.pdf) - photoPdfBusinessRank(b.pdf)
    || path.basename(a.pdf).localeCompare(path.basename(b.pdf), 'zh-CN', { numeric: true })
    || a.pageNumber - b.pageNumber);
  const duplicate = duplicates[0];
  const proposals = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const page = ordered[index];
    if (page.number !== duplicate) continue;
    for (const candidate of [ordered[index - 1]?.number + 1, ordered[index + 1]?.number - 1]) {
      if (!Number.isInteger(candidate) || candidate <= 0 || counts.has(candidate)) continue;
      const values = ordered.map((item) => item === page ? candidate : item.number);
      if (new Set(values).size !== pages.length) continue;
      if (Math.max(...values) - Math.min(...values) + 1 !== pages.length) continue;
      if (rawNumberCost(page.rawNumber, candidate) > 1.05) continue;
      proposals.push({ page, candidate });
    }
  }
  const unique = proposals.filter((proposal, index) => proposals.findIndex((other) => other.page === proposal.page && other.candidate === proposal.candidate) === index);
  if (unique.length !== 1) return false;
  const { page, candidate } = unique[0];
  page.number = candidate;
  page.codeEvidence = 'pdf-adjacent-page-duplicate-repair';
  page.sequenceScore = { cost: rawNumberCost(page.rawNumber, candidate), repairedFrom: duplicate };
  return true;
}

export function inferSequentialPdfCodes(pages) {
  const byPdf = new Map();
  for (const page of pages) {
    if (!byPdf.has(page.pdf)) byPdf.set(page.pdf, []);
    byPdf.get(page.pdf).push(page);
  }
  for (const group of byPdf.values()) {
    group.sort((a, b) => a.pageNumber - b.pageNumber);
    const best = bestSequentialStart(group);
    if (best) {
      for (const page of group) {
        page.number = best.start + (page.pageNumber - 1);
        page.codeEvidence = page.rawNumber === page.number ? 'pdf-ocr' : 'pdf-page-sequence';
        page.sequenceScore = { cost: rawNumberCost(page.rawNumber, page.number), groupTotal: best.total, margin: best.margin };
      }
    }
  }
  repairSinglePdfOutlier(pages);
  repairSingleAdjacentDuplicatePdfCode(pages);
  inferTrailingUnreadPdfCodes(pages);
  // 不再按“文件排序后的页面位置”跨 PDF 强填编号。增量补单会在黄纸、牌位后
  // 继续产生红纸 N，文件名顺序不等于打印编号顺序，旧逻辑会把 318 错写成 314。
  // 先利用总页数与已识别区间修复单页多读一位，再仅在唯一未识别 PDF 组中补齐缺口。
  let known = pages.map((page) => page.number).filter(Number.isInteger);
  if (known.length) {
    const knownMin = Math.min(...known);
    const knownMax = Math.max(...known);
    for (const page of pages.filter((item) => !Number.isInteger(item.number) && Number.isInteger(item.rawNumber))) {
      const candidates = rawNumberAlternatives(page.rawNumber)
        .filter((item) => Math.max(knownMax, item.number) - Math.min(knownMin, item.number) + 1 === pages.length)
        .sort((a, b) => a.penalty - b.penalty || a.number - b.number);
      if (candidates.length === 1 || (candidates[0] && candidates[1] && candidates[0].penalty < candidates[1].penalty)) {
        page.number = candidates[0].number;
        page.codeEvidence = 'pdf-total-span-and-ocr-variant';
        page.sequenceScore = { cost: candidates[0].penalty };
      }
    }
  }

  known = pages.map((page) => page.number).filter(Number.isInteger);
  const unresolvedByPdf = new Map();
  for (const page of pages.filter((item) => !Number.isInteger(item.number))) {
    if (!unresolvedByPdf.has(page.pdf)) unresolvedByPdf.set(page.pdf, []);
    unresolvedByPdf.get(page.pdf).push(page);
  }
  if (known.length && unresolvedByPdf.size) {
    const min = Math.min(...known);
    const max = Math.max(...known);
    if (max - min + 1 === pages.length) {
      const used = new Set(known);
      const available = new Set(Array.from({ length: pages.length }, (_, index) => min + index).filter((number) => !used.has(number)));
      const remaining = new Map([...unresolvedByPdf].map(([pdf, group]) => [pdf, [...group].sort((a, b) => a.pageNumber - b.pageNumber)]));
      let progress = true;
      while (progress && remaining.size > 1) {
        progress = false;
        for (const [pdf, group] of remaining) {
          const candidates = [];
          for (const start of [...available].sort((a, b) => a - b)) {
            const numbers = Array.from({ length: group.length }, (_, index) => start + index);
            if (!numbers.every((number) => available.has(number))) continue;
            const costs = group.map((page, index) => rawNumberCost(page.rawNumber, numbers[index]));
            candidates.push({ numbers, total: costs.reduce((sum, value) => sum + value, 0), near: costs.filter((value) => value <= 1).length });
          }
          candidates.sort((a, b) => a.total - b.total || b.near - a.near || a.numbers[0] - b.numbers[0]);
          const best = candidates[0];
          const second = candidates[1];
          const margin = second ? second.total - best.total : Infinity;
          if (!best || best.near < Math.ceil(group.length * 0.5) || best.total / group.length > 1.1 || margin < 0.5) continue;
          for (let index = 0; index < group.length; index += 1) {
            group[index].number = best.numbers[index];
            group[index].codeEvidence = 'constrained-cross-pdf-gap';
            group[index].sequenceScore = { cost: rawNumberCost(group[index].rawNumber, best.numbers[index]), margin };
            available.delete(best.numbers[index]);
          }
          remaining.delete(pdf);
          progress = true;
          break;
        }
      }
      if (remaining.size === 1) {
        const group = [...remaining.values()][0];
        const missing = [...available].sort((a, b) => a - b);
        const consecutive = missing.every((number, index) => index === 0 || number === missing[index - 1] + 1);
        if (group.length === missing.length && consecutive) {
          for (let index = 0; index < group.length; index += 1) {
            group[index].number = missing[index];
            group[index].codeEvidence = 'unique-remaining-cross-pdf-gap';
          }
        }
      }
    }
  }
  return pages;
}

// 牌位批次的右上角除了业务编号还会出现 2026/2027 等起止年份。若一个新批次
// 的所有页面都只读到了年份，旧逻辑会把整组排除，继而照片中清晰的后续编号
// 也因“不在 PDF 集合内”全部丢弃。这里只在已识别编号本身无缺口、未识别页
// 全部来自红纸/黄纸的后续批次，且原始 OCR 没有任何三位业务编号时，才把它们
// 作为唯一连续尾段补齐。若普通批次中间真有漏页，已识别集合会出现缺口，本
// 规则不会触发。
export function inferTrailingUnreadPdfCodes(pages) {
  const known = pages.filter((page) => Number.isInteger(page.number));
  const unresolved = pages.filter((page) => !Number.isInteger(page.number));
  if (known.length < 5 || !unresolved.length || unresolved.length > 50) return false;
  const knownNumbers = known.map((page) => page.number).sort((a, b) => a - b);
  if (new Set(knownNumbers).size !== knownNumbers.length) return false;
  if (!knownNumbers.every((number, index) => index === 0 || number === knownNumbers[index - 1] + 1)) return false;
  const laterPaperBatch = unresolved.every((page) => {
    const match = /(?:红纸|黄纸)(\d+)/.exec(path.basename(page.pdf || ''));
    const raw = page.rawNumber;
    const rawIsOnlyDateNoise = !Number.isInteger(raw) || (raw >= 1900 && raw <= 2100);
    return match && Number(match[1]) >= 2 && rawIsOnlyDateNoise;
  });
  if (!laterPaperBatch) return false;
  const ordered = [...unresolved].sort((a, b) => photoPdfBusinessRank(a.pdf) - photoPdfBusinessRank(b.pdf)
    || path.basename(a.pdf || '').localeCompare(path.basename(b.pdf || ''), 'zh-CN', { numeric: true })
    || a.pageNumber - b.pageNumber);
  const start = knownNumbers.at(-1) + 1;
  for (let index = 0; index < ordered.length; index += 1) {
    ordered[index].number = start + index;
    ordered[index].codeEvidence = 'contiguous-known-range-and-unread-later-batch-tail';
    ordered[index].sequenceScore = { inferredTailStart: start, knownCount: knownNumbers.length };
  }
  return true;
}

function cropFromRatios(metadata, layout) {
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const left = Math.max(0, Math.floor(width * layout.left));
  const top = Math.max(0, Math.floor(height * layout.top));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.floor(width * layout.width))),
    height: Math.max(1, Math.min(height - top, Math.floor(height * layout.height))),
  };
}

function isUsableOcrExtract(extract) {
  return Number(extract?.width || 0) >= 12 && Number(extract?.height || 0) >= 8;
}

export function isReliableOcrConsensus(best, second = null, minimumConfidence = 20) {
  if (!best || best.maxConfidence < minimumConfidence || best.votes < 2) return false;
  const uniquelyBest = !second
    || best.votes > second.votes
    || (best.votes === second.votes && best.prefixDistance < second.prefixDistance);
  if (!uniquelyBest) return false;
  if (best.prefixDistance <= 0.1) return true;
  return best.prefixDistance <= 1 && best.votes >= 3;
}

export async function createOcrWorker(appRoot) {
  const langPath = path.join(appRoot, 'ocr-data');
  if (!fs.existsSync(path.join(langPath, 'eng.traineddata.gz'))) throw new Error('缺少本地 OCR 模型 eng.traineddata.gz。');
  const cachePath = path.join(path.dirname(appRoot), '祈福运行数据', 'cache', 'ocr');
  fs.mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker('eng', 1, { langPath, cachePath, gzip: true });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: '0123456789-',
  });
  return worker;
}

export async function recognizePreparedImage(worker, file, expectedPrefix, expectedNumbers, cropDir, appRoot = null) {
  // sharp().rotate().metadata() 仍返回原始像素宽高，不会把 EXIF 方向 6/8 的宽高
  // 自动互换；直接使用会把横向微信照片的比例框裁到完全错误的位置。
  const metadata = autoOrientedMetadata(await sharpFile(file).metadata());
  const observations = [];
  const windowsFallbackFiles = [];
  const paperEvidence = await detectPaperEvidence(file);
  const visualMetrics = await imageVisualMetrics(file);
  const sceneMetrics = await sceneVisualScore(file);
  if (isLikelyScene({ paperGeometry: paperEvidence.geometry, visualMetrics, sceneMetrics })) {
    return {
      file,
      reliable: false,
      number: null,
      paperGeometry: paperEvidence.geometry,
      visualMetrics,
      sceneMetrics,
      evidence: { method: 'scene-visual-fast-path' },
      candidates: [],
    };
  }
  // 检出纸张后只围绕纸张右上角识别，避免佛像、灯焰和边框进入 OCR。
  // 纸张定位失败时才回退旧版固定构图，兼容历史照片。
  const layouts = prioritizedPhotoLayouts(paperEvidence.geometry, paperEvidence.layouts);

  // 补拍的 597/598 使用另一种较低纸面构图。其短编号在原彩小框中由
  // Windows OCR 可稳定读取，但若先让 Tesseract遍历所有阈值，会在花边细线
  // 上反复分割并耗时约 30 秒。只有纸面明显下移或高度显著增大时才先跑这
  // 两个小框；且只接受同时包含近似业务前缀、并唯一落入当天 PDF 编号集的
  // 结果。其他构图继续走原有多裁框共识，不扩大误判面。
  const lowerCodeBoxLikely = Number(paperEvidence.geometry?.top || 0) >= 0.48
    || Number(paperEvidence.geometry?.height || 0) >= 0.56;
  if (appRoot && lowerCodeBoxLikely) {
    const strictBoxFiles = [];
    for (const layout of CURRENT_CAMERA_CODE_LAYOUTS.temple.filter((item) => /-code-box-/.test(item.name))) {
      const extract = cropFromRatios(metadata, layout);
      if (!isUsableOcrExtract(extract)) continue;
      const diagnostic = path.join(cropDir, `${crypto.randomUUID()}-${layout.name}-windows-color.png`);
      await sharpFile(file).rotate().extract(extract).png().toFile(diagnostic);
      strictBoxFiles.push(diagnostic);
    }
    const windows = readWindowsOcrTails(appRoot, strictBoxFiles, cropDir);
    const matches = [...new Set([...windows.values()]
      .flatMap((item) => parseLooseWindowsCodeCandidates(item.text, expectedPrefix, expectedNumbers))
      .filter((number) => expectedNumbers.has(number)))];
    if (matches.length === 1) {
      return {
        file,
        reliable: true,
        number: matches[0],
        paperGeometry: paperEvidence.geometry,
        visualMetrics,
        sceneMetrics,
        evidence: { method: 'windows-ocr-strict-lower-code-box', votes: windows.size, prefixDistance: 0, maxConfidence: 100, layouts: ['current-temple-lower-code-box'] },
        candidates: [{ number: matches[0], votes: windows.size, prefixDistance: 0, maxConfidence: 100, layouts: ['current-temple-lower-code-box'] }],
      };
    }
  }

  // 户外横版福单的编号行很清晰，但通用 SPARSE_TEXT 曾稳定地把末位 6
  // 误读成 8。先对紧贴编号行的专用裁框运行两次 SINGLE_LINE 二值化；
  // 只有两个独立阈值都读出相同的完整业务前缀和当天编号，才提前采信。
  // 这样既修复清晰照片误识别，也不会靠“缺哪个号码就填哪个”进行猜测。
  const landscapeCodeLayouts = targetedCurrentCodeLayouts(layouts);
  for (const landscapeCodeLayout of landscapeCodeLayouts) {
    // 低位原彩小框已由上面的 Windows 严格前缀路径处理；它不适合花边密集
    // 图上的 Tesseract 阈值穷举。未唯一命中时继续其他布局，绝不凭缺号采用。
    if (/-code-box-/.test(landscapeCodeLayout.name)) continue;
    const extract = cropFromRatios(metadata, landscapeCodeLayout);
    // 纸色连通域偶尔会贴住画面右边缘，使动态“纸内右上角”落到图外。
    // 无有效像素的动态框直接跳过，固定相机框仍会继续复核。
    if (!isUsableOcrExtract(extract)) continue;
    const focusedObservations = [];
    // 紧裁后的内容只有一个短业务编码。Tesseract 的 SINGLE_LINE 会在字符
    // 间距略大时把它当成多个空行并直接返回空；SINGLE_WORD 对数字、连字符
    // 白名单更稳定，最终仍需完整前缀和当天 PDF 范围双重约束。
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    // 当前相机构图的短编号在原彩色图上边缘最自然。先做一次不阈值化的
    // 紧裁识别，避免红纸归一化把细连字符和 5/6/7 的笔画抹掉。
    if (/^current-(?:temple|portrait)-(?:.*-)?code-/.test(landscapeCodeLayout.name)) {
      const colorDiagnostic = path.join(cropDir, `${crypto.randomUUID()}-${landscapeCodeLayout.name}-focused-color.png`);
      await sharpFile(file)
        .rotate()
        .extract(extract)
        .resize({ height: 420, withoutEnlargement: false })
        .extend({ top: 50, bottom: 50, left: 50, right: 50, background: 'white' })
        .png()
        .toFile(colorDiagnostic);
      const colorResult = await worker.recognize(colorDiagnostic);
      const colorParsed = parseOcrCandidates(colorResult.data.text, expectedPrefix, expectedNumbers)
        .filter((item) => item.prefixDistance <= 1.1);
      for (const item of colorParsed) focusedObservations.push({
        ...item,
        confidence: Number(colorResult.data.confidence || 0),
        layout: landscapeCodeLayout.name,
        variant: 'focused-color',
      });
      if (appRoot) {
        const windowsColorDiagnostic = path.join(cropDir, `${crypto.randomUUID()}-${landscapeCodeLayout.name}-windows-color.png`);
        await sharpFile(file).rotate().extract(extract).png().toFile(windowsColorDiagnostic);
        windowsFallbackFiles.push(windowsColorDiagnostic);
      }
    }
    if (appRoot) {
      const windowsDiagnostic = path.join(cropDir, `${crypto.randomUUID()}-${landscapeCodeLayout.name}-windows-red.png`);
      await sharpFile(file)
        .rotate()
        .extract(extract)
        .resize({ width: 1600, withoutEnlargement: false })
        .extractChannel(0)
        .normalize()
        .sharpen({ sigma: 1 })
        .extend({ top: 48, bottom: 48, left: 48, right: 48, background: 'white' })
        .png()
        .toFile(windowsDiagnostic);
      windowsFallbackFiles.push(windowsDiagnostic);
    }
    // 8 月 28 日微型编号带在红通道自然对比下清晰可读；旧阈值 65–85 会
    // 把细笔画和 0/1/2 的内孔一起压没。先保留一份未二值化红通道作为
    // 独立证据，再由下方多阈值复核，仍需至少两票同号才能自动落号。
    const currentMicroBand = /^current-temple-(?:upper|lower)-code-(?:line|box)/.test(landscapeCodeLayout.name);
    if (currentMicroBand) {
      for (const height of [300, 420]) {
        const redNaturalDiagnostic = path.join(cropDir, `${crypto.randomUUID()}-${landscapeCodeLayout.name}-focused-red-natural-${height}.png`);
        await sharpFile(file)
          .rotate()
          .extract(extract)
          .resize({ height, withoutEnlargement: false })
          .extractChannel(0)
          .normalize()
          .sharpen({ sigma: 0.7 })
          .png()
          .toFile(redNaturalDiagnostic);
        const redNaturalResult = await worker.recognize(redNaturalDiagnostic);
        const redNaturalParsed = parseOcrCandidates(redNaturalResult.data.text, expectedPrefix, expectedNumbers)
          .filter((item) => item.prefixDistance <= 0.1);
        for (const item of redNaturalParsed) focusedObservations.push({
          ...item,
          confidence: Number(redNaturalResult.data.confidence || 0),
          layout: landscapeCodeLayout.name,
          variant: `focused-red-natural-${height}`,
        });
      }
    }
    // 红纸在普通灰度中本身偏暗，会与黑色编号一起被阈值压成整块黑色。
    // 红通道能把红纸背景抬亮而保留黑字；黄纸/低饱和照片则继续由灰度通道
    // 负责。两路仍各跑两个阈值，最终必须形成同号共识，不能单次猜号。
    for (const channel of ['red', 'gray', 'clahe']) {
      // 木架和高光会拉高整幅裁图的动态范围，红纸主体归一化后通常落在
      // 50~100。另有局部阴影覆盖编号的照片，使用 CLAHE 局部均衡后再以
      // 中阈值识别，避免把整片纸纹放大成噪声。
      const thresholds = channel === 'red' && currentMicroBand ? [90, 110, 130, 150]
        : channel === 'clahe' ? [105, 125, 145]
        : channel === 'red' && landscapeCodeLayout.name === 'current-temple-code-line' ? [85, 105, 125]
          : [65, 75, 85];
      for (const threshold of thresholds) {
        const diagnostic = path.join(cropDir, `${crypto.randomUUID()}-${landscapeCodeLayout.name}-focused-${channel[0]}${threshold}.png`);
        let pipeline = sharpFile(file)
          .rotate()
          .extract(extract)
          // 编号在 4080px 微信原图中仍只有约 18px 高。1200px 紧裁会把
          // 连字符和末位数字压成不足 3px 的笔画；1600px 是这批 529
          // 实图能够稳定读出完整编码、同时仍远小于全图 OCR 的最小尺度。
          .resize({ width: 1600, withoutEnlargement: false });
        pipeline = channel === 'red' ? pipeline.extractChannel(0) : pipeline.greyscale();
        if (channel === 'clahe') pipeline = pipeline.clahe({ width: 3, height: 3, maxSlope: 2 }).median(3);
        await pipeline
          .normalize()
          .threshold(threshold)
          .png()
          .toFile(diagnostic);
        // 将肉眼最清晰的红通道 75 阈值紧裁图同时交给 Windows OCR。
        // Tesseract 在部分打印字体上会把清晰的短编码分割为空；Windows OCR
        // 只允许返回当天 PDF 编号集合中的唯一值，因此不会扩大误匹配范围。
        if (channel === 'red' && threshold === 75 && appRoot) windowsFallbackFiles.push(diagnostic);
        const result = await worker.recognize(diagnostic);
        const parsed = parseOcrCandidates(result.data.text, expectedPrefix, expectedNumbers)
          .filter((item) => item.prefixDistance <= 0.1);
        for (const item of parsed) focusedObservations.push({
          ...item,
          confidence: Number(result.data.confidence || 0),
          layout: landscapeCodeLayout.name,
          variant: `focused-${channel}-${threshold}`,
        });
      }
    }
    const focusedGroups = groupObservations(focusedObservations);
    const focusedBest = focusedGroups[0] || null;
    const focusedSecond = focusedGroups[1] || null;
    if (isReliableOcrConsensus(focusedBest, focusedSecond, 35)) {
      return {
        file,
        reliable: true,
        number: focusedBest.number,
        paperGeometry: paperEvidence.geometry,
        visualMetrics,
        sceneMetrics,
        evidence: {
          method: 'targeted-landscape-code-threshold-consensus',
          votes: focusedBest.votes,
          prefixDistance: focusedBest.prefixDistance,
          maxConfidence: focusedBest.maxConfidence,
          layouts: focusedBest.layouts,
        },
        candidates: focusedGroups.slice(0, 5),
      };
    }
  }
  // 第一遍也必须限量。历史版本在没有命中时会把所有动态框和旧固定框全部
  // 跑完，然后二次兜底，清晰批次也会膨胀成数百次 OCR。优先布局已覆盖
  // 当前三种稳定构图；再保留两个动态框兼容旧照片即可。
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  const firstPassLayouts = layouts.slice(0, 4);
  for (const layout of firstPassLayouts) {
    const extract = cropFromRatios(metadata, layout);
    if (!isUsableOcrExtract(extract)) continue;
    const diagnostic = path.join(cropDir, `${crypto.randomUUID()}-${layout.name}.png`);
    await sharpFile(file)
      .rotate()
      .extract(extract)
      .resize({ width: 1200, withoutEnlargement: false })
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1 })
      .png()
      .toFile(diagnostic);
    // 保存两种最可能构图的窄框和宽框供 Windows OCR 兜底。旧版只保存前
    // 两个文件；一旦 geometry 把横版误排成竖版，真正的 temple 裁框虽已
    // 生成却永远不会进入 Windows OCR。
    if (/^current-/.test(layout.name) && windowsFallbackFiles.length < 4) windowsFallbackFiles.push(diagnostic);
    if (layout.sparse) await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const result = await worker.recognize(diagnostic);
    if (layout.sparse) await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const parsed = parseOcrCandidates(result.data.text, expectedPrefix, expectedNumbers);
    const confidence = Number(result.data.confidence || 0);
    for (const item of parsed) observations.push({ ...item, confidence, layout: layout.name, variant: 'gray' });
    // 2026-08-27 实图 268-1-576 在宽框中肉眼清晰，但 SPARSE_TEXT 只给
    // 9 分；同一严格右上角裁框用 AUTO 能稳定读成 2681-576（63 分）。
    // 仅当 SPARSE_TEXT 已读出完整业务前缀和当天 PDF 编号、但置信度不足时，
    // 才追加一种分割模式作为独立证据。它不扩大裁图范围，也不会根据缺号猜测。
    if (layout.sparse
      && confidence < 20
      && parsed.some((item) => item.prefixDistance <= 0.1)) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      const autoResult = await worker.recognize(diagnostic);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
      const autoParsed = parseOcrCandidates(autoResult.data.text, expectedPrefix, expectedNumbers);
      const autoConfidence = Number(autoResult.data.confidence || 0);
      for (const item of autoParsed) observations.push({ ...item, confidence: autoConfidence, layout: layout.name, variant: 'gray-auto' });
    }
    // 完整业务前缀、当天编号范围和足够 OCR 置信度同时成立时，单个窄框已是
    // 可用强证据；无需继续跑后面的宽框与阈值组合。
    if (parsed.some((item) => item.prefixDistance <= 0.1) && confidence >= 20) break;
  }

  const firstPassGroups = groupObservations(observations);
  const firstBest = firstPassGroups[0] || null;
  // 单一裁框即使看到了完整前缀，也可能把清晰的 6 误读成 8。低于 55 的结果
  // 必须再跑多阈值/多色道，不能因“格式完整”提前结束全局取证。
  const weakSingleLayoutExact = Boolean(firstBest
    && firstBest.prefixDistance <= 0.1
    && firstBest.maxConfidence < 55
    && firstBest.layouts.length < 2);
  const needsSecondPass = !firstBest
    || firstBest.votes < 2
    || firstBest.prefixDistance > 1
    || firstPassGroups[1]?.votes === firstBest.votes
    || weakSingleLayoutExact;
  if (needsSecondPass) {
    // 二次兜底严格限量：旧版在单图上最多执行 5 布局 × 3 色道 × 4 阈值，
    // 18 张照片会被放大成十几分钟。当前只复核优先级最高的 3 个编号框，
    // 每框使用灰度/红色道和两个阈值；清晰图通常会在前两次直接返回。
    const secondPassLayouts = layouts.slice(0, 2);
    const contrastChannels = [null];
    const thresholds = [110, 170];
    for (const layout of secondPassLayouts) {
      const extract = cropFromRatios(metadata, layout);
      if (!isUsableOcrExtract(extract)) continue;
      for (const contrastChannel of contrastChannels) for (const threshold of thresholds) {
        const diagnostic = path.join(cropDir, `${crypto.randomUUID()}-${layout.name}-g${threshold}.png`);
        let thresholdCrop = sharpFile(file)
          .rotate()
          .extract(extract)
          .resize({ width: 1200, withoutEnlargement: false });
        thresholdCrop = contrastChannel === null
          ? thresholdCrop.greyscale()
          : thresholdCrop.extractChannel(contrastChannel);
        await thresholdCrop.normalize().threshold(threshold).png().toFile(diagnostic);
        if (layout.sparse) await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const result = await worker.recognize(diagnostic);
        if (layout.sparse) await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const parsed = parseOcrCandidates(result.data.text, expectedPrefix, expectedNumbers);
        const channelName = contrastChannel === null ? 'gray' : (contrastChannel === 0 ? 'red' : 'green');
        for (const item of parsed) observations.push({ ...item, confidence: Number(result.data.confidence || 0), layout: layout.name, variant: `${channelName}-${threshold}` });
      }
    }
  }

  const grouped = groupObservations(observations);
  const best = grouped[0] || null;
  const second = grouped[1] || null;
  // 单一裁框/阈值即使置信度较高，也曾把清晰的 580 稳定误读为 569。自动改名
  // 必须至少由两个独立裁框或预处理变体形成共识；单票结果保留为候选，交给
  // PDF 唯一缺号和连续拍摄序列复核，不能直接成为“已确认”。
  const reliable = isReliableOcrConsensus(best, second, 20);
  // Windows 自带 OCR 对实拍中很小、偏灰的打印编号明显优于 Tesseract。
  // 仅在本地 OCR 仍未可靠收敛时读取两个严格的编号裁框；结果与当天 PDF
  // 唯一编号集相交后也必须只剩一个编号，才允许采用，正文不会进入该裁框。
  if (!reliable && windowsFallbackFiles.length && appRoot) {
    // Windows OCR 串行读取文件。旧版把每个布局的彩色、红通道、阈值图都
    // 塞进去，单图可达 14 个，30 秒超时前反而读不到最有效的微型原彩框。
    // 只保留按实测有效性排序的 6 个严格编号裁框。
    const windowsPriority = (fileName) => {
      const name = path.basename(fileName);
      if (/current-temple-(?:upper|lower)-code-(?:line|box)-windows-color/.test(name)) return 0;
      if (/current-temple-code-micro-windows-color/.test(name)) return 1;
      if (/current-portrait-code-line-windows-color/.test(name)) return 2;
      if (/current-temple-code-line-windows-color/.test(name)) return 3;
      if (/windows-color/.test(name)) return 4;
      if (/windows-red/.test(name)) return 5;
      return 6;
    };
    const orderedWindowsFiles = [...new Set(windowsFallbackFiles)]
      .sort((left, right) => windowsPriority(left) - windowsPriority(right))
      .slice(0, 6);
    const windows = readWindowsOcrTails(appRoot, orderedWindowsFiles, cropDir);
    const matches = [...new Set([...windows.values()]
      .flatMap((item) => [
        ...(item.numbers || []),
        ...parseLooseWindowsCodeCandidates(item.text, expectedPrefix, expectedNumbers),
      ])
      .filter((number) => expectedNumbers.has(number)))];
    if (matches.length === 1) {
      return {
        file,
        reliable: true,
        number: matches[0],
        paperGeometry: paperEvidence.geometry,
        visualMetrics,
        sceneMetrics,
        evidence: { method: 'windows-ocr-strict-code-crop', votes: windows.size, prefixDistance: null, maxConfidence: 100, layouts: [] },
        candidates: [{ number: matches[0], votes: windows.size, prefixDistance: 0.25, maxConfidence: 100, layouts: ['windows-ocr-strict-code-crop'] }],
      };
    }
  }
  return {
    file,
    reliable,
    number: reliable ? best.number : null,
    paperGeometry: paperEvidence.geometry,
    visualMetrics,
    sceneMetrics,
    evidence: best ? { votes: best.votes, prefixDistance: best.prefixDistance, maxConfidence: best.maxConfidence, layouts: best.layouts } : null,
    candidates: grouped.slice(0, 5),
  };
}

export async function diagnosePhotoCode({ appRoot, file, expectedPrefix, expectedNumbers, cropDir }) {
  fs.mkdirSync(cropDir, { recursive: true });
  const worker = await createOcrWorker(appRoot);
  try {
    return await recognizePreparedImage(worker, file, expectedPrefix, new Set(expectedNumbers), cropDir, appRoot);
  } finally {
    await worker.terminate();
    if (process.env.PRAYER_KEEP_OCR_DIAGNOSTICS !== 'yes') {
      try { fs.rmSync(cropDir, { recursive:true, force:true }); } catch {}
    }
  }
}

const CLOUD_CODE_CROP_LAYOUTS = [
  // 只保留可能出现打印编号的右侧小区域；不发送整张照片、姓名或祈愿正文。
  { left: 0.62, top: 0.16, width: 0.28, height: 0.09 },
  { left: 0.62, top: 0.33, width: 0.28, height: 0.09 },
  { left: 0.62, top: 0.50, width: 0.28, height: 0.09 },
];

async function makeCloudCodeCrop(file) {
  const metadata = autoOrientedMetadata(await sharpFile(file).metadata());
  const panels = await Promise.all(CLOUD_CODE_CROP_LAYOUTS.map(async (layout) => sharpFile(file)
    .rotate()
    .extract(cropFromRatios(metadata, layout))
    .resize({ width: 900, height: 160, fit: 'contain', background: { r: 24, g: 24, b: 24, alpha: 1 } })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 1 })
    .jpeg({ quality: 88 })
    .toBuffer()));
  return sharp({ create: { width: 900, height: 520, channels: 3, background: { r: 24, g: 24, b: 24 } } })
    .composite(panels.map((input, index) => ({ input, left: 0, top: index * 180 })))
    .jpeg({ quality: 88 })
    .toBuffer();
}

function responseOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const chunks = [];
  for (const output of payload?.output || []) for (const content of output?.content || []) {
    if (typeof content?.text === 'string') chunks.push(content.text);
  }
  return chunks.join('\n');
}

function cloudApiFailure(status, payload, transport = 'node-fetch') {
  const error = payload?.error || {};
  const reason = String(error.code || error.type || `http-${status}`);
  const message = String(error.message || '').replace(/[\r\n]+/g, ' ').slice(0, 240);
  if (reason === 'credit_balance_exhausted') return { status: 'no-credits', reason, message, httpStatus: status, transport };
  if (status === 401 || reason === 'invalid_api_key') return { status: 'api-key-rejected', reason, message, httpStatus: status, transport };
  if (status === 429) return { status: 'rate-limited', reason, message, httpStatus: status, transport };
  return { status: 'api-rejected', reason, message, httpStatus: status, transport };
}

// 部分 Windows 网络仅允许 PowerShell/系统代理访问外网，Node 的 fetch 会直连超时。
// 此回退只经 stdin 传递请求 JSON，不写入磁盘；密钥从子进程继承的环境变量读取。
async function postResponsesViaWindowsSystemNetwork(requestBody) {
  if (process.platform !== 'win32') return null;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$requestBase64 = [Console]::In.ReadToEnd().Trim()",
    "$requestBytes = [Convert]::FromBase64String($requestBase64)",
    "$key = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY','Process')",
    "if ([string]::IsNullOrWhiteSpace($key)) { [Console]::Out.Write('{\"ok\":false,\"status\":0,\"body\":\"{\\\"error\\\":{\\\"code\\\":\\\"key_not_available\\\"}}\"}'); exit 0 }",
    "try { $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'https://api.openai.com/v1/responses' -Headers @{ Authorization = ('Bearer ' + $key) } -ContentType 'application/json; charset=utf-8' -Body $requestBytes -TimeoutSec 55; @{ ok = $true; status = [int]$r.StatusCode; body = [string]$r.Content } | ConvertTo-Json -Compress -Depth 3 | Write-Output }",
    "catch { $status = 0; if ($null -ne $_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch {} }; $body = $_.ErrorDetails.Message; if ([string]::IsNullOrWhiteSpace($body)) { $body = '{\"error\":{\"code\":\"system_network_error\"}}' }; @{ ok = $false; status = $status; body = [string]$body } | ConvertTo-Json -Compress -Depth 3 | Write-Output }",
  // try/catch 在 PowerShell 中必须相邻；不能用分号把它们拆开。
  ].join('\n');
  return await new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const output = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        const wrapper = JSON.parse(Buffer.concat(output).toString('utf8').trim());
        const body = JSON.parse(wrapper.body || '{}');
        resolve({ ok: wrapper.ok === true && Number(wrapper.status) >= 200 && Number(wrapper.status) < 300, status: Number(wrapper.status) || 0, json: async () => body, transport: 'windows-system-network' });
      } catch { resolve(null); }
    });
    child.stdin.end(Buffer.from(JSON.stringify(requestBody), 'utf8').toString('base64'));
  });
}

function parseCloudCodeResults(text, allowedIds, expectedNumbers) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return new Map(); }
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const proposed = new Map();
  const claimedNumbers = new Map();
  for (const result of results) {
    const id = String(result?.id || '');
    const number = result?.number;
    if (!allowedIds.has(id) || !Number.isInteger(number) || !expectedNumbers.has(number) || result?.confidence !== 'high') continue;
    if (!claimedNumbers.has(number)) claimedNumbers.set(number, []);
    claimedNumbers.get(number).push(id);
    proposed.set(id, number);
  }
  // 同一个编号被多个小裁剪声称命中时，保持未决，避免云端误把相似版式重复编号。
  for (const ids of claimedNumbers.values()) if (ids.length > 1) for (const id of ids) proposed.delete(id);
  return proposed;
}

// 仅用于“本地 OCR 无法安全编号”的最后兜底。密钥只从当前进程环境变量读取，
// 不落盘、不写日志；请求体不包含原始文件名、客户资料或完整原图。
export async function resolvePhotoNumbersWithCloudVision({ items = [] }) {
  // 保留导出名仅兼容旧版调用方。V9.5.43 禁用该路径，绝不读取环境变量或发起网络请求。
  return { status: 'disabled-by-local-mode', resolved: 0, attempted: items.filter((item) => !item.reliable && !isLikelyScene(item)).length };
  /* 旧实现保留在此版本源代码中只供历史迁移比对，运行时不可达。
  const eligible = items.filter((item) => !item.reliable && !isLikelyScene(item));
  if (!eligible.length) return { status: 'not-needed', resolved: 0, attempted: 0 };
  if (!apiKey) return { status: 'not-configured', resolved: 0, attempted: eligible.length };
  if (typeof fetchImpl !== 'function') return { status: 'unavailable', resolved: 0, attempted: eligible.length };

  onProgress?.(`本地 OCR 未能安全编号，正在对 ${eligible.length} 张照片的编号小裁剪进行云端复核。`);
  const opaqueIds = eligible.map((_, index) => `code-${String(index + 1).padStart(2, '0')}`);
  const content = [{
    type: 'input_text',
    text: `每张图仅是可能含有打印编号的局部裁剪，可能为空或不是编号。请只读取形如 ${expectedPrefix}-1-N 的编号末段 N。允许的 N 仅为：${[...expectedNumbers].sort((a, b) => a - b).join(', ')}。不要根据顺序猜测；看不清、没有完整编号或不确定时 number 必须为 null。逐张按其 code-XX 标识返回。`,
  }];
  for (let index = 0; index < eligible.length; index += 1) {
    const crop = await makeCloudCodeCrop(eligible[index].file);
    content.push({ type: 'input_text', text: opaqueIds[index] });
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${crop.toString('base64')}`, detail: 'high' });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response;
  let transport = 'node-fetch';
  const requestBody = {
    model,
    input: [{ role: 'user', content }],
    max_output_tokens: 500,
    text: {
      format: {
        type: 'json_schema', name: 'prayer_code_crop_result', strict: true,
        schema: {
          type: 'object', additionalProperties: false, required: ['results'],
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['id', 'number', 'confidence'],
                properties: {
                  id: { type: 'string' },
                  number: { type: ['integer', 'null'] },
                  confidence: { type: 'string', enum: ['high', 'low'] },
                },
              },
            },
          },
        },
      },
    },
  };
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    response = await postResponsesViaWindowsSystemNetwork(requestBody);
    transport = response?.transport || 'node-fetch';
    if (!response) {
      if (error?.name === 'AbortError') return { status: 'timeout', reason: 'node-network-timeout', resolved: 0, attempted: eligible.length, transport };
      return { status: 'unavailable', reason: 'node-network-unavailable', resolved: 0, attempted: eligible.length, transport };
    }
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    return { ...cloudApiFailure(response?.status, payload, transport), resolved: 0, attempted: eligible.length };
  }
  let payload;
  try { payload = await response.json(); } catch { return { status: 'invalid-response', reason: 'response-json-invalid', resolved: 0, attempted: eligible.length, transport }; }
  const resolvedById = parseCloudCodeResults(responseOutputText(payload), new Set(opaqueIds), expectedNumbers);
  const occupied = new Set(items.filter((item) => item.reliable).map((item) => item.number));
  let resolved = 0;
  for (let index = 0; index < eligible.length; index += 1) {
    const item = eligible[index];
    const number = resolvedById.get(opaqueIds[index]);
    const localConflict = (item.candidates || []).some((candidate) => candidate.prefixDistance <= 2 && candidate.number !== number);
    if (!Number.isInteger(number) || occupied.has(number) || localConflict) continue;
    item.reliable = true;
    item.number = number;
    item.evidence = { method: 'cloud-vision-code-crop', votes: 1, prefixDistance: 0, maxConfidence: 100, layouts: ['cloud-code-crop'] };
    occupied.add(number);
    resolved += 1;
  }
  return { status: 'completed', resolved, attempted: eligible.length, transport };
  */
}

function groupObservations(observations) {
  const groups = new Map();
  for (const item of observations) {
    const current = groups.get(item.number) || { number: item.number, votes: 0, prefixDistance: 99, maxConfidence: 0, layouts: [], evidenceKeys: new Set() };
    const evidenceKey = `${item.layout || ''}|${item.variant || ''}`;
    if (!current.evidenceKeys.has(evidenceKey)) {
      current.evidenceKeys.add(evidenceKey);
      current.votes += 1;
    }
    current.prefixDistance = Math.min(current.prefixDistance, item.prefixDistance);
    current.maxConfidence = Math.max(current.maxConfidence, item.confidence);
    if (!current.layouts.includes(item.layout)) current.layouts.push(item.layout);
    groups.set(item.number, current);
  }
  return [...groups.values()]
    .map(({ evidenceKeys, ...group }) => group)
    .sort((a, b) => b.votes - a.votes || a.prefixDistance - b.prefixDistance || b.maxConfidence - a.maxConfidence);
}

async function normalizedImageCorrelation(leftFile, rightFile) {
  const [left, right] = await Promise.all([
    sharpFile(leftFile).rotate().resize(64, 48, { fit: 'fill' }).greyscale().normalize().raw().toBuffer(),
    sharpFile(rightFile).rotate().resize(64, 48, { fit: 'fill' }).greyscale().normalize().raw().toBuffer(),
  ]);
  let leftMean = 0;
  let rightMean = 0;
  for (let index = 0; index < left.length; index += 1) {
    leftMean += left[index];
    rightMean += right[index];
  }
  leftMean /= left.length;
  rightMean /= right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  return numerator / Math.sqrt(Math.max(leftVariance * rightVariance, 1));
}

function verifiedBatchKnownNameSet(date, images, expectedNumbers) {
  const evidence = VERIFIED_BATCH_EVIDENCE[date];
  if (!evidence) return null;
  const requiredNames = [
    ...Object.keys(evidence.blessing),
    ...Object.keys(evidence.scenes),
    ...Object.keys(evidence.duplicates),
  ];
  const matches = evidence.expectedNumbers.length === expectedNumbers.size
    && evidence.expectedNumbers.every((number) => expectedNumbers.has(number))
    && verifiedBatchMatchesKnownFiles(evidence, images, requiredNames);
  return matches ? new Set(requiredNames) : null;
}

function verifiedBatchMatchesKnownFiles(evidence, images, requiredNames) {
  const byName = new Map(images.map((file) => [path.basename(file), file]));
  if (!requiredNames.every((name) => byName.has(name))) return false;
  if (!evidence.knownFilesHash) return true;
  const hash = crypto.createHash('sha256');
  for (const name of [...requiredNames].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))) {
    hash.update(name);
    hash.update('\0');
    hash.update(sha256(byName.get(name)));
    hash.update('\0');
  }
  return hash.digest('hex') === evidence.knownFilesHash;
}

async function applyVerifiedBatchEvidence({ date, images, recognized, expectedNumbers }) {
  const evidence = VERIFIED_BATCH_EVIDENCE[date];
  if (!evidence) return { applied: false, duplicateSources: [], sceneAssignments: [] };
  const byName = new Map(images.map((file) => [path.basename(file), file]));
  const requiredNames = [
    ...Object.keys(evidence.blessing),
    ...Object.keys(evidence.scenes),
    ...Object.keys(evidence.duplicates),
  ];
  const expectedMatches = evidence.expectedNumbers.length === expectedNumbers.size
    && evidence.expectedNumbers.every((number) => expectedNumbers.has(number));
  if (!expectedMatches || !verifiedBatchMatchesKnownFiles(evidence, images, requiredNames)) {
    return { applied: false, duplicateSources: [], sceneAssignments: [] };
  }

  const duplicateNumber = Object.values(evidence.duplicates)[0];
  const canonicalDuplicate = byName.get(Object.keys(evidence.blessing).find((name) => evidence.blessing[name] === duplicateNumber));
  if (evidence.duplicateValidation !== 'manual-visual-review') {
    for (const name of Object.keys(evidence.duplicates)) {
      const correlation = await normalizedImageCorrelation(canonicalDuplicate, byName.get(name));
      if (correlation < 0.999) {
        return { applied: false, duplicateSources: [], sceneAssignments: [] };
      }
    }
  }

  const recognizedByName = new Map(recognized.map((item) => [path.basename(item.file), item]));
  for (const [name, number] of Object.entries(evidence.blessing)) {
    const item = recognizedByName.get(name);
    if (!item) return { applied: false, duplicateSources: [], sceneAssignments: [] };
    item.reliable = true;
    item.number = number;
    item.evidence = {
      method: `manual-visual-review-and-pdf-index-${date}`,
      votes: 1,
      prefixDistance: 0,
      maxConfidence: 100,
      layouts: [],
    };
  }
  const duplicateSources = Object.entries(evidence.duplicates).map(([name, number]) => ({
    source: byName.get(name),
    duplicateOfNumber: number,
    evidence: evidence.duplicateValidation === 'manual-visual-review'
      ? { method: `manual-visual-duplicate-review-${date}` }
      : { method: 'perceptual-duplicate-correlation', minimumCorrelation: 0.999 },
  }));
  const sceneAssignments = Object.entries(evidence.scenes).map(([name, targetName]) => ({
    source: byName.get(name),
    targetName,
    kind: targetName.startsWith('2.5') || targetName.startsWith('2.6') ? 'scene-water' : 'scene-lamp',
    evidence: { method: `manual-visual-review-${date}` },
  }));
  return { applied: true, duplicateSources, sceneAssignments };
}

async function renderPdfPage(pdfjs, page) {
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { buffer: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height };
}

// 本地 PDF 页面指纹兜底：只比较纸张内的印刷版式，不读取文件名，也不访问
// 网络。它用于 OCR 未能唯一读出右上角编号的照片。与 PDF 页面的最佳匹配必须
// 同时满足最低相似度、与次优候选的差距、以及一个编号只能被一张照片认领，
// 否则保持未决，绝不按拍摄顺序猜号。
const SHAPE_WIDTH = 192;
const SHAPE_HEIGHT = 128;

export async function localShapeFingerprint(input) {
  const normalized = await input
    .clone()
    .removeAlpha()
    .greyscale()
    .normalize()
    .resize(SHAPE_WIDTH, SHAPE_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer();
  const blurred = await sharp(normalized, { raw: { width: SHAPE_WIDTH, height: SHAPE_HEIGHT, channels: 1 } })
    .blur(4)
    .raw()
    .toBuffer();
  const values = new Float32Array(SHAPE_WIDTH * SHAPE_HEIGHT);
  let squareSum = 0;
  for (let y = 3; y < SHAPE_HEIGHT - 28; y += 1) {
    for (let x = 3; x < SHAPE_WIDTH - 3; x += 1) {
      const index = y * SHAPE_WIDTH + x;
      // 同时保留黑字细节和边缘，压制红/黄纸本身的整体亮度差异。
      const localDark = Math.max(0, Number(blurred[index]) - Number(normalized[index]) - 9);
      const horizontal = Math.abs(Number(normalized[index + 1]) - Number(normalized[index - 1]));
      const vertical = Math.abs(Number(normalized[index + SHAPE_WIDTH]) - Number(normalized[index - SHAPE_WIDTH]));
      const value = localDark / 255 + Math.max(0, horizontal + vertical - 24) / 510;
      values[index] = value;
      squareSum += value * value;
    }
  }
  const norm = Math.sqrt(squareSum);
  if (norm < 0.0001) return null;
  for (let index = 0; index < values.length; index += 1) values[index] /= norm;
  return values;
}

function localShapeSimilarity(left, right) {
  if (!left || !right) return 0;
  let best = 0;
  for (const offsetY of [-4, -2, 0, 2, 4]) for (const offsetX of [-4, -2, 0, 2, 4]) {
    let total = 0;
    for (let y = 4; y < SHAPE_HEIGHT - 30; y += 1) for (let x = 4; x < SHAPE_WIDTH - 4; x += 1) {
      const otherX = x + offsetX;
      const otherY = y + offsetY;
      if (otherX < 0 || otherX >= SHAPE_WIDTH || otherY < 0 || otherY >= SHAPE_HEIGHT) continue;
      total += left[y * SHAPE_WIDTH + x] * right[otherY * SHAPE_WIDTH + otherX];
    }
    best = Math.max(best, total);
  }
  return Math.max(0, Math.min(1, best));
}

async function photoShapeFingerprints(item) {
  const geometry = item.paperGeometry;
  if (!geometry?.usablePaper && !geometry?.rectangularPaper) return [];
  const metadata = autoOrientedMetadata(await sharpFile(item.file).metadata());
  const variants = [
    ['paper-declared', 1, 0], ['paper-90-up', 0.9, -0.025], ['paper-82-up', 0.82, -0.03],
    ['paper-82-centred', 0.82, 0], ['paper-72-up', 0.72, -0.03], ['paper-72-centred', 0.72, 0],
  ];
  const result = [];
  for (const [name, scale, shift] of variants) {
    const height = geometry.height * scale;
    const top = Math.max(0, Math.min(1 - height, geometry.top + (geometry.height - height) / 2 + shift));
    const extract = cropFromRatios(metadata, { left: geometry.left, top, width: geometry.width, height });
    const vector = await localShapeFingerprint(sharpFile(item.file).rotate().extract(extract));
    if (vector) result.push({ name, vector });
  }
  // 当前 4:3 相机有两个稳定纸面区域。纸张颜色与木架或神像连通时，动态
  // geometry 会几乎覆盖整幅画面；继续缩放这个错误框不会得到可比指纹。
  // 固定区域只用于本地 PDF 版式复核，最终仍需相似度、次优差距和一页一图
  // 三重约束，不会单凭相机位置落号。
  const aspect = Number(metadata.width || 0) / Math.max(1, Number(metadata.height || 0));
  if (aspect >= 1.20 && aspect <= 1.50) {
    const cameraPaperLayouts = [
      ['camera-water-board', { left: 0.285, top: 0.505, width: 0.48, height: 0.485 }],
      ['camera-water-board-tight', { left: 0.30, top: 0.525, width: 0.45, height: 0.455 }],
      ['camera-lamp-board', { left: 0.19, top: 0.36, width: 0.59, height: 0.54 }],
      ['camera-lamp-paper', { left: 0.21, top: 0.40, width: 0.55, height: 0.46 }],
    ];
    for (const [name, layout] of cameraPaperLayouts) {
      const extract = cropFromRatios(metadata, layout);
      const vector = await localShapeFingerprint(sharpFile(item.file).rotate().extract(extract));
      if (vector) result.push({ name, vector });
    }
  }
  return result;
}

export async function matchPdfPagesLocally(recognized, pdfPages, onProgress = null, claimedNumbers = new Set()) {
  const eligible = recognized.filter((item) => !item.reliable && !isLikelyScene(item)
    && (item.paperGeometry?.usablePaper || item.paperGeometry?.rectangularPaper));
  // 已有数字文件和已由强 OCR 确认的照片已经占用了对应页面。未决照片只应
  // 在尚缺编号中竞争；若仍拿整本 PDF 比对，模板相近的已占用页面会成为
  // 假阳性第一名，反而把可以由“缺号 + 页面版式”唯一确认的补图留在人工项。
  const indexedPages = pdfPages.filter((page) => Number.isInteger(page.number)
    && page._localShapeFingerprint && !claimedNumbers.has(page.number));
  if (!eligible.length || !indexedPages.length) return { status: 'not-needed', attempted: 0, resolved: 0, unresolved: 0 };
  onProgress?.(`本地 PDF 页面版式匹配：正在复核 ${eligible.length} 张未决纸张照片（不使用云端）。`);
  const rows = [];
  for (const item of eligible) {
    const variants = await photoShapeFingerprints(item);
    if (!variants.length) continue;
    const paperColor = await dominantPaperColor(item.file,item.paperGeometry);
    // 供水福单也使用红纸，但文件名是“供水”而非“红纸”；必须进入同一
    // 候选集合，否则 599–601 会被错误排除，只剩 602 红纸页参与比较。
    const sameColorPages = paperColor === 'red' ? indexedPages.filter((page)=>/(?:红纸|供水)/.test(page.pdfName || ''))
      : paperColor === 'yellow' ? indexedPages.filter((page)=>/黄纸/.test(page.pdfName || '')) : [];
    const sameOrientationPages = indexedPages.filter((page)=>page.portrait === (item.paperGeometry.height > item.paperGeometry.width * 1.25));
    const candidatePages = sameColorPages.length ? sameColorPages
      : sameOrientationPages.length ? sameOrientationPages : indexedPages;
    const scores = candidatePages
      .map((page) => {
        const variantScores = variants.map((variant) => ({ name: variant.name, score: localShapeSimilarity(variant.vector, page._localShapeFingerprint) }))
          .sort((a, b) => b.score - a.score);
        const stable = variantScores.slice(0, Math.min(3, variantScores.length)).reduce((sum, value) => sum + value.score, 0) / Math.min(3, variantScores.length);
        return { page, score: 0.8 * variantScores[0].score + 0.2 * stable, variant: variantScores[0].name };
      })
      .sort((a, b) => b.score - a.score || a.page.number - b.page.number);
    if (scores.length) rows.push({ item, scores });
  }
  const claims = new Map();
  for (const row of rows) {
    const best = row.scores[0];
    const second = row.scores[1];
    const margin = best.score - (second?.score ?? 0);
    // 阈值刻意保守：只有纸张布局有明显唯一性才采用，低质量或模板相似时保留人工清单。
    if (best.score < 0.26 || margin < 0.035) continue;
    if (!claims.has(best.page.number)) claims.set(best.page.number, []);
    claims.get(best.page.number).push({ row, best, margin });
  }
  let resolved = 0;
  for (const candidates of claims.values()) {
    if (candidates.length !== 1) continue;
    const { row, best, margin } = candidates[0];
    const conflictingLocalOcr = (row.item.candidates || []).some((candidate) => candidate.prefixDistance <= 2 && candidate.number !== best.page.number);
    if (conflictingLocalOcr) continue;
    row.item.reliable = true;
    row.item.number = best.page.number;
    row.item.evidence = {
      method: 'local-pdf-page-shape-fingerprint', votes: 1, prefixDistance: null,
      maxConfidence: Math.round(best.score * 100), layouts: [best.variant],
      shapeScore: Number(best.score.toFixed(4)), shapeMargin: Number(margin.toFixed(4)),
    };
    resolved += 1;
  }
  return {
    status: 'completed', attempted: eligible.length, resolved, unresolved: eligible.length - resolved,
    diagnostics: rows.map((row) => ({
      file:path.basename(row.item.file),
      top:row.scores.slice(0,5).map(({page,score,variant}) => ({number:page.number,pdfName:page.pdfName,score:Number(score.toFixed(4)),variant})),
    })),
  };
}

// 按证据类型做编号二次复核。清晰可见编号使用“多裁框 OCR 共识 + PDF 编号
// 索引存在性”两条证据；折叠、遮挡或由缺号/顺序推断的照片才使用 PDF 正文
// 指纹。不能把同模板整本 PDF 的低区分度灰度排名当成反证，否则会把大量
// 正确旧照片误报为错号。纯数字旧文件若纸面暂时读不出，只报告 inconclusive，
// 只有读出不同编号才判冲突；只读复核绝不自动改名或覆盖线上结果。
export async function recheckReliablePhotoClaimsWithPdf(items, pdfPages, onProgress = null, options = {}) {
  const trustedManual = (item) => /manual-visual-review|manual-pdf-content-and-folded-photo-fingerprint-review/.test(String(item?.evidence?.method || ''));
  const eligible = items.filter((item) => item?.reliable && Number.isInteger(item.number)
    && !isLikelyScene(item));
  if (!eligible.length) return { status:'not-needed', attempted:0, confirmed:0, rejected:0, inconclusive:0, diagnostics:[] };
  const indexedPages = pdfPages.filter((page) => Number.isInteger(page.number) && page._localShapeFingerprint);
  const candidateNumbers = options.candidateNumbers instanceof Set ? options.candidateNumbers : null;
  onProgress?.(`编号二次复核：正在按证据类型检查 ${eligible.length} 张福单；清晰编号核对 PDF 索引，折叠或推断编号核对 PDF 正文指纹。`);
  const diagnostics = [];
  let confirmed = 0;
  let rejected = 0;
  let inconclusive = 0;
  for (const item of eligible) {
    const claimedNumber = item.number;
    const claimedPages = indexedPages.filter((page) => page.number === claimedNumber);
    let reason = null;
    let status = 'confirmed';
    let scores = [];
    const method = String(item?.evidence?.method || '');
    const strictVisibleCode = method === 'windows-ocr-strict-lower-code-box'
      && Number(item?.evidence?.prefixDistance ?? 99) <= 0.1
      && Number(item?.evidence?.maxConfidence || 0) >= 80;
    const visibleConsensus = /(?:ocr|photo-code|targeted-landscape-code)/.test(method)
      && ((Number(item?.evidence?.votes || 0) >= 2
        && Number(item?.evidence?.maxConfidence || 0) >= 20) || strictVisibleCode);
    if (method === 'existing-numeric-filename-claim' && Number.isInteger(item.observedOcrNumber) && item.observedOcrNumber !== claimedNumber) {
      reason = 'visible-code-disagrees-with-filename';
    } else if (claimedPages.length !== 1) {
      reason = 'claimed-pdf-page-not-unique';
    } else if (method === 'existing-numeric-filename-claim' && item.observedOcrNumber === claimedNumber) {
      item.evidence.pdfRecheck={method:'existing-filename-visible-code-and-pdf-index',status:'confirmed'};
    } else if (method === 'existing-numeric-filename-claim' && !Number.isInteger(item.observedOcrNumber)) {
      status = 'inconclusive';
      inconclusive += 1;
    } else if (trustedManual(item)) {
      item.evidence.pdfRecheck={method:'preserved-manual-pdf-content-review',status:'confirmed'};
    } else if (visibleConsensus) {
      item.evidence.pdfRecheck={method:strictVisibleCode
        ? 'strict-visible-code-box-and-pdf-index'
        : 'multi-crop-visible-code-and-pdf-index',status:'confirmed'};
    } else {
      const variants = await photoShapeFingerprints(item);
      if (!variants.length) reason = 'paper-fingerprint-unavailable';
      else {
        const paperColor = await dominantPaperColor(item.file,item.paperGeometry);
        const missingPages = candidateNumbers ? indexedPages.filter((page)=>candidateNumbers.has(page.number)) : indexedPages;
        const sameColorPages = paperColor === 'red' ? missingPages.filter((page)=>/(?:红纸|供水)/.test(page.pdfName || ''))
          : paperColor === 'yellow' ? missingPages.filter((page)=>/黄纸/.test(page.pdfName || '')) : [];
        const candidatePages = sameColorPages.length ? sameColorPages : missingPages;
        scores = candidatePages.map((page) => {
          const variantScores = variants.map((variant) => ({name:variant.name,score:localShapeSimilarity(variant.vector,page._localShapeFingerprint)}))
            .sort((a,b)=>b.score-a.score);
          const topCount = Math.min(3,variantScores.length);
          const stable = variantScores.slice(0,topCount).reduce((sum,value)=>sum+value.score,0)/Math.max(1,topCount);
          return {page,score:0.8*variantScores[0].score+0.2*stable,variant:variantScores[0].name};
        }).sort((a,b)=>b.score-a.score || a.page.number-b.page.number);
        const claimIndex = scores.findIndex((score)=>score.page.number===claimedNumber);
        const claim = claimIndex >= 0 ? scores[claimIndex] : null;
        const bestOther = scores.find((score)=>score.page.number!==claimedNumber);
        const margin = Number(claim?.score || 0)-Number(bestOther?.score || 0);
        if (!claim) reason = 'claimed-page-not-in-candidate-set';
        else if (claimIndex !== 0) reason = 'pdf-fingerprint-prefers-another-page';
        else if (claim.score < 0.26) reason = 'pdf-fingerprint-score-too-low';
        else if (scores.length > 1 && margin < 0.035) reason = 'pdf-fingerprint-margin-too-small';
        if (!reason) {
          item.evidence = {
            ...item.evidence,
            pdfRecheck:{method:'independent-pdf-page-content-fingerprint',status:'confirmed',score:Number(claim.score.toFixed(4)),margin:Number(margin.toFixed(4)),variant:claim.variant},
          };
        }
      }
    }
    if (reason) {
      item.reliable = false;
      item.pdfRecheck = {status:'rejected',reason,claimedNumber};
      rejected += 1;
      status = 'rejected';
    } else if (status === 'confirmed') {
      confirmed += 1;
    }
    diagnostics.push({
      file:path.basename(item.file),claimedNumber,status,reason,
      top:scores.slice(0,5).map(({page,score,variant})=>({number:page.number,pdfName:page.pdfName,score:Number(score.toFixed(4)),variant})),
    });
  }
  return {status:'completed',attempted:eligible.length,confirmed,rejected,inconclusive,diagnostics};
}

export function parseWindowsOcrTail(text) {
  const normalized = normalizeOcr(text);
  const matches = [...normalized.matchAll(/(?:^|\D)(\d{3,4})(?!\d)/g)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

function parseWindowsOcrNumbers(text) {
  const normalized = normalizeOcr(text);
  return [...new Set([...normalized.matchAll(/(?:^|\D)(\d{3,4})(?!\d)/g)].map((match) => Number(match[1])))];
}

// Windows OCR 在极小的实拍编号上常把 8 读成 B、9 读成 g/q，也可能只保留
// 三位尾号的最后两位。这里仍以当天 PDF 的真实编号集合为边界：字符归一化
// 后的完整三/四位数字可以直接作为候选；残缺两位尾号则必须同时存在一个与
// 平台前缀编辑距离不超过 1 的三位数字，并且在 PDF 集合中只能对应一个编号。
// 因此不会仅凭“当天缺哪个号”猜测照片编号。
export function parseLooseWindowsCodeCandidates(text, expectedPrefix, expectedNumbers) {
  const normalized = normalizeOcr(text)
    .replace(/[BRbr]/g, '8')
    .replace(/[gq]/g, '9');
  const tokens = [...normalized.matchAll(/\d{1,4}/g)]
    .map((match) => ({ value: match[0], index: match.index || 0 }));
  const candidates = new Set(tokens
    .map((token) => Number(token.value))
    .filter((number) => Number.isInteger(number) && expectedNumbers?.has(number)));
  const prefixText = String(expectedPrefix || '');
  const prefixTokens = tokens.filter((token) => (token.value.length === prefixText.length
    && editDistance(token.value, prefixText) <= 1)
    // 极小红纸编号的首位 2 偶尔会被木架边缘吞掉，例如 268 -> 6R -> 68。
    // 只接受完整业务前缀的末两位原样命中，不接受任意两位近似。
    || (prefixText.length === 3 && token.value === prefixText.slice(-2)));
  for (const prefixToken of prefixTokens) {
    const laterTokens = tokens.filter((token) => token.index > prefixToken.index);
    // Windows OCR 会把清晰的 577 分成“57 7”。相邻数字片段合并后若正好
    // 命中当天 PDF 集合，应优先于把“57”当成残缺尾号推成 557。
    const joinedCandidates = new Set();
    for (let index = 0; index < laterTokens.length - 1; index += 1) {
      const joined = laterTokens[index].value + laterTokens[index + 1].value;
      if (joined.length < 3 || joined.length > 4) continue;
      const number = Number(joined);
      if (expectedNumbers?.has(number)) joinedCandidates.add(number);
    }
    if (joinedCandidates.size === 1) {
      candidates.add([...joinedCandidates][0]);
      continue;
    }
    for (const token of laterTokens) {
      if (token.index <= prefixToken.index || token.value.length < 2 || token.value.length > 3) continue;
      const matches = [...(expectedNumbers || [])]
        .filter((number) => String(number).endsWith(token.value));
      if (matches.length === 1) candidates.add(matches[0]);
    }
  }
  return [...candidates];
}

function readWindowsOcrTails(appRoot, files, workDir) {
  if (process.platform !== 'win32' || !appRoot || !files.length) return new Map();
  const script = path.join(appRoot, 'ui', 'Read-WindowsOcr.ps1');
  if (!fs.existsSync(script)) return new Map();
  const inputList = path.join(workDir, `windows-ocr-input-${crypto.randomUUID()}.txt`);
  let result;
  try {
    fs.writeFileSync(inputList, files.join('\n'), 'utf8');
    result = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputListPath', inputList,
    ], { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  } finally {
    fs.rmSync(inputList, { force: true });
  }
  if (result.error || result.status !== 0) return new Map();
  const values = new Map();
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      const number = parseWindowsOcrTail(item.text);
      const numbers = parseWindowsOcrNumbers(item.text);
      const normalizedText = normalizeOcr(item.text);
      // “6R · 57 7”这类结果没有连续三位数字，旧版在进入宽松但受 PDF
      // 集合约束的解析器之前就把整条 OCR 结果丢弃，导致后面的安全还原逻辑
      // 永远没有机会运行。保留非空的严格编号裁框文本；候选是否可采信仍由
      // parseLooseWindowsCodeCandidates 和当天 PDF 唯一编号集合决定。
      if (item.path && normalizedText) values.set(path.resolve(item.path), { number, numbers, text: normalizedText });
    } catch {}
  }
  return values;
}

function pdfSeriesNumber(file) {
  const match = /(?:红纸|黄纸)(\d+)/.exec(path.basename(file));
  return match ? Number(match[1]) : 0;
}

export function sortPdfDescriptorsByBusinessOrder(descriptors) {
  const rank = (item) => {
    const name = path.basename(item.file);
    if (/供水/.test(name)) return 0;
    if (!item.portrait && /红纸/.test(name)) return 10;
    if (!item.portrait && /黄纸/.test(name)) return 20;
    if (item.portrait && /红纸/.test(name)) return 30;
    if (item.portrait && /黄纸/.test(name)) return 40;
    return 50;
  };
  return [...descriptors].sort((a, b) =>
    rank(a) - rank(b)
      || pdfSeriesNumber(a.file) - pdfSeriesNumber(b.file)
      || path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }));
}

export async function indexPdfCodes(worker, pdfFiles, expectedPrefix, workDir, appRoot = null) {
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const cropDir = path.join(workDir, 'pdf-code-crops');
  fs.mkdirSync(cropDir, { recursive: true });
  const pages = [];
  const descriptors = [];
  for (const file of pdfFiles) {
    const document = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true }).promise;
    const firstPage = await document.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    descriptors.push({ file, document, portrait: firstViewport.height > firstViewport.width });
  }
  for (const { file, document } of sortPdfDescriptorsByBusinessOrder(descriptors)) {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const rendered = await renderPdfPage(pdfjs, page);
      const portrait = rendered.height > rendered.width;
      const observations = [];
      let windowsFallbackFile = null;
      for (const layout of PDF_CODE_LAYOUTS[portrait ? 'portrait' : 'landscape']) {
        const diagnostic = path.join(cropDir, `${crypto.randomUUID()}-${layout.name}.png`);
        let crop = sharp(rendered.buffer)
          .extract(cropFromRatios(rendered, layout))
          .resize({ width: 1400, withoutEnlargement: false })
          .greyscale()
          .normalize()
          .sharpen({ sigma: 1 });
        if (layout.threshold) crop = crop.threshold(layout.threshold);
        await crop.png().toFile(diagnostic);
        if (layout.name === (portrait ? 'portrait-wide' : 'landscape-wide')) windowsFallbackFile = diagnostic;
        if (layout.sparse) await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const result = await worker.recognize(diagnostic);
        if (layout.sparse) await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const candidates = parseOcrCandidates(result.data.text, expectedPrefix);
        for (const candidate of candidates) {
          observations.push({
            ...candidate,
            confidence: Number(result.data.confidence || 0),
            layout: layout.name,
            ocrText: normalizeOcr(result.data.text),
          });
        }
        const tail = parsePdfTailCandidate(result.data.text);
        if (Number.isInteger(tail) && !candidates.some((item) => item.number === tail)) {
          observations.push({
            number: tail,
            prefixDistance: 99,
            confidence: Number(result.data.confidence || 0),
            layout: layout.name,
            ocrText: normalizeOcr(result.data.text),
          });
        }
      }
      observations.sort((a, b) =>
        a.prefixDistance - b.prefixDistance
          || b.confidence - a.confidence
          || String(a.layout).localeCompare(String(b.layout)));
      const exact = observations[0] || null;
      const rawNumber = exact?.number || null;
      pages.push({
        pdf: file,
        pdfName: path.basename(file),
        pageNumber,
        portrait,
        rawNumber,
        number: null,
        prefixDistance: exact?.prefixDistance ?? null,
        ocrText: exact?.ocrText || '',
        ocrLayout: exact?.layout || null,
        ocrObservations: observations.slice(0, 8),
        windowsFallbackFile,
        // 仅在本次内存中的照片规划期间使用；返回执行计划前会删除，绝不写入
        // NAS 或运行日志。
        _localShapeFingerprint: await localShapeFingerprint(sharp(rendered.buffer)),
      });
    }
  }
  for (const { document } of descriptors) await document.destroy();
  const ambiguousPages = pages.filter((page) => {
    const exact = page.ocrObservations.filter((item) => item.prefixDistance === 0).slice(0,2);
    return exact.length === 2 && exact[0].number !== exact[1].number && Math.abs(Number(exact[0].confidence)-Number(exact[1].confidence)) <= 5;
  });
  if (ambiguousPages.length) {
    const windowsOcr = readWindowsOcrTails(appRoot, ambiguousPages.map((page) => page.windowsFallbackFile).filter(Boolean), workDir);
    for (const page of ambiguousPages) {
      const observation = windowsOcr.get(path.resolve(page.windowsFallbackFile || ''));
      if (!observation) continue;
      const closeCandidates = [...new Set(page.ocrObservations.filter((item) => item.prefixDistance === 0).map((item) => item.number))];
      const confirmed = closeCandidates.filter((number) => observation.numbers.includes(number));
      if (confirmed.length !== 1) continue;
      page.rawNumber = confirmed[0];
      page.ocrText = observation.text;
      page.ocrLayout = 'windows-ocr-ambiguous-code-confirmation';
      page.ocrObservations.unshift({ number:confirmed[0],prefixDistance:0,confidence:100,layout:'windows-ocr-ambiguous-code-confirmation',ocrText:observation.text });
    }
  }
  inferSequentialPdfCodes(pages);
  if (pages.some((page) => !Number.isInteger(page.number))) {
    const windowsOcr = readWindowsOcrTails(appRoot, pages.filter((page)=>!Number.isInteger(page.number)).map((page) => page.windowsFallbackFile).filter(Boolean), workDir);
    if (windowsOcr.size) {
      for (const page of pages) {
        const observation = windowsOcr.get(path.resolve(page.windowsFallbackFile || ''));
        if (!observation) continue;
        page.rawNumber = observation.number;
        page.ocrText = observation.text;
        page.ocrLayout = 'windows-ocr-top-right';
        page.ocrObservations = [{ number: observation.number, prefixDistance: 0.25, confidence: 100, layout: 'windows-ocr-top-right', ocrText: observation.text }];
        page.number = null;
        delete page.codeEvidence;
        delete page.sequenceScore;
      }
      inferSequentialPdfCodes(pages);
    }
  }
  for (const page of pages) delete page.windowsFallbackFile;
  return pages;
}

async function sceneVisualScore(file) {
  const { data, info } = await sharpFile(file).rotate().resize(160, 120, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let luminance = 0;
  let warmBright = 0;
  let dark = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminance += value;
    if (value >= 150 && r >= g * 1.05 && g >= b * 1.15) warmBright += 1;
    if (value <= 65) dark += 1;
  }
  const pixels = info.width * info.height;
  return { luminance: luminance / pixels, warmBrightRatio: warmBright / pixels, darkRatio: dark / pixels };
}

// 场景补图可能一次只回传一张，不能依赖同批图片之间的相对明暗。这里保留
// 一条可单图判定的绝对证据路径：白天供水全景暗像素极少且整体亮度较高；
// 夜间供灯图暗像素和暖色高光同时明显。处在两者之间的图片保持未决。
export function classifySceneVisualScore(item) {
  if (item.darkRatio <= 0.18 && item.luminance >= 110) return 'scene-water';
  if (item.darkRatio >= 0.32 && item.warmBrightRatio >= 0.10) return 'scene-lamp';
  // 远一点的灯阵曝光更低，亮焰面积会明显缩小；暗像素、低平均亮度和仍然
  // 可见的暖色高光三项同时成立时，依然是单图可确认的供灯场景。
  if (item.darkRatio >= 0.35 && item.luminance <= 95 && item.warmBrightRatio >= 0.055) return 'scene-lamp';
  return null;
}

async function largePaperScore(file) {
  const { data, info } = await sharpFile(file).rotate().resize({ width: 320, height: 240, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * info.channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const red = r > 80 && r > g * 1.22 && r > b * 1.12 && r - Math.min(g, b) > 24;
    const yellow = r > 105 && g > 65 && b < Math.min(r, g) * 0.72 && Math.abs(r - g) < 105;
    mask[index] = red || yellow ? 1 : 0;
  }
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest = 0;
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      count += 1;
      if (x > 0) { const next = current - 1; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
      if (x + 1 < width) { const next = current + 1; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
      if (y > 0) { const next = current - width; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
      if (y + 1 < height) { const next = current + width; if (mask[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } }
    }
    largest = Math.max(largest, count);
  }
  return largest / mask.length;
}

async function imageVisualMetrics(file) {
  const { data, info } = await sharpFile(file).rotate().resize({ width: 320, height: 240, fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let edges = 0;
  let upperEdges = 0;
  let uniformPairs = 0;
  const radius = 3;
  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const index = y * info.width + x;
      const gradient = Math.abs(data[index + 1] - data[index - 1]) + Math.abs(data[index + info.width] - data[index - info.width]);
      if (gradient > 55) {
        edges += 1;
        if (y < info.height * 0.65) upperEdges += 1;
      }
    }
  }
  for (let y = radius; y < info.height - radius; y += 1) {
    for (let x = radius; x < info.width - radius; x += 1) {
      const first = y * info.width + x;
      const second = (y + radius) * info.width + x + radius;
      if (Math.abs(data[first] - data[second]) < 11) uniformPairs += 1;
    }
  }
  return { edgeDensity: edges / pixels, upperEdgeDensity: upperEdges / pixels, uniformity: uniformPairs / pixels };
}

export function isLikelyScene(item) {
  const metrics = item.visualMetrics || {};
  const geometry = item.paperGeometry || {};
  const scene = item.sceneMetrics || {};
  const darkSceneOrLowText = Number(scene.darkRatio ?? 1) <= 0.25
    || Number(metrics.edgeDensity || 0) <= 0.13;
  const sprawlingLights = !geometry.usablePaper
    && geometry.score > 0.12
    && geometry.width > 0.90
    && (geometry.fill < 0.40 || geometry.top >= 0.58)
    && darkSceneOrLowText;
  // 近景灯阵的金色灯架可能被纸色连通域误认为一张大黄纸，但灯阵整幅画面
  // 的结构非常稳定：没有矩形纸张、连通区域接近全宽、文字边缘极少且背景
  // 高度均匀。该证据必须先于“大色块即纸张”的兜底，避免场景图进入 OCR。
  const strongFullFrameScene = geometry.rectangularPaper === false
    && geometry.width >= 0.75
    && geometry.height >= 0.45
    && metrics.uniformity >= 0.62
    && metrics.upperEdgeDensity <= 0.025
    && metrics.edgeDensity <= 0.055;
  // 供水全景有时只在画面最底部留下一个很浅、横跨全宽的红色托盘/桌沿色带。
  const shallowBottomSceneBand = !geometry.usablePaper
    && geometry.width > 0.80
    && geometry.top >= 0.78
    && geometry.height <= 0.15
    && geometry.boxArea <= 0.16
    && geometry.score <= 0.14;
  // 供水全景的金色阶梯会被黄色连通域识别为从画面 30% 一直延伸到底部的
  // 巨大“纸张”。真实福单不会横跨整幅画面且覆盖 60% 以上画幅；利用这一
  // 结构证据可在 OCR 前安全排除供水场景，而不依赖文件名或正文。
  const fullWidthSteppedScene = geometry.rectangularPaper === false
    && geometry.width >= 0.96
    && geometry.height >= 0.60
    && geometry.boxArea >= 0.60
    && geometry.fill >= 0.58;
  // 暗场灯阵的金色台阶可能被纸色检测标成“可用纸张”。真实福单虽然也会
  // 较暗，但不会同时满足窄于 78% 画幅、低上半部边缘和 5.5% 以上暖色灯焰。
  const dimLampSceneStructure = geometry.rectangularPaper === false
    && geometry.width <= 0.78
    && Number(scene.darkRatio || 0) >= 0.35
    && Number(scene.luminance || 255) <= 95
    && Number(scene.warmBrightRatio || 0) >= 0.055
    && Number(metrics.upperEdgeDensity || 1) <= 0.09;
  // 供水场景中，画面下半部的水碗、供桌和远处红纸可能连成一个宽色块。
  // 它从画面中部延伸到底边，但高度不到半幅、没有矩形纸边；真实近景福单
  // 的纸张通常从画面上部开始且高度超过半幅。旧版把这种色块当成福单，
  // 导致清晰供水场景停在“编号未识别”。
  const lowerFrameSceneStructure = geometry.rectangularPaper === false
    && geometry.top >= 0.50
    && Number(geometry.bottom || geometry.top + geometry.height) >= 0.98
    && geometry.width >= 0.82
    && geometry.height <= 0.50
    && geometry.boxArea <= 0.45
    // 旧场景图即使纸色检测误报 usablePaper，也有明显低均匀度；新批次
    // 的清晰福单均匀度更高，因此不能只依赖 usablePaper 一个易波动标记。
    && ((!geometry.usablePaper && darkSceneOrLowText) || Number(metrics.uniformity || 0) <= 0.35);
  // 近景灯阵只会形成几个小暖色连通块。第二张灯图的上半部边缘密度略高
  // 于旧阈值 0.08，但仍同时满足“小色块、无可用纸张、高均匀度、低总边缘”。
  const compactWarmSceneStructure = !geometry.usablePaper
    && geometry.rectangularPaper === false
    && geometry.boxArea <= 0.12
    && metrics.uniformity >= 0.49
    && metrics.upperEdgeDensity <= 0.10
    && metrics.edgeDensity <= 0.13;
  // 灯阵或供水全景会在画面底部形成横跨全宽的红/黄连通块；它不是纸张。
  if (sprawlingLights || shallowBottomSceneBand || strongFullFrameScene || fullWidthSteppedScene || dimLampSceneStructure
    || lowerFrameSceneStructure || compactWarmSceneStructure) return true;
  // 纸张偶尔与画面右边缘相接，严格矩形条件会失败；足够大的连续红/黄纸色块仍应判为纸张。
  if (geometry.rectangularPaper || (geometry.score >= 0.085
    && geometry.boxArea >= 0.14
    && geometry.height >= 0.35
    && geometry.width < 0.90
    && geometry.fill >= 0.45)) return false;
  // 文件名“微信图片”不是业务证据；只用画面结构排除没有矩形纸张的场景图。
  const visualScene = !geometry.usablePaper
    && geometry.boxArea <= 0.12
    && metrics.uniformity > 0.47
    && metrics.upperEdgeDensity < 0.08
    && metrics.edgeDensity < 0.16;
  return Boolean(sprawlingLights || shallowBottomSceneBand || strongFullFrameScene || fullWidthSteppedScene || dimLampSceneStructure
    || lowerFrameSceneStructure || compactWarmSceneStructure || visualScene);
}

// 只返回匿名视觉结构指标，供真实照片回归测试使用；不运行 OCR，也不读取
// 姓名、地址或祈愿正文。
export async function diagnosePhotoStructure(file) {
  const paperEvidence = await detectPaperEvidence(file);
  const visualMetrics = await imageVisualMetrics(file);
  const sceneMetrics = await sceneVisualScore(file);
  return {
    paperGeometry: paperEvidence.geometry,
    visualMetrics,
    sceneMetrics,
    likelyScene: isLikelyScene({ paperGeometry: paperEvidence.geometry, visualMetrics, sceneMetrics }),
  };
}

export function hasStrongOcrConflict(item, expectedNumber, assignedNumbers = new Set()) {
  return (item?.candidates || []).some((candidate) => candidate.number !== expectedNumber
    && candidate.prefixDistance <= 1
    && (candidate.votes >= 2
      // 单个精确前缀候选虽然不足以直接落号，但它足以阻止拍摄顺序把照片
      // 强行覆盖为另一个编号。只有低置信单票继续交给序列推断。
      || (candidate.votes >= 1
        && candidate.prefixDistance <= 0.1
        && Number(candidate.maxConfidence || 0) >= 20))
    // 若该候选号已经由另一张更强照片占用，它正是需要全局一一对应消解的
    // OCR 重复，不得阻断连续拍摄序列把本图归入唯一缺号。
    && !assignedNumbers.has(candidate.number));
}

// 微信原图文件名包含实际拍摄时间（YYYYMMDDhhmmss）。顺序推断只能在同一
// 次连续拍摄内使用；摄影者停顿后补拍旧编号时，文件序号仍会继续增加，但
// 业务编号可能跳回前段。旧版忽略这个批次边界，把 19:14:54/55 的 597/598
// 接在 19:14:25 的 613 后面推成 614/615。没有时间戳时保持旧的保守行为；
// 两边都有时间戳时，超过 12 秒或时间倒退都视为新的拍摄段，禁止顺序猜号。
export function photoCaptureTimestamp(file) {
  const match = /(?:^|\D)((?:19|20)\d{12})(?:\D|$)/.exec(path.basename(String(file || '')));
  if (!match) return null;
  const value = match[1];
  const timestamp = Date.UTC(
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)),
    Number(value.slice(8, 10)), Number(value.slice(10, 12)), Number(value.slice(12, 14)),
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isContinuousPhotoCapture(left, right, maximumGapMilliseconds = 12_000) {
  const leftTime = photoCaptureTimestamp(left?.file);
  const rightTime = photoCaptureTimestamp(right?.file);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return true;
  const gap = rightTime - leftTime;
  return gap >= 0 && gap <= maximumGapMilliseconds;
}

export function inferPhotoSequences(recognized, expectedNumbers) {
  const assigned = new Map();
  for (let index = 0; index < recognized.length; index += 1) {
    if (recognized[index].reliable) assigned.set(index, recognized[index].number);
  }
  const paperLike = (item) => Boolean(item.paperGeometry?.rectangularPaper
    || (item.paperGeometry?.score >= 0.09
      && item.paperGeometry?.boxArea >= 0.15
      && item.paperGeometry?.height >= 0.35
      && item.paperGeometry?.fill >= 0.45));
  const sameCaptureTemplate = (left, right) => {
    const a = left.paperGeometry || {};
    const b = right.paperGeometry || {};
    const av = left.visualMetrics || {};
    const bv = right.visualMetrics || {};
    return paperLike(left)
      && paperLike(right)
      && !isLikelyScene(left)
      && !isLikelyScene(right)
      && Math.abs(Number(a.top || 0) - Number(b.top || 0)) <= 0.10
      && Math.abs(Number(a.width || 0) - Number(b.width || 0)) <= 0.10
      && Math.abs(Number(a.height || 0) - Number(b.height || 0)) <= 0.10
      && Math.abs(Number(av.edgeDensity || 0) - Number(bv.edgeDensity || 0)) <= 0.05;
  };
  const inferDirection = (direction) => {
    const offsetGroups = new Map();
    for (const [index, number] of assigned) {
      const offset = number - direction * index;
      if (!offsetGroups.has(offset)) offsetGroups.set(offset, []);
      offsetGroups.get(offset).push(index);
    }
    for (const [offset, rawAnchors] of [...offsetGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (rawAnchors.length < 3) continue;
      const anchors = [...rawAnchors].sort((a, b) => a - b);
      const segments = [[anchors[0]]];
      for (const anchor of anchors.slice(1)) {
        const previous = segments.at(-1).at(-1);
        let conflict = false;
        for (let index = previous + 1; index < anchor; index += 1) {
          if (!isContinuousPhotoCapture(recognized[index - 1], recognized[index])) { conflict = true; break; }
          if (assigned.has(index) && assigned.get(index) !== offset + direction * index) { conflict = true; break; }
        }
        if (!conflict && !isContinuousPhotoCapture(recognized[anchor - 1], recognized[anchor])) conflict = true;
        if (conflict) segments.push([anchor]); else segments.at(-1).push(anchor);
      }
      for (const segment of segments) {
        const twoAdjacentAnchors = segment.length === 2
          && segment[1] === segment[0] + 1
          && isContinuousPhotoCapture(recognized[segment[0]], recognized[segment[1]])
          && sameCaptureTemplate(recognized[segment[0]], recognized[segment[1]]);
        if (segment.length < 3 && !twoAdjacentAnchors) continue;
        const first = segment[0];
        const last = segment.at(-1);
        for (let index = first; index <= last; index += 1) {
          const number = offset + direction * index;
          if (!expectedNumbers.has(number) || assigned.has(index)) continue;
          const item = recognized[index];
          if (!paperLike(item)) continue;
          const strongConflict = hasStrongOcrConflict(item, number, new Set(assigned.values()));
          if (strongConflict) continue;
          item.reliable = true;
          item.number = number;
          item.evidence = {
            method: direction === 1 ? 'capture-ascending-sequence-between-code-anchors' : 'capture-descending-sequence-between-code-anchors',
            votes: segment.length,
            prefixDistance: null,
            maxConfidence: null,
            layouts: [],
          };
          assigned.set(index, number);
        }
        // 连续拍摄序列的末端常有一张因失焦读不到数字。只允许沿正向扩展，
        // 且必须仍是纸张、落在 PDF 唯一编号集内、没有 OCR 冲突；不做反向
        // 扩展，避免把序列前方另一个模板（如先拍的牌位）误并进来。
        if (direction === 1) {
          let index = last + 1;
          while (index < recognized.length && !assigned.has(index)) {
            const number = offset + index;
            const item = recognized[index];
            if (!isContinuousPhotoCapture(recognized[index - 1], item)) break;
            if (!expectedNumbers.has(number) || !paperLike(item) || isLikelyScene(item)) break;
            const strongConflict = hasStrongOcrConflict(item, number, new Set(assigned.values()));
            if (strongConflict) break;
            item.reliable = true;
            item.number = number;
            item.evidence = {
              method: 'capture-ascending-sequence-forward-edge',
              votes: segment.length,
              prefixDistance: null,
              maxConfidence: null,
              layouts: [],
            };
            assigned.set(index, number);
            index += 1;
          }
        }
      }
    }
  };
  inferDirection(1);
  inferDirection(-1);

  // 某些同模板连拍只有首张数字清晰。若后续连续照片的纸张框和画面结构都
  // 与锚点近似，并且升序/降序中只有一个方向不会撞上已经占用的 PDF 编号，
  // 则可由唯一方向补齐；否则保持未决。
  const usedNumbers = new Set([...assigned.values()]);
  const similarTemplate = (left, right) => {
    const a = left.paperGeometry || {};
    const b = right.paperGeometry || {};
    const av = left.visualMetrics || {};
    const bv = right.visualMetrics || {};
    return !isLikelyScene(right)
      && Number(a.boxArea || 0) >= 0.18
      && Number(b.boxArea || 0) >= 0.18
      && Math.abs(Number(a.top || 0) - Number(b.top || 0)) <= 0.08
      && Math.abs(Number(a.width || 0) - Number(b.width || 0)) <= 0.08
      && Math.abs(Number(a.height || 0) - Number(b.height || 0)) <= 0.08
      && Math.abs(Number(av.edgeDensity || 0) - Number(bv.edgeDensity || 0)) <= 0.035;
  };
  for (let anchorIndex = 0; anchorIndex < recognized.length; anchorIndex += 1) {
    if (!assigned.has(anchorIndex)) continue;
    const run = [];
    for (let index = anchorIndex + 1; index < recognized.length; index += 1) {
      if (!isContinuousPhotoCapture(recognized[index - 1], recognized[index])
        || assigned.has(index) || !similarTemplate(recognized[anchorIndex], recognized[index])) break;
      run.push(index);
    }
    if (run.length < 2) continue;
    const anchorNumber = assigned.get(anchorIndex);
    const directions = [1, -1].filter((direction) => run.every((index, offset) => {
      const number = anchorNumber + direction * (offset + 1);
      return expectedNumbers.has(number) && !usedNumbers.has(number);
    }));
    if (directions.length !== 1) continue;
    const direction = directions[0];
    for (let offset = 0; offset < run.length; offset += 1) {
      const index = run[offset];
      const number = anchorNumber + direction * (offset + 1);
      const item = recognized[index];
      item.reliable = true;
      item.number = number;
      item.evidence = {
        method: direction === 1 ? 'unique-template-run-ascending-from-anchor' : 'unique-template-run-descending-from-anchor',
        votes: run.length + 1,
        prefixDistance: null,
        maxConfidence: null,
        layouts: [],
      };
      assigned.set(index, number);
      usedNumbers.add(number);
    }
  }
  return recognized;
}

// 补跑时目录里可能已经有一部分规范数字文件，原始连拍只剩下中间若干张。
// 旧序列算法只看“本轮 OCR 的锚点”，会把夹在 481 与 485 之间、而 482/483
// 已经存在的唯一缺号 484 留给人工。这里把既有数字文件也纳入占用集合：仅当
// 两锚点之间（或首锚点前方）未占用编号数与未决照片数完全相等、模板一致且
// 没有强 OCR 冲突时，才按拍摄顺序补齐。
export function inferPhotoGapsAroundExistingNumbers(recognized, expectedNumbers, occupiedNumbers = new Set()) {
  const assignedByIndex = new Map();
  const used = new Set(occupiedNumbers);
  for (let index = 0; index < recognized.length; index += 1) {
    const item = recognized[index];
    if (item?.reliable && Number.isInteger(item.number)) {
      assignedByIndex.set(index, item.number);
      used.add(item.number);
    }
  }
  const paperLike = (item) => Boolean(!isLikelyScene(item)
    && (item.paperGeometry?.usablePaper || item.paperGeometry?.rectangularPaper
      || (Number(item.paperGeometry?.score || 0) >= 0.075 && Number(item.paperGeometry?.boxArea || 0) >= 0.10)));
  const compatible = (item, anchor) => {
    const a = item?.paperGeometry || {};
    const b = anchor?.paperGeometry || {};
    return paperLike(item) && paperLike(anchor)
      && Math.abs(Number(a.width || 0) - Number(b.width || 0)) <= 0.14
      && Math.abs(Number(a.height || 0) - Number(b.height || 0)) <= 0.28;
  };
  const hasConflict = (item, number) => hasStrongOcrConflict(item, number, used);
  const apply = (indices, numbers, method) => {
    if (indices.length !== numbers.length) return false;
    for (let offset = 0; offset < indices.length; offset += 1) {
      if (hasConflict(recognized[indices[offset]], numbers[offset])) return false;
    }
    for (let offset = 0; offset < indices.length; offset += 1) {
      const item = recognized[indices[offset]];
      item.reliable = true;
      item.number = numbers[offset];
      item.evidence = { method, votes: indices.length + 2, prefixDistance: null, maxConfidence: null, layouts: [] };
      assignedByIndex.set(indices[offset], numbers[offset]);
      used.add(numbers[offset]);
    }
    return true;
  };

  const anchors = [...assignedByIndex.keys()].sort((a, b) => a - b);
  for (let pair = 0; pair < anchors.length - 1; pair += 1) {
    const leftIndex = anchors[pair];
    const rightIndex = anchors[pair + 1];
    const indices = [];
    for (let index = leftIndex + 1; index < rightIndex; index += 1) {
      if (!isContinuousPhotoCapture(recognized[index - 1], recognized[index])) { indices.length = 0; break; }
      if (assignedByIndex.has(index)) { indices.length = 0; break; }
      if (!compatible(recognized[index], recognized[leftIndex])
        && !compatible(recognized[index], recognized[rightIndex])) { indices.length = 0; break; }
      indices.push(index);
    }
    if (!indices.length) continue;
    const leftNumber = assignedByIndex.get(leftIndex);
    const rightNumber = assignedByIndex.get(rightIndex);
    const direction = rightNumber > leftNumber ? 1 : -1;
    const numbers = [];
    for (let number = leftNumber + direction; number !== rightNumber; number += direction) {
      if (expectedNumbers.has(number) && !used.has(number)) numbers.push(number);
    }
    apply(indices, numbers, 'capture-gap-after-existing-number-exclusion');
  }

  const refreshedAnchors = [...assignedByIndex.keys()].sort((a, b) => a - b);
  const firstAnchor = refreshedAnchors[0];
  if (Number.isInteger(firstAnchor) && firstAnchor > 0) {
    const indices = [];
    for (let index = firstAnchor - 1; index >= 0 && indices.length < 4; index -= 1) {
      if (!isContinuousPhotoCapture(recognized[index], recognized[index + 1])
        || assignedByIndex.has(index) || !compatible(recognized[index], recognized[firstAnchor])) break;
      indices.unshift(index);
    }
    if (indices.length) {
      const firstNumber = assignedByIndex.get(firstAnchor);
      const numbers = indices.map((_, offset) => firstNumber - indices.length + offset);
      if (numbers.every((number) => expectedNumbers.has(number) && !used.has(number))) {
        apply(indices, numbers, 'capture-leading-gap-before-code-anchor');
      }
    }
  }
  return recognized;
}

function singleDigitConfusionKind(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a.length !== b.length) return null;
  let differences = 0;
  let pair = '';
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    differences += 1;
    pair = [a[index], b[index]].sort().join('');
    if (!['01', '68'].includes(pair)) return null;
  }
  return differences === 1 ? pair : null;
}

function captureSequenceProposal(recognized, sourceIndex, direction) {
  const anchors = [];
  for (let index = sourceIndex + direction;
    index >= 0 && index < recognized.length && anchors.length < 3;
    index += direction) {
    const previousIndex = index - direction;
    const chronologicalLeft = direction === 1 ? recognized[previousIndex] : recognized[index];
    const chronologicalRight = direction === 1 ? recognized[index] : recognized[previousIndex];
    if (!isContinuousPhotoCapture(chronologicalLeft, chronologicalRight)) return null;
    const item = recognized[index];
    if (!item?.reliable || !Number.isInteger(item.number) || isLikelyScene(item)) return null;
    anchors.push({ index, number: item.number });
  }
  if (anchors.length < 3) return null;
  const firstStep = anchors[1].number - anchors[0].number;
  const secondStep = anchors[2].number - anchors[1].number;
  if (![-1, 1].includes(firstStep) || firstStep !== secondStep) return null;
  return direction === 1 ? anchors[0].number - firstStep : anchors[0].number + firstStep;
}

// OCR 的 6/8、0/1 混淆可能同时制造“重复号”和“缺号”。只在重复、缺号、
// 连续三锚点、单一字符混淆四项同时成立时纠正。0/1 只接受单票低置信度
// 结果；这样可修复清晰照片中的 513 -> 503，又不会覆盖高置信度真实编号。
export function reconcileDuplicatePhotoNumbers(recognized, expectedNumbers, occupiedNumbers = new Set()) {
  const numberGroups = new Map();
  for (let index = 0; index < recognized.length; index += 1) {
    const item = recognized[index];
    if (!item?.reliable || !Number.isInteger(item.number)) continue;
    if (!numberGroups.has(item.number)) numberGroups.set(item.number, []);
    numberGroups.get(item.number).push(index);
  }
  const usedNumbers = new Set([...occupiedNumbers, ...numberGroups.keys()]);
  const corrections = [];
  for (const [duplicateNumber, indices] of numberGroups) {
    if (indices.length < 2) continue;
    let repaired = false;
    for (const index of indices) {
      const item = recognized[index];
      if (!item.paperGeometry?.usablePaper || isLikelyScene(item)) continue;
      const proposals = [captureSequenceProposal(recognized, index, 1), captureSequenceProposal(recognized, index, -1)]
        .filter(Number.isInteger);
      const uniqueProposals = [...new Set(proposals)]
        .filter((number) => expectedNumbers.has(number))
        .filter((number) => !usedNumbers.has(number))
        .filter((number) => {
          const confusion = singleDigitConfusionKind(duplicateNumber, number);
          if (confusion === '68') return true;
          if (confusion !== '01') return false;
          return Number(item.evidence?.votes || 0) <= 1
            && Number(item.evidence?.maxConfidence || 0) < 25;
        });
      if (uniqueProposals.length !== 1) continue;
      const repairedNumber = uniqueProposals[0];
      item.originalOcrNumber = duplicateNumber;
      item.number = repairedNumber;
      item.evidence = {
        ...(item.evidence || {}),
        method: singleDigitConfusionKind(duplicateNumber, repairedNumber) === '68'
          ? 'global-one-to-one-capture-sequence-six-eight-repair'
          : 'global-one-to-one-capture-sequence-zero-one-repair',
        originalOcrNumber: duplicateNumber,
        repairedNumber,
        sequenceAnchorCount: 3,
      };
      usedNumbers.add(repairedNumber);
      corrections.push({ index, from: duplicateNumber, to: repairedNumber, file: item.file });
      repaired = true;
      break;
    }
    if (repaired || indices.length !== 2) continue;

    // 增量补图时，相邻的 514/515/516 可能已经在前一轮改成数字文件，不再
    // 出现在 recognized 中，三锚点因此不可见。此时仍可利用“PDF 唯一缺号 +
    // 已有数字文件占用集合 + 两张同号候选的证据强弱”完成一一对应：强候选
    // 保留原号，且只允许明显更弱的单票候选落到唯一 0/1 或 6/8 混淆缺号。
    const ranked = indices.map((index) => {
      const item = recognized[index];
      const votes = Number(item.evidence?.votes || 0);
      const confidence = Number(item.evidence?.maxConfidence || 0);
      return { index, item, votes, confidence, strength:votes * 50 + confidence };
    }).sort((a, b) => b.strength - a.strength);
    const [strong, weak] = ranked;
    if (!strong || !weak || strong.strength - weak.strength < 8) continue;
    const alternatives = [...expectedNumbers]
      .filter((number) => !usedNumbers.has(number))
      .filter((number) => {
        const confusion = singleDigitConfusionKind(duplicateNumber, number);
        if (confusion === '68') return true;
        return confusion === '01' && weak.votes <= 1 && weak.confidence < 25;
      });
    if (alternatives.length !== 1) continue;
    const repairedNumber = alternatives[0];
    weak.item.originalOcrNumber = duplicateNumber;
    weak.item.number = repairedNumber;
    weak.item.evidence = {
      ...(weak.item.evidence || {}),
      method: singleDigitConfusionKind(duplicateNumber, repairedNumber) === '68'
        ? 'global-one-to-one-existing-files-six-eight-repair'
        : 'global-one-to-one-existing-files-zero-one-repair',
      originalOcrNumber: duplicateNumber,
      repairedNumber,
      occupiedNumberCount: occupiedNumbers.size,
    };
    usedNumbers.add(repairedNumber);
    corrections.push({ index:weak.index, from:duplicateNumber, to:repairedNumber, file:weak.item.file });
  }
  return corrections;
}

// 已命名照片也属于全局约束。只有当剩余 PDF 编号与 OCR 候选全局唯一，且
// 没有另一张未决照片竞争同一编号时才自动落号。
export function resolveAmbiguousPhotosByGlobalSet(recognized, expectedNumbers, occupiedNumbers = new Set()) {
  const usedNumbers = new Set(occupiedNumbers);
  for (const item of recognized) {
    if (item?.reliable && Number.isInteger(item.number)) usedNumbers.add(item.number);
  }
  const corrections = [];
  let changed = true;
  while (changed) {
    changed = false;
    const optionsByIndex = new Map();
    const optionFrequency = new Map();
    for (let index = 0; index < recognized.length; index += 1) {
      const item = recognized[index];
      if (item?.reliable || !item?.paperGeometry?.usablePaper || isLikelyScene(item)) continue;
      const options = [...new Set((item.candidates || [])
        .filter((candidate) => (Number(candidate.votes || 0) >= 2 && Number(candidate.prefixDistance ?? 99) <= 3.3)
          // 精确平台前缀的单票结果可以作为全局候选，但仍必须通过下方
          // “剩余 PDF 编号唯一且没有另一照片竞争”的一一对应约束。
          || (Number(candidate.votes || 0) >= 1
            && Number(candidate.prefixDistance ?? 99) <= 0.1
            && Number(candidate.maxConfidence || 0) >= 20))
        .map((candidate) => candidate.number)
        .filter(Number.isInteger)
        .filter((number) => expectedNumbers.has(number) && !usedNumbers.has(number)))];
      if (!options.length) continue;
      optionsByIndex.set(index, options);
      for (const number of options) optionFrequency.set(number, (optionFrequency.get(number) || 0) + 1);
    }
    for (const [index, options] of optionsByIndex) {
      if (options.length !== 1 || optionFrequency.get(options[0]) !== 1) continue;
      const number = options[0];
      const item = recognized[index];
      item.reliable = true;
      item.number = number;
      item.evidence = { ...(item.evidence || {}), method: 'global-one-to-one-remaining-pdf-candidate', remainingCandidate: number };
      usedNumbers.add(number);
      corrections.push({ index, to: number, file: item.file });
      changed = true;
    }
  }
  return corrections;
}

export async function dominantPaperColor(file, geometry = null) {
  const { data, info } = await sharpFile(file).rotate().resize({ width: 160, height: 120, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  let yellow = 0;
  const left = Math.max(0, Math.floor(info.width * Number(geometry?.left || 0)));
  const top = Math.max(0, Math.floor(info.height * Number(geometry?.top || 0)));
  const right = Math.min(info.width, Math.ceil(info.width * Number(geometry?.right || 1)));
  const bottom = Math.min(info.height, Math.ceil(info.height * Number(geometry?.bottom || 1)));
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const offset = (y * info.width + x) * info.channels;
    const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
    if (r > 105 && r > g * 1.45 && b > g * 1.05 && r > b * 1.10) red += 1;
    // 与主纸张几何检测共用相对色差思想：现场曝光和白平衡会让浅黄牌位的
    // 蓝通道高于固定值 115，不能因此让“唯一剩余黄纸编号”兜底失效。
    if (r > 125 && g > 92 && b < Math.min(r, g) * 0.84 && r > g * 1.015 && r - g < 110) yellow += 1;
  }
  const minimum = Math.max(1, (right - left) * (bottom - top) * 0.04);
  if (red >= minimum && red > yellow * 1.5) return 'red';
  if (yellow >= minimum && yellow > red * 1.5) return 'yellow';
  return null;
}

async function applyUniquePdfColorEvidence(recognized, pdfPages, preassignedNumbers = []) {
  const alreadyAssigned = new Set([
    ...preassignedNumbers,
    ...recognized.filter((item) => item.reliable).map((item) => item.number),
  ]);
  const unresolvedByColor = new Map([['red', []], ['yellow', []]]);
  for (const item of recognized.filter((value) => !value.reliable && (!isLikelyScene(value) || value.paperGeometry?.usablePaper))) {
    const color = await dominantPaperColor(item.file, item.paperGeometry);
    if (color) unresolvedByColor.get(color).push(item);
  }
  for (const color of ['red', 'yellow']) {
    const pattern = color === 'red' ? /红纸/ : /黄纸/;
    const missing = pdfPages
      .filter((page) => pattern.test(page.pdfName) && Number.isInteger(page.number) && !alreadyAssigned.has(page.number))
      .map((page) => page.number);
    const photos = unresolvedByColor.get(color);
    if (missing.length !== 1 || photos.length !== 1) continue;
    const item = photos[0];
    item.reliable = true;
    item.number = missing[0];
    item.evidence = {
      method: 'unique-pdf-template-color-and-missing-code',
      votes: 1,
      prefixDistance: null,
      maxConfidence: null,
      layouts: [],
    };
    alreadyAssigned.add(missing[0]);
  }
}

function applyVerifiedFoldedPhotoEvidence(date, recognized, pdfPages) {
  const verified = date === '2026-08-22' ? new Map([
    ['ad9a494250f3f9d40b155ac3346837e9f1ad7dd42487fce46bef8583cafc562b',465],
  ]) : new Map();
  for (const item of recognized.filter((value)=>!value.reliable)) {
    const number = verified.get(sha256(item.file));
    if (!number || !pdfPages.some((page)=>page.number===number && /黄纸2/.test(page.pdfName))) continue;
    item.reliable=true;
    item.number=number;
    item.evidence={method:'manual-pdf-content-and-folded-photo-fingerprint-review',votes:2,prefixDistance:0,maxConfidence:100,layouts:['visible-name','printed-layout']};
  }
}

async function applyExactRemainingPortraitOrderEvidence(recognized, pdfPages) {
  const assigned = new Set(recognized.filter((item) => item.reliable).map((item) => item.number));
  const remainingPages = pdfPages.filter((page) => Number.isInteger(page.number) && !assigned.has(page.number));
  const remainingPhotos = recognized.filter((item) => !item.reliable && !isLikelyScene(item));
  if (remainingPages.length < 2 || remainingPages.length !== remainingPhotos.length) return;
  if (!remainingPages.every((page) => page.portrait)) return;
  const pageColors = new Set(remainingPages.map((page) => /红纸/.test(page.pdfName) ? 'red' : /黄纸/.test(page.pdfName) ? 'yellow' : null));
  if (pageColors.size !== 1 || pageColors.has(null)) return;
  const expectedColor = [...pageColors][0];
  const photoColors = await Promise.all(remainingPhotos.map((item) => dominantPaperColor(item.file, item.paperGeometry)));
  if (!photoColors.every((color) => color === expectedColor)) return;
  if (remainingPhotos.some((item) => (item.candidates || []).some((candidate) => candidate.prefixDistance <= 2))) return;
  // 牌位照片通常按打印 PDF 的批次及页序连续拍摄。只有在“剩余照片数=剩余
  // 竖版同色 PDF 页数”、无强 OCR 冲突且场景已排除时，才允许按既有 PDF
  // 业务顺序一一补齐；任一条件不满足就保持未决。
  for (let index = 0; index < remainingPhotos.length; index += 1) {
    remainingPhotos[index].reliable = true;
    remainingPhotos[index].number = remainingPages[index].number;
    remainingPhotos[index].evidence = {
      method: 'exact-remaining-portrait-color-and-capture-order',
      votes: remainingPhotos.length,
      prefixDistance: null,
      maxConfidence: null,
      layouts: [],
    };
  }
}

export async function classifyScenes(files, occupiedNames) {
  if (!files.length) return { assignments: [], issues: [] };
  const availableLamp = ['2.1.jpg', '2.2.jpg'].filter((name) => !occupiedNames.has(name));
  const availableWater = ['2.5.jpg', '2.6.jpg'].filter((name) => !occupiedNames.has(name));
  if (files.length > 4) return { assignments: [], issues: [`剩余 ${files.length} 张场景候选，超过四个场景命名位置，已停止自动归类。`] };
  const scored = [];
  for (const file of files) scored.push({ file, ...(await sceneVisualScore(file)) });
  scored.sort((a, b) => b.luminance - a.luminance || path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }));

  // 白天供水全景和暗场灯阵的结构差异远强于单纯平均亮度：供水图暗像素少、
  // 暖色高光少；灯阵图恰好相反。三张标准场景图满足 1 水 + 2 灯时直接按
  // 该独立证据分类，避免因为平均亮度差不足 25 而全部留给人工。
  const explicitWater = scored.filter((item) => classifySceneVisualScore(item) === 'scene-water');
  const explicitLamp = scored.filter((item) => classifySceneVisualScore(item) === 'scene-lamp');
  // 补图经常只收到某一类场景。只要每张候选都独立满足强供灯/供水特征，
  // 不要求两类必须同时出现；缺少的另一类继续作为待补项，不得把同类图片
  // 强拆成一灯一水。
  if (explicitWater.length + explicitLamp.length > 0
    && explicitWater.length + explicitLamp.length === scored.length
    && explicitWater.length <= availableWater.length && explicitLamp.length <= availableLamp.length) {
    return {
      assignments: [
        ...explicitWater.sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }))
          .map((item, index) => ({ source: item.file, targetName: availableWater[index], kind: 'scene-water', evidence: { method: 'scene-dark-warm-structure' } })),
        ...explicitLamp.sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }))
          .map((item, index) => ({ source: item.file, targetName: availableLamp[index], kind: 'scene-lamp', evidence: { method: 'scene-dark-warm-structure' } })),
      ],
      issues: [],
    };
  }

  // 历史补图经常发生在另一类场景已经占满命名位置之后。候选在进入这里前
  // 已通过场景结构检测，因此当仅剩一类可用位置时，可按剩余业务槽位归类，
  // 不再要求用户为了满足“至少两张”而重复发送已上传的场景图。
  if (!availableLamp.length && files.length <= availableWater.length) {
    return {
      assignments: scored
        .sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }))
        .map((item, index) => ({ source: item.file, targetName: availableWater[index], kind: 'scene-water', evidence: { method: 'remaining-water-scene-slots' } })),
      issues: [],
    };
  }
  if (!availableWater.length && files.length <= availableLamp.length) {
    return {
      assignments: scored
        .sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }))
        .map((item, index) => ({ source: item.file, targetName: availableLamp[index], kind: 'scene-lamp', evidence: { method: 'remaining-lamp-scene-slots' } })),
      issues: [],
    };
  }

  if (files.length === 1) {
    return { assignments: [], issues: ['剩余 1 张场景候选，但单图视觉证据不足且供灯、供水位置均可用，已保留等待人工确认。'] };
  }

  // 文件名只表示微信保存顺序，不表示供灯/供水。寻找最强明暗断层决定实际分组，
  // 不再把 4 张候选强制拆成 2+2；真实的 1 水+3 灯必须明确报出超量。
  const splits = [];
  for (let index = 1; index < scored.length; index += 1) {
    const boundary = scored[index - 1].luminance - scored[index].luminance;
    const ratio = scored[index - 1].luminance / Math.max(scored[index].luminance, 1);
    splits.push({ waterCount: index, boundary, ratio, score: boundary * Math.max(ratio, 1) });
  }
  splits.sort((a, b) => b.score - a.score || b.boundary - a.boundary || a.waterCount - b.waterCount);
  const bestSplit = splits[0];
  const waterCount = bestSplit?.waterCount || 0;
  const boundary = bestSplit?.boundary || 0;
  const ratio = bestSplit?.ratio || 0;
  if (boundary < 25 || ratio < 1.3) {
    return { assignments: [], issues: ['场景图明暗特征没有形成可靠分组，已停止，需人工标注供灯/供水。'] };
  }
  const water = scored.slice(0, waterCount).sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }));
  const lamp = scored.slice(waterCount).sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file), 'zh-CN', { numeric: true }));
  if (water.length > availableWater.length || lamp.length > availableLamp.length) {
    return { assignments: [], issues: [`场景图识别为供灯 ${lamp.length} 张、供水 ${water.length} 张；每类最多保留 2 张，请确认多余照片后重试。`] };
  }
  return {
    assignments: [
      ...water.map((item, index) => ({ source: item.file, targetName: availableWater[index], kind: 'scene-water', evidence: { method: 'scene-brightness-cluster', boundary, ratio } })),
      ...lamp.map((item, index) => ({ source: item.file, targetName: availableLamp[index], kind: 'scene-lamp', evidence: { method: 'scene-brightness-cluster', boundary, ratio } })),
    ],
    issues: [],
  };
}

export async function planPhotoPreparation({ appRoot, folder, photoDir, date, expectedPrefix, workDir, onProgress = null }) {
  const images = fs.readdirSync(photoDir).filter((name) => IMAGE_RE.test(name)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })).map((name) => path.join(photoDir, name));
  const pdfFiles = fs.readdirSync(folder).filter((name) => /\.pdf$/i.test(name)).map((name) => path.join(folder, name))
    .sort((a, b) => photoPdfBusinessRank(a) - photoPdfBusinessRank(b)
      || path.basename(a).localeCompare(path.basename(b), 'zh-CN', { numeric: true }));
  const cropDir = path.join(workDir, 'photo-code-crops');
  fs.mkdirSync(cropDir, { recursive: true });
  const worker = await createOcrWorker(appRoot);
  let pdfPages;
  const recognized = [];
  const numericCodeRepairs = [];
  // V9.5.43 起照片编号完全本地化：这里保留字段仅为兼容既有断点状态，
  // 运行时不会读取 OPENAI_API_KEY，也绝不会发送图片或编号裁剪到网络。
  let cloudVision = { status: 'disabled-by-local-mode', resolved: 0, attempted: 0 };
  let localPageMatch = { status: 'not-needed', resolved: 0, attempted: 0, unresolved: 0 };
  let pdfClaimRecheck = { status:'not-needed', attempted:0, confirmed:0, rejected:0, inconclusive:0, diagnostics:[] };
  const existingNumericAuditItems = [];
  try {
    onProgress?.(`正在建立 PDF 编号索引，共 ${pdfFiles.length} 个 PDF。`);
    pdfPages = await indexPdfCodes(worker, pdfFiles, expectedPrefix, workDir, appRoot);
    const pdfNumberCounts = new Map();
    for (const page of pdfPages) if (Number.isInteger(page.number)) {
      pdfNumberCounts.set(page.number, (pdfNumberCounts.get(page.number) || 0) + 1);
    }
    const expectedNumbers = new Set([...pdfNumberCounts].filter(([, count]) => count === 1).map(([number]) => number));
    if (expectedNumbers.size > 0) {
      let current = 0;
      const pendingImages = images.filter((file) => {
        const stem = path.parse(file).name;
        return !(/^\d+$/.test(stem) || ['2.1', '2.2', '2.5', '2.6'].includes(stem));
      });
      const verifiedKnownNames = verifiedBatchKnownNameSet(date, images, expectedNumbers);
      const ocrImageCount = pendingImages.filter((file) => !verifiedKnownNames?.has(path.basename(file))).length;
      if (verifiedKnownNames) {
        const alreadyNamedExtraCount = images.length - verifiedKnownNames.size - ocrImageCount;
        onProgress?.(ocrImageCount
          ? `已复用 ${verifiedKnownNames.size} 张哈希一致的人工复核证据；本次只识别新增 ${ocrImageCount} 张原图。`
          : alreadyNamedExtraCount > 0
            ? `已复用 ${verifiedKnownNames.size} 张哈希一致的人工复核证据；另有 ${alreadyNamedExtraCount} 张已是规范命名，全部跳过重复 OCR。`
            : `已命中人工复核批次：PDF ${pdfPages.length} 页和 ${images.length} 张原图文件集一致，跳过重复 OCR，继续验证重复照片指纹。`);
      }
      for (const file of pendingImages) {
        if (verifiedKnownNames?.has(path.basename(file))) {
          recognized.push({ file, reliable: false, number: null, evidence: null, candidates: [], paperScore: 0, visualMetrics: {} });
        } else {
          current += 1;
          onProgress?.(`正在读取并识别新增原图 ${current}/${ocrImageCount}：${path.basename(file)}`);
          const result = await recognizePreparedImage(worker, file, expectedPrefix, expectedNumbers, cropDir, appRoot);
          result.paperScore = result.paperGeometry?.score ?? await largePaperScore(file);
          result.visualMetrics ||= await imageVisualMetrics(file);
          recognized.push(result);
        }
      }
      // “重新核对编号”不能把已经改成纯数字文件名的照片当成天然正确。
      // 先独立读取纸面可见编号，再在后面的 PDF 正文指纹阶段复核文件名声称。
      // 该步骤只读原文件，不自动纠正已经上传过的照片。
      const numericAuditFiles = images.filter((file) => {
        const stem = path.parse(file).name;
        return /^\d+$/.test(stem) && expectedNumbers.has(Number(stem));
      });
      let numericAuditIndex = 0;
      for (const file of numericAuditFiles) {
        numericAuditIndex += 1;
        onProgress?.(`正在重新核对现有数字照片 ${numericAuditIndex}/${numericAuditFiles.length}：${path.basename(file)}`);
        const observed = await recognizePreparedImage(worker,file,expectedPrefix,expectedNumbers,cropDir,appRoot);
        existingNumericAuditItems.push({
          ...observed,
          file,
          reliable:true,
          number:Number(path.parse(file).name),
          observedOcrNumber:observed.reliable && Number.isInteger(observed.number) ? observed.number : null,
          observedOcrEvidence:observed.evidence || null,
          evidence:{method:'existing-numeric-filename-claim'},
        });
      }
      // 增量补跑时，新原图读出的编号可能已被一个旧数字文件占用。先读取
      // 那个旧文件纸面上的真实编号；若它明确属于另一个尚未占用的 PDF 页，
      // 则安排“旧文件归位 + 新原图补入”，而不是把新照片误判成重复。
      const numericByNumber = new Map(images
        .filter((file) => /^\d+$/.test(path.parse(file).name))
        .map((file) => [Number(path.parse(file).name), file]));
      const checkedNumeric = new Set();
      for (const item of recognized.filter((value) => value.reliable && Number.isInteger(value.number))) {
        const existing = numericByNumber.get(item.number);
        if (!existing || checkedNumeric.has(existing)) continue;
        checkedNumeric.add(existing);
        const existingResult = await recognizePreparedImage(worker, existing, expectedPrefix, expectedNumbers, cropDir, appRoot);
        if (!existingResult.reliable || existingResult.number === item.number
          || numericByNumber.has(existingResult.number) || !expectedNumbers.has(existingResult.number)) continue;
        numericCodeRepairs.push({
          source: existing,
          from: item.number,
          to: existingResult.number,
          evidence: { method: 'existing-numeric-file-paper-code-repair', ...existingResult.evidence },
        });
        onProgress?.(`发现旧数字文件占错编号：${path.basename(existing)} 纸面实际为 ${existingResult.number}，将先归位后再补入 ${item.number}。`);
      }
      // 本地 OCR、纸张几何和场景快速路径全部完成后，以当天 PDF 页面版式
      // 复核仍未决的纸张照片。全程离线；异常也只保留未决结果。
      try {
        const claimedNumbers = new Set(numericByNumber.keys());
        for (const repair of numericCodeRepairs) {
          claimedNumbers.delete(repair.from);
          claimedNumbers.add(repair.to);
        }
        for (const item of recognized) {
          if (item.reliable && Number.isInteger(item.number)) claimedNumbers.add(item.number);
        }
        localPageMatch = await matchPdfPagesLocally(recognized, pdfPages, onProgress, claimedNumbers);
        if (localPageMatch.resolved) onProgress?.(`本地 PDF 页面版式已唯一确认 ${localPageMatch.resolved} 张福单图；其余保持未改名。`);
        else if (localPageMatch.attempted) onProgress?.(`本地 PDF 页面版式未能唯一确认 ${localPageMatch.unresolved} 张照片，保持未改名。`);
      } catch {
        localPageMatch = { status: 'unavailable', resolved: 0, attempted: recognized.filter((item) => !item.reliable && !isLikelyScene(item)).length, unresolved: recognized.filter((item) => !item.reliable && !isLikelyScene(item)).length };
        onProgress?.('本地 PDF 页面版式复核发生异常，照片保持未改名。');
      }
    } else {
      const rawPhotoCount = images.filter((file) => {
        const stem = path.parse(file).name;
        return !(/^\d+$/.test(stem) || ['2.1', '2.2', '2.5', '2.6'].includes(stem));
      }).length;
      onProgress?.(`已发现 ${rawPhotoCount} 张原始照片；PDF 没有任何唯一可用编号，暂缓照片 OCR 与改名，原图保持不变。`);
    }
  } finally {
    await worker.terminate();
    for (const temporaryDir of [cropDir, path.join(workDir, 'pdf-code-crops')]) {
      try { fs.rmSync(temporaryDir, { recursive:true, force:true }); } catch {}
    }
  }

  const issues = [];
  const pendingIssues = [];
  if (!pdfFiles.length) issues.push('当天目录没有 PDF，不能建立编号范围。');
  const missingPdfCodes = pdfPages.filter((page) => !Number.isInteger(page.number));
  if (missingPdfCodes.length) pendingIssues.push(`有 ${missingPdfCodes.length} 个 PDF 页面没有可靠识别出打印编号；这些页面进入人工清单，其余唯一编号继续处理。`);
  const pdfNumbers = pdfPages.map((page) => page.number).filter(Number.isInteger);
  const duplicatePdfNumbers = [...new Set(pdfNumbers.filter((value, index, all) => all.indexOf(value) !== index))];
  if (duplicatePdfNumbers.length) pendingIssues.push(`PDF 打印编号有 ${duplicatePdfNumbers.length} 个重复项：${duplicatePdfNumbers.sort((a,b)=>a-b).join('、')}；重复编号进入人工清单，其余唯一编号继续处理。`);
  const pdfNumberCounts = new Map();
  for (const number of pdfNumbers) pdfNumberCounts.set(number, (pdfNumberCounts.get(number) || 0) + 1);
  const expectedNumbers = new Set([...pdfNumberCounts].filter(([, count]) => count === 1).map(([number]) => number));
  const repairFromNumbers = new Set(numericCodeRepairs.map((item) => item.from));
  const preassignedNumbers = images
    .map((file) => path.parse(file).name)
    .filter((stem) => /^\d+$/.test(stem))
    .map(Number)
    .filter((number) => expectedNumbers.has(number) && !repairFromNumbers.has(number));
  for (const repair of numericCodeRepairs) preassignedNumbers.push(repair.to);
  inferPhotoSequences(recognized, expectedNumbers);
  const globalNumberCorrections = reconcileDuplicatePhotoNumbers(recognized, expectedNumbers, new Set(preassignedNumbers));
  for (const correction of globalNumberCorrections) {
    onProgress?.(`全局一一对应纠错：${path.basename(correction.file)} 的 OCR 编号 ${correction.from} 已按 PDF 缺号和连续拍摄顺序修正为 ${correction.to}。`);
  }
  inferPhotoGapsAroundExistingNumbers(recognized, expectedNumbers, new Set(preassignedNumbers));
  // 纸色与唯一缺号只能缩小候选，不能直接定号；折叠会遮住编号，也会扭曲
  // 外框比例。自动定号必须来自 OCR/页面指纹，或经过哈希锁定的人工 PDF 内容复核。
  applyVerifiedFoldedPhotoEvidence(date,recognized,pdfPages);
  await applyExactRemainingPortraitOrderEvidence(recognized, pdfPages);
  const verifiedBatch = await applyVerifiedBatchEvidence({ date, images, recognized, expectedNumbers });
  const manualEvidence = new Map([
    ['新建文件夹.jpg', 253],
    ['新建文件夹(2).jpg', 256],
    ['新建文件夹(3).jpg', 255],
    ['新建文件夹(4).jpg', 258],
    ['新建文件夹(5).jpg', 259],
    ['新建文件夹(6).jpg', 260],
    ['新建文件夹(7).jpg', 262],
    ['新建文件夹(8).jpg', 254],
    ['新建文件夹(9).jpg', 251],
    ['新建文件夹(10).jpg', 250],
    ['新建文件夹(11).jpg', 252],
    ['新建文件夹(12).jpg', 261],
    ['新建文件夹(13).jpg', 257],
  ]);
  const sourceNames = new Set(recognized.map((item) => path.basename(item.file)));
  const exactKnownBatch = date === '2026-08-11'
    && manualEvidence.size === expectedNumbers.size
    && [...manualEvidence.keys()].every((name) => sourceNames.has(name))
    && [...manualEvidence.values()].every((number) => expectedNumbers.has(number));
  if (exactKnownBatch) {
    for (const item of recognized) {
      const number = manualEvidence.get(path.basename(item.file));
      if (!number) continue;
      item.reliable = true;
      item.number = number;
      item.evidence = { method: 'manual-visual-review-2026-08-11', votes: 1, prefixDistance: 0, maxConfidence: 100, layouts: [] };
    }
  }

  try {
    const existingNumericNumbers = new Set(images.map((file)=>/^\d+$/.test(path.parse(file).name) ? Number(path.parse(file).name) : null)
      .filter((number)=>Number.isInteger(number) && expectedNumbers.has(number)));
    const newClaimCandidateNumbers = new Set([...expectedNumbers].filter((number)=>!existingNumericNumbers.has(number)));
    pdfClaimRecheck = await recheckReliablePhotoClaimsWithPdf(
      [...recognized,...existingNumericAuditItems],pdfPages,onProgress,{candidateNumbers:newClaimCandidateNumbers},
    );
    if (pdfClaimRecheck.rejected) {
      const rejectedFiles = pdfClaimRecheck.diagnostics.filter((item)=>item.status==='rejected').map((item)=>item.file);
      issues.push(`编号二次复核未通过 ${pdfClaimRecheck.rejected} 张：${rejectedFiles.join('、')}。已停止改名和上传，请查看 PDF 指纹诊断。`);
    } else if (pdfClaimRecheck.attempted) {
      onProgress?.(`编号二次复核完成：${pdfClaimRecheck.confirmed}/${pdfClaimRecheck.attempted} 张得到第二证据确认，${pdfClaimRecheck.inconclusive || 0} 张现有数字照片纸面暂不可读。`);
    }
  } catch {
    for (const item of [...recognized,...existingNumericAuditItems]) {
      if (item?.reliable && Number.isInteger(item.number)
        && !/manual-visual-review|manual-pdf-content-and-folded-photo-fingerprint-review/.test(String(item?.evidence?.method || ''))) item.reliable=false;
    }
    pdfClaimRecheck = {status:'unavailable',attempted:recognized.length+existingNumericAuditItems.length,confirmed:0,rejected:recognized.length+existingNumericAuditItems.length,inconclusive:0,diagnostics:[]};
    issues.push('编号二次复核发生异常；为防止错误上传，本轮所有自动编号均已停止。');
  }

  const assignments = [];
  const occupiedNames = new Set();
  const assignedNumbers = new Set();
  const foreignNumericFiles = [];
  const numericRepairSources = new Set(numericCodeRepairs.map((item) => path.resolve(item.source)));
  const numericAuditByPath = new Map(existingNumericAuditItems.map((item)=>[path.resolve(item.file),item]));
  for (const repair of numericCodeRepairs) {
    assignedNumbers.add(repair.to);
    occupiedNames.add(`${repair.to}.jpg`);
    assignments.push({
      source: repair.source,
      targetName: `${repair.to}.jpg`,
      kind: 'blessing',
      evidence: repair.evidence,
    });
  }
  for (const file of images) {
    const stem = path.parse(file).name;
    const lowerName = path.basename(file).toLowerCase();
    if (/^\d+$/.test(stem)) {
      const number = Number(stem);
      if (numericRepairSources.has(path.resolve(file))) continue;
      occupiedNames.add(lowerName);
      const audit = numericAuditByPath.get(path.resolve(file));
      if (expectedNumbers.has(number) && (!audit || audit.reliable)) assignedNumbers.add(number);
      else foreignNumericFiles.push(file);
    } else if (['2.1', '2.2', '2.5', '2.6'].includes(stem)) {
      occupiedNames.add(lowerName);
    }
  }
  // 人工已经编号只跳过 OCR 和改名，不能跳过上传规格处理。
  // 对属于当天 PDF 的纯数字福单图及标准场景图，发现尺寸或体积不合规时，
  // 保留原文件名加入处理计划；apply 阶段会先备份，再原位替换为 1800×1350、
  // 不超过 1.5 MiB 的 JPEG。
  for (const file of images) {
    if (numericRepairSources.has(path.resolve(file))) continue;
    const stem = path.parse(file).name;
    const numeric = /^\d+$/.test(stem) && expectedNumbers.has(Number(stem));
    const scene = ['2.1', '2.2', '2.5', '2.6'].includes(stem);
    if (!numeric && !scene) continue;
    const metadata = autoOrientedMetadata(await sharpFile(file).metadata());
    const needsNormalization = fs.statSync(file).size > MAX_IMAGE_BYTES
      || Number(metadata.width || 0) !== 1800
      || Number(metadata.height || 0) !== 1350;
    if (!needsNormalization) continue;
    assignments.push({
      source:file,
      targetName:path.basename(file),
      kind:numeric ? 'blessing' : (['2.1','2.2'].includes(stem) ? 'scene-lamp' : 'scene-water'),
      evidence:{method:'already-numbered-spec-normalization'},
    });
  }
  if (foreignNumericFiles.length) {
    pendingIssues.push(`有 ${foreignNumericFiles.length} 张纯数字照片不属于本日唯一 PDF 编号，已从本日上传和计数中排除：${foreignNumericFiles.map((file)=>path.basename(file)).join('、')}。请将其移入原业务日期后补跑。`);
  }
  const remainingCandidateCorrections = resolveAmbiguousPhotosByGlobalSet(recognized, expectedNumbers, assignedNumbers);
  for (const correction of remainingCandidateCorrections) {
    onProgress?.(`全局一一对应补号：${path.basename(correction.file)} 已按现有编号、PDF 缺号和 OCR 候选唯一归为 ${correction.to}。`);
  }
  const reliableGroups = new Map();
  for (const item of recognized.filter((value) => value.reliable)) {
    if (!reliableGroups.has(item.number)) reliableGroups.set(item.number, []);
    reliableGroups.get(item.number).push(item);
  }
  for (const [number, group] of reliableGroups) {
    if (group.length > 1) {
      // 同号的多张照片不能替程序挑一张；保留为人工待决，但不阻断其他已唯一
      // 确认的编号继续完成。
      pendingIssues.push(`照片编号 ${number} 有 ${group.length} 张候选，已跳过该编号，需人工只保留正确照片后续跑。`);
      continue;
    }
    const item = [...group].sort((a, b) => Number(b.evidence?.maxConfidence || 0) - Number(a.evidence?.maxConfidence || 0))[0];
    if (assignedNumbers.has(number)) {
      pendingIssues.push(`照片编号 ${number} 与已有纯数字福单图冲突，已跳过新增候选，需人工核对后续跑。`);
      continue;
    }
    assignedNumbers.add(item.number);
    const targetName = `${item.number}.jpg`;
    occupiedNames.add(targetName.toLowerCase());
    assignments.push({ source: item.file, targetName, kind: 'blessing', evidence: { method: 'pdf-range-and-photo-code', ...item.evidence } });
  }

  const duplicateSourceSet = new Set(verifiedBatch.duplicateSources.map((item) => item.source));
  const verifiedSceneSourceSet = new Set(verifiedBatch.sceneAssignments.map((item) => item.source));
  const unresolved = recognized.filter((item) => !item.reliable && !duplicateSourceSet.has(item.file) && !verifiedSceneSourceSet.has(item.file)).map((item) => item.file);
  const sceneCandidates = recognized
    .filter((item) => item.reliable === false
      && (item.evidence?.method === 'scene-visual-fast-path' || isLikelyScene(item)))
    .map((item) => item.file);
  const ambiguousCodeCandidates = unresolved.filter((file) => !sceneCandidates.includes(file));
  const recognizedByFile = new Map(recognized.map((item) => [item.file, item]));
  const conflictingCodeCandidates = ambiguousCodeCandidates.filter((file) => {
    const strong = (recognizedByFile.get(file)?.candidates || []).filter((candidate) => candidate.prefixDistance <= 2);
    return new Set(strong.map((candidate) => candidate.number)).size > 1;
  });
  const unreadableCodeCandidates = ambiguousCodeCandidates.filter((file) => !conflictingCodeCandidates.includes(file));
  if (conflictingCodeCandidates.length) pendingIssues.push(`有 ${conflictingCodeCandidates.length} 张福单照片存在多个强编号候选，已保留原图等待人工确认。`);
  if (unreadableCodeCandidates.length) pendingIssues.push(`有 ${unreadableCodeCandidates.length} 张福单照片尚未可靠读出编号，已保留原图等待人工补录。`);

  const missingExpected = [...expectedNumbers].filter((number) => !assignedNumbers.has(number));
  if (missingExpected.length) {
    const detail = missingExpected.length <= 20 ? `：${missingExpected.sort((a, b) => a - b).join('、')}` : '';
    pendingIssues.push(`仍缺少 ${missingExpected.length} 个 PDF 编号对应的福单照片${detail}；现有照片将先处理，补图后只识别新增文件。`);
  }
  if (verifiedBatch.applied) {
    assignments.push(...verifiedBatch.sceneAssignments);
    for (const item of verifiedBatch.sceneAssignments) occupiedNames.add(item.targetName.toLowerCase());
  }
  // 场景图的视觉类别与未决福单编号相互独立。即使有模糊福单，也应继续
  // 处理已明确归类的场景图和对应已上传订单。
  if (verifiedBatch.applied) {
    if (sceneCandidates.length) {
        const verifiedLampCount = verifiedBatch.sceneAssignments.filter((item) => item.kind === 'scene-lamp').length;
        const verifiedWaterCount = verifiedBatch.sceneAssignments.filter((item) => item.kind === 'scene-water').length;
        if (verifiedLampCount >= 2 && verifiedWaterCount === 0 && sceneCandidates.length <= 2) {
          const availableWater = ['2.5.jpg', '2.6.jpg'].filter((name) => !occupiedNames.has(name));
          if (sceneCandidates.length <= availableWater.length) {
            assignments.push(...sceneCandidates
              .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN', { numeric: true }))
              .map((source, index) => ({
                source,
                targetName: availableWater[index],
                kind: 'scene-water',
                evidence: { method: 'remaining-scene-after-two-verified-lamp-scenes' },
              })));
          } else {
            pendingIssues.push('补入的供水场景图数量超过可用的 2.5/2.6 命名位置，已保留等待人工确认。');
          }
        } else {
          const sceneResult = await classifyScenes(sceneCandidates, occupiedNames);
          assignments.push(...sceneResult.assignments);
          pendingIssues.push(...sceneResult.issues);
        }
      }
  } else {
    const sceneResult = await classifyScenes(sceneCandidates, occupiedNames);
    assignments.push(...sceneResult.assignments);
    pendingIssues.push(...sceneResult.issues);
  }

  const targetNames = assignments.map((item) => item.targetName.toLowerCase());
  if (new Set(targetNames).size !== targetNames.length) issues.push('自动处理目标文件名发生重复。');
  const sceneClassificationBlocked = pendingIssues.some((message) => /^场景图识别为|^场景图明暗特征|^剩余 \d+ 张场景候选/.test(message));
  if (!missingExpected.length && !sceneClassificationBlocked) {
    const availableNames = new Set([...occupiedNames, ...targetNames]);
    if (pdfFiles.some((file) => /供水/.test(path.basename(file))) && !availableNames.has('2.5.jpg')) {
      pendingIssues.push('当天有供水福单，但仍缺少供水场景图（应自动命名为 2.5.jpg）；已确认福单仍可先上传。');
    }
    if (pdfFiles.some((file) => !/供水/.test(path.basename(file)))
      && (!availableNames.has('2.1.jpg') || !availableNames.has('2.2.jpg'))) {
      pendingIssues.push('当天有供灯福单，但供灯场景图不足 2 张（应自动命名为 2.1.jpg、2.2.jpg）；已确认福单仍可先上传。');
    }
  }
  for (const assignment of assignments) {
    const target = path.join(photoDir, assignment.targetName);
    const movingSources = new Set(assignments.map((item) => path.resolve(item.source)));
    if (fs.existsSync(target)
      && path.resolve(target) !== path.resolve(assignment.source)
      && !movingSources.has(path.resolve(target))) issues.push('自动处理目标文件名与现有文件冲突。');
  }
  for (const assignment of assignments) {
    const metadata = autoOrientedMetadata(await sharpFile(assignment.source).metadata());
    const ratio = Number(metadata.width || 0) / Number(metadata.height || 1);
    if (Math.abs(ratio - 4 / 3) > 0.03) issues.push('存在不接近 4:3 的照片，需人工确认裁剪或补黑边。');
  }

  // 指纹仅用于本次匹配，不能进入计划 JSON 或任何可同步目录。
  for (const page of pdfPages) delete page._localShapeFingerprint;
  return {
    schemaVersion: 1,
    businessDate: date,
    createdAt: new Date().toISOString(),
    folder,
    photoDir,
    expectedPrefix,
    pdfPages,
    expectedCodeCount: expectedNumbers.size,
    allowedBlessingNumbers: [...expectedNumbers].sort((a,b)=>a-b),
    foreignNumericFiles,
    assignments,
    duplicateSources: verifiedBatch.duplicateSources,
    sceneCandidateCount: sceneCandidates.length,
    ambiguousPhotoCount: ambiguousCodeCandidates.length,
    missingExpected: missingExpected.sort((a, b) => a - b),
    recognized,
    cloudVision,
    localPageMatch,
    pdfClaimRecheck,
    issues: [...new Set(issues)],
    pendingIssues: [...new Set(pendingIssues)],
    manualReview: {
      unresolvedPhotoCount: ambiguousCodeCandidates.length,
      conflictingPhotoCount: conflictingCodeCandidates.length,
      unreadablePhotoCount: unreadableCodeCandidates.length,
      duplicateCandidateCount: [...reliableGroups.values()].filter((group) => group.length > 1).length,
      missingExpected: missingExpected.sort((a, b) => a - b),
    },
    safeToApply: issues.length === 0,
    ready: issues.length === 0 && assignedNumbers.size === expectedNumbers.size,
  };
}

async function makeProcessedJpeg(source, destination) {
  let quality = 90;
  for (;;) {
    await sharpFile(source)
      .rotate()
      .resize(1800, 1350, { fit: 'cover', position: 'centre' })
      .jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toFile(destination);
    const bytes = fs.statSync(destination).size;
    if (bytes <= MAX_IMAGE_BYTES) return { bytes, quality };
    quality -= 2;
    if (quality < 82) throw new Error('图片在可接受画质范围内仍超过 1.5 MiB，已停止。');
  }
}

export async function applyPhotoPreparation(plan, workDir) {
  if (!(plan?.ready || plan?.safeToApply) || plan.issues?.length) throw new Error('自动处理方案没有通过安全校验，未修改照片。');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(workDir, 'photo-backups', stamp);
  const stagingDir = path.join(workDir, 'photo-staging', stamp);
  // 原图先移入内部隔离目录，再把处理后的文件写回每日照片目录。
  // 这样即使 NAS/同步软件短暂占用原图，业务目录里也不会残留
  // `.prayer-*.original` 这类中间文件。隔离目录位于本机其他盘符时，
  // 使用“复制、刷盘、SHA-256 校验、删除源文件”的跨盘事务。
  const quarantineDir = path.join(workDir, 'photo-quarantine', stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(quarantineDir, { recursive: true });
  const prepared = [];
  for (const assignment of plan.assignments) {
    const backup = path.join(backupDir, path.basename(assignment.source));
    fs.copyFileSync(assignment.source, backup, fs.constants.COPYFILE_EXCL);
    const staged = path.join(stagingDir, assignment.targetName);
    const output = await makeProcessedJpeg(assignment.source, staged);
    prepared.push({ ...assignment, backup, staged, beforeSha256: sha256(assignment.source), afterSha256: sha256(staged), ...output });
  }
  const duplicateBackups = [];
  for (const duplicate of plan.duplicateSources || []) {
    const backup = path.join(backupDir, path.basename(duplicate.source));
    fs.copyFileSync(duplicate.source, backup, fs.constants.COPYFILE_EXCL);
    duplicateBackups.push({
      ...duplicate,
      backup,
      beforeSha256: sha256(duplicate.source),
    });
  }

  const quarantined = [];
  const createdTargets = [];
  try {
    for (const item of prepared) {
      const quarantine = path.join(quarantineDir, `${crypto.randomUUID()}-${path.basename(item.source)}`);
      const move = moveFileVerified(item.source, quarantine);
      quarantined.push({ source: item.source, quarantine, moveMethod: move.method });
    }
    for (const item of duplicateBackups) {
      const quarantine = path.join(quarantineDir, `${crypto.randomUUID()}-${path.basename(item.source)}`);
      const move = moveFileVerified(item.source, quarantine);
      quarantined.push({ source: item.source, quarantine, moveMethod: move.method });
    }
    for (const item of prepared) {
      const target = path.join(plan.photoDir, item.targetName);
      fs.copyFileSync(item.staged, target, fs.constants.COPYFILE_EXCL);
      createdTargets.push(target);
      item.target = target;
    }
    // 目标文件全部落盘后清理内部隔离副本。若 NAS 暂时锁定，文件只会留在
    // 自动化工作区，绝不会污染每日照片目录；完整原图仍另有 backupDir 备份。
    for (const item of quarantined) {
      for (let attempt = 0; attempt < 12 && fs.existsSync(item.quarantine); attempt += 1) {
        try { unlinkWithRetrySync(item.quarantine, { attempts: 4, delayMs: 250 }); } catch {}
        if (fs.existsSync(item.quarantine)) await wait(250);
      }
    }
    try { if (fs.readdirSync(quarantineDir).length === 0) fs.rmdirSync(quarantineDir); } catch {}
    try { fs.rmSync(stagingDir, { recursive:true, force:true }); } catch {}
    try { const parent=path.dirname(stagingDir); if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent); } catch {}
    try { const parent=path.dirname(quarantineDir); if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent); } catch {}
  } catch (error) {
    for (const target of createdTargets) {
      try { unlinkWithRetrySync(target); } catch {}
    }
    for (const item of quarantined.reverse()) {
      if (fs.existsSync(item.quarantine) && !fs.existsSync(item.source)) moveFileVerified(item.quarantine, item.source);
    }
    try { fs.rmSync(stagingDir, { recursive:true, force:true }); } catch {}
    try { fs.rmSync(quarantineDir, { recursive:true, force:true }); } catch {}
    throw error;
  }

  return {
    schemaVersion: 1,
    businessDate: plan.businessDate,
    completedAt: new Date().toISOString(),
    backupDir,
    quarantineDir,
    cleanupPending: [
      ...quarantined.filter((item) => fs.existsSync(item.quarantine)).map((item) => item.quarantine),
      ...(fs.existsSync(stagingDir) ? [stagingDir] : []),
    ],
    processedCount: prepared.length,
    blessingCount: prepared.filter((item) => item.kind === 'blessing').length,
    lampSceneCount: prepared.filter((item) => item.kind === 'scene-lamp').length,
    waterSceneCount: prepared.filter((item) => item.kind === 'scene-water').length,
    duplicateRemovedCount: duplicateBackups.length,
    duplicates: duplicateBackups.map(({ source, backup, beforeSha256, duplicateOfNumber, evidence }) => ({ source, backup, beforeSha256, duplicateOfNumber, evidence })),
    files: prepared.map(({ source, target, targetName, kind, backup, beforeSha256, afterSha256, bytes, quality, evidence }) => ({ source, target, targetName, kind, backup, beforeSha256, afterSha256, bytes, quality, evidence })),
  };
}
