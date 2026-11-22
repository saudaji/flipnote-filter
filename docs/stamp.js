const STAMP_PALETTES = {
  POSTAL: {
    paper:[234,226,204],
    fiber:[214,201,176],
    ink:[58,116,74],
    deep:[26,63,37],
    accent:[145,164,111],
  },
  COBALT: {
    paper:[238,232,221],
    fiber:[219,206,190],
    ink:[56,93,154],
    deep:[24,44,92],
    accent:[145,171,212],
  },
  SEPIA: {
    paper:[229,216,194],
    fiber:[207,190,163],
    ink:[91,66,45],
    deep:[44,28,19],
    accent:[151,118,84],
  },
  OXIDE: {
    paper:[238,221,194],
    fiber:[215,196,169],
    ink:[154,83,35],
    deep:[92,44,18],
    accent:[214,154,86],
  },
  NOIR: {
    paper:[239,233,223],
    fiber:[217,208,197],
    ink:[50,49,45],
    deep:[16,16,14],
    accent:[131,126,118],
  },
};
const _stampRenderTargetCache = new Map();
let _stampBlurBuf = new Float32Array(0);

function _ensureStampBlurBuf(sampleW = DSI_W, sampleH = DSI_H) {
  const len = sampleW * sampleH;
  if (_stampBlurBuf.length !== len) _stampBlurBuf = new Float32Array(len);
  return _stampBlurBuf;
}
function _getStampRenderTarget(sampleW, sampleH) {
  if (sampleW === DSI_W && sampleH === DSI_H) return { canvas: small, ctx: ctxS, buffer: lowBuf };
  const key = `${sampleW}x${sampleH}`;
  let target = _stampRenderTargetCache.get(key);
  if (!target) {
    const canvas = document.createElement('canvas');
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.imageSmoothingEnabled = false;
    target = { canvas, ctx, buffer: new Uint8ClampedArray(sampleW * sampleH * 4) };
    _stampRenderTargetCache.set(key, target);
  }
  return target;
}
function _getStampCaptureSampleDims(options = {}) {
  const resolutionId = options.resolution || ((flipAudioSettings && flipAudioSettings.resolution) || 'medium');
  const scale = resolutionId === 'high' ? 1.72 : (resolutionId === 'low' ? 1.10 : 1.38);
  const even = v => Math.max(32, Math.round(v / 2) * 2);
  return { sampleW: even(DSI_W * scale), sampleH: even(DSI_H * scale) };
}
function _stampClamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function _stampSmoothstep(edge0, edge1, x) {
  const t = _stampClamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function _stampNoise(x, y, seed = 0) {
  const n = ((((x + 11) * 374761393) ^ ((y + 23) * 668265263) ^ ((seed + 7) * 2246822519)) >>> 0);
  return ((n ^ (n >>> 13)) & 255) / 255;
}
function _stampBand(coord, spacing, width) {
  const safeSpacing = Math.max(1.5, spacing);
  const m = coord - safeSpacing * Math.floor(coord / safeSpacing);
  const d = Math.abs(m - safeSpacing * 0.5);
  const feather = Math.max(0.18, width * 0.32);
  const hard = Math.max(0.15, width * 0.5);
  return 1 - _stampClamp01((d - hard) / feather);
}
function _getStampPalette() {
  return STAMP_PALETTES[stampPaletteMode] || STAMP_PALETTES.POSTAL;
}
function _getStampVariantProfile() {
  switch (renderVariant()) {
    case 'INK':
      return {
        hatchBoost:0.72, crossBoost:0.54, tertiaryBoost:0.32, massBoost:1.42, edgeBoost:0.92,
        stippleBoost:0.05, spacingBias:1.35, gamma:0.94, toneLevels:4, lineFloor:0.30, plateBoost:0.22
      };
    case 'ISSUE':
      return {
        hatchBoost:0.98, crossBoost:0.84, tertiaryBoost:0.56, massBoost:1.02, edgeBoost:0.98,
        stippleBoost:0.10, spacingBias:0.30, gamma:1.00, toneLevels:5, lineFloor:0.22, plateBoost:0.10
      };
    case 'ENGR':
    default:
      return {
        hatchBoost:1.18, crossBoost:0.96, tertiaryBoost:0.70, massBoost:0.78, edgeBoost:1.10,
        stippleBoost:0.12, spacingBias:-0.42, gamma:1.04, toneLevels:6, lineFloor:0.18, plateBoost:0.00
      };
  }
}
function _stampPosterize(value, levels = 5, softness = 0.32) {
  const maxIdx = Math.max(1, levels - 1);
  const scaled = _stampClamp01(value) * maxIdx;
  const lo = Math.floor(scaled);
  const hi = Math.min(maxIdx, lo + 1);
  const frac = scaled - lo;
  const eased = _stampSmoothstep(0.5 - softness * 0.5, 0.5 + softness * 0.5, frac);
  return (lo + (hi - lo) * eased) / maxIdx;
}
function _stampWarpNoise(x, y, seed = 0) {
  const a = _stampNoise(x * 0.5, y * 0.5, seed + 131) - 0.5;
  const b = _stampNoise(x * 0.21 + 17, y * 0.21 + 31, seed + 317) - 0.5;
  const c = _stampNoise(x * 0.09 + 51, y * 0.09 + 73, seed + 503) - 0.5;
  return a * 0.55 + b * 0.30 + c * 0.15;
}
const crossCos = Math.cos(Math.PI * 0.48), crossSin = Math.sin(Math.PI * 0.48);
const thirdCos = Math.cos(-Math.PI * 0.33), thirdSin = Math.sin(-Math.PI * 0.33);
function _drawStampIssueFrame(targetCtx, outW, outH, palette, imageBounds) {
  const { x, y, w, h } = imageBounds;
  const margin = Math.max(10, Math.round(Math.min(outW, outH) * 0.032));
  const lineOuter = Math.max(1.5, Math.round(Math.min(outW, outH) * 0.0035));
  const lineInner = Math.max(1, Math.round(Math.min(outW, outH) * 0.002));
  const accent = `rgb(${palette.accent.join(',')})`;
  const deep = `rgb(${palette.deep.join(',')})`;
  const ink = `rgb(${palette.ink.join(',')})`;
  targetCtx.save();
  targetCtx.strokeStyle = accent;
  targetCtx.lineWidth = lineOuter;
  targetCtx.strokeRect(x - margin, y - margin, w + margin * 2, h + margin * 2);
  targetCtx.strokeStyle = deep;
  targetCtx.lineWidth = lineInner;
  targetCtx.strokeRect(x - margin * 0.55, y - margin * 0.55, w + margin * 1.1, h + margin * 1.1);
  targetCtx.strokeRect(x - margin * 0.18, y - margin * 0.18, w + margin * 0.36, h + margin * 0.36);
  targetCtx.fillStyle = deep;
  targetCtx.font = `${Math.max(12, Math.round(outH * 0.026))}px Georgia, "Times New Roman", serif`;
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';
  targetCtx.fillText('FLIP POST', outW * 0.5, y - margin * 0.66);
  targetCtx.fillStyle = ink;
  targetCtx.font = `${Math.max(11, Math.round(outH * 0.022))}px Georgia, "Times New Roman", serif`;
  targetCtx.textAlign = 'left';
  targetCtx.fillText(renderVariant(), x - margin * 0.74, y + h + margin * 0.52);
  targetCtx.textAlign = 'right';
  targetCtx.fillText('12c', x + w + margin * 0.74, y + h + margin * 0.52);
  targetCtx.restore();
}
function _renderStampCore(source, srcW, srcH, targetCtx, mirror, options = {}) {
  const sampleW = Math.max(32, options.sampleW || DSI_W);
  const sampleH = Math.max(32, options.sampleH || DSI_H);
  const outW = Math.max(1, Math.round(options.outW || targetCtx.canvas?.width || OUT_W));
  const outH = Math.max(1, Math.round(options.outH || targetCtx.canvas?.height || OUT_H));
  const renderTarget = _getStampRenderTarget(sampleW, sampleH);
  const sampleCtx = renderTarget.ctx;
  const outBuf = renderTarget.buffer;
  const blur = _ensureStampBlurBuf(sampleW, sampleH);
  const [sx, sy, sw, sh] = cropCoordsForDims(srcW, srcH, sampleW, sampleH);
  sampleCtx.save();
  sampleCtx.clearRect(0, 0, sampleW, sampleH);
  if (mirror) { sampleCtx.translate(sampleW, 0); sampleCtx.scale(-1, 1); }
  sampleCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sampleW, sampleH);
  sampleCtx.restore();
  const { data: src } = sampleCtx.getImageData(0, 0, sampleW, sampleH);
  const lum = _fillCamLumBuf(src, sampleW, sampleH);
  const palette = _getStampPalette();
  const variant = _getStampVariantProfile();
  const engrave = stampEngraveVal / 100;
  const ink = stampInkVal / 100;
  const detail = stampDetailVal / 100;
  const paper = stampPaperVal / 100;
  const scaleX = DSI_W / sampleW;
  const scaleY = DSI_H / sampleH;
  const seed = (_camEngineCore.sessionSeed || 0) >>> 0;

  let minBlur = 255;
  let maxBlur = 0;
  for (let y = 0; y < sampleH; y++) {
    const yu = y ? y - 1 : y;
    const yd = y + 1 < sampleH ? y + 1 : y;
    for (let x = 0; x < sampleW; x++) {
      const xl = x ? x - 1 : x;
      const xr = x + 1 < sampleW ? x + 1 : x;
      const idx = y * sampleW + x;
      const sum =
        lum[yu * sampleW + xl] + lum[yu * sampleW + x] + lum[yu * sampleW + xr] +
        lum[y * sampleW + xl]  + lum[idx]              + lum[y * sampleW + xr] +
        lum[yd * sampleW + xl] + lum[yd * sampleW + x] + lum[yd * sampleW + xr];
      const blurred = sum / 9;
      blur[idx] = blurred;
      if (blurred < minBlur) minBlur = blurred;
      if (blurred > maxBlur) maxBlur = blurred;
    }
  }
  const range = Math.max(1, maxBlur - minBlur);
  const sceneContrast = Math.min(1, (maxBlur - minBlur) / 56);
  const baseSpacing = Math.max(3.25, 9.9 - engrave * 4.1 - detail * 1.8 + variant.spacingBias);
  const crossSpacing = baseSpacing + 2.8 - engrave * 0.55;
  const tertiarySpacing = baseSpacing + 1.55 - engrave * 0.35;
  const baseWidth = 0.82 + engrave * 1.12 + detail * 0.34 + ink * 0.18;
  const crossWidth = 0.56 + engrave * 0.82 + detail * 0.16;
  const tertiaryWidth = 0.40 + engrave * 0.70;
  const localBlend = 0.16 + detail * 0.52;
  const inkDensity = 0.86 + ink * 0.58;
  const paperFiberBoost = 0.20 + paper * 0.52;
  const posterSoftness = 0.42 - detail * 0.18;
  const contourStrength = 0.08 + detail * 0.16;
  const warpAmount = 0.34 + engrave * 0.82 + paper * 0.44;
  for (let y = 0; y < sampleH; y++) {
    const yu = y ? y - 1 : y;
    const yd = y + 1 < sampleH ? y + 1 : y;
    for (let x = 0; x < sampleW; x++) {
      const xl = x ? x - 1 : x;
      const xr = x + 1 < sampleW ? x + 1 : x;
      const idx = y * sampleW + x;
      const i = idx << 2;
      const gx = blur[y * sampleW + xr] - blur[y * sampleW + xl];
      const gy = blur[yd * sampleW + x] - blur[yu * sampleW + x];
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      const edge = _stampClamp01((ax + ay) / Math.max(20, 78 - detail * 36));
      const localTone = lum[idx] / 255;
      const relativeTone = _stampClamp01((blur[idx] - minBlur) / range);
      const broadTone = localTone + sceneContrast * (relativeTone - localTone);
      let tone = broadTone * (1 - localBlend) + localTone * localBlend;
      tone = _stampPosterize(tone, variant.toneLevels, posterSoftness);
      tone = Math.pow(tone, variant.gamma + (paper - 0.5) * 0.12);
      tone = _stampClamp01(tone - edge * (0.09 + detail * 0.16) + variant.plateBoost * (broadTone - tone));
      const shadow = 1 - tone;

      const px = x * scaleX;
      const py = y * scaleY;
      const grain = _stampNoise(Math.floor(px), Math.floor(py), seed);
      const paperNoise = (_stampNoise(px >> 1, py >> 1, seed + 17) - 0.5);
      const fiberNoise = _stampNoise(Math.floor(px * 3) + 9, Math.floor(py) + 5, seed + 41);
      const fiber = fiberNoise > (0.90 - paper * 0.18) ? (fiberNoise - (0.90 - paper * 0.18)) / 0.18 : 0;
      const jitter = (grain - 0.5) * (0.55 + paper * 0.65);
      const warp = _stampWarpNoise(px, py, seed) * warpAmount + jitter * 0.8;

      let dirX = 0;
      let dirY = 1;
      if (edge >= 0.10) {
        const length = Math.sqrt(gx * gx + gy * gy);
        dirX = -gy / length;
        dirY = gx / length;
      }
      const primaryCoord = px * dirX + py * dirY + warp * (1.5 + edge * 0.8);
      const secondaryCoord = px * (dirX * crossCos - dirY * crossSin) + py * (dirY * crossCos + dirX * crossSin) - warp * 0.85;
      const tertiaryCoord = px * (dirX * thirdCos - dirY * thirdSin) + py * (dirY * thirdCos + dirX * thirdSin) + warp * 0.55;

      const primary = _stampBand(primaryCoord + jitter * 1.8, baseSpacing, baseWidth) *
        _stampSmoothstep(Math.max(0.10, variant.lineFloor), 0.86, shadow) * variant.hatchBoost;
      const secondary = _stampBand(secondaryCoord - jitter * 1.1, crossSpacing, crossWidth) *
        _stampSmoothstep(0.40 + variant.lineFloor * 0.35, 0.93, shadow) * (0.50 + engrave * 0.34) * variant.crossBoost;
      const tertiary = _stampBand(tertiaryCoord + jitter * 0.7, tertiarySpacing, tertiaryWidth) *
        _stampSmoothstep(0.62 + variant.lineFloor * 0.25, 0.985, shadow) * (0.36 + engrave * 0.26) * variant.tertiaryBoost;
      const mass = _stampSmoothstep(0.72 - ink * 0.24, 0.965, shadow) * variant.massBoost;
      const edgeBoost = _stampSmoothstep(0.08 - detail * 0.05, 0.34, edge) *
        (0.46 + shadow * 0.64) * variant.edgeBoost;
      const stippleNoise = _stampNoise((px >> 1) + 3, (py >> 1) + 7, seed + 91);
      const stipple = (shadow > 0.24 && shadow < 0.56 && stippleNoise < shadow * (0.08 + variant.stippleBoost))
        ? (0.08 + variant.stippleBoost)
        : 0;
      const contour = _stampSmoothstep(0.22, 0.72, edge) *
        _stampSmoothstep(0.10, 0.80, shadow) * contourStrength;

      let coverage = Math.max(primary, secondary, tertiary, mass, edgeBoost, stipple, contour);
      coverage = Math.max(coverage, shadow * (0.05 + ink * 0.18) * variant.massBoost);
      coverage *= inkDensity;
      coverage = _stampClamp01(coverage);
      const inkAlpha = _stampClamp01(coverage * (0.90 + ink * 0.18 + paper * 0.06) + mass * (0.08 + ink * 0.10) + edgeBoost * 0.05 + contour * 0.06);

      const paperBlend = _stampClamp01(0.18 + paper * 0.34 + paperNoise * (0.55 + paper * 0.35) + fiber * paperFiberBoost);
      const paperR = palette.paper[0] + (palette.fiber[0] - palette.paper[0]) * paperBlend;
      const paperG = palette.paper[1] + (palette.fiber[1] - palette.paper[1]) * paperBlend;
      const paperB = palette.paper[2] + (palette.fiber[2] - palette.paper[2]) * paperBlend;
      const inkTone = _stampClamp01(shadow * (0.50 + ink * 0.18) + edgeBoost * (0.22 + detail * 0.10) + mass * (0.18 + ink * 0.20));
      const inkR = palette.ink[0] + (palette.deep[0] - palette.ink[0]) * inkTone;
      const inkG = palette.ink[1] + (palette.deep[1] - palette.ink[1]) * inkTone;
      const inkB = palette.ink[2] + (palette.deep[2] - palette.ink[2]) * inkTone;

      outBuf[i] = Math.max(0, Math.min(255, Math.round(paperR + (inkR - paperR) * inkAlpha)));
      outBuf[i + 1] = Math.max(0, Math.min(255, Math.round(paperG + (inkG - paperG) * inkAlpha)));
      outBuf[i + 2] = Math.max(0, Math.min(255, Math.round(paperB + (inkB - paperB) * inkAlpha)));
      outBuf[i + 3] = 255;
    }
  }

  sampleCtx.putImageData(new ImageData(outBuf, sampleW, sampleH), 0, 0);
  targetCtx.clearRect(0, 0, outW, outH);
  const frameOn = stampFrameMode === 'ON';
  const marginX = frameOn ? Math.round(outW * 0.085) : 0;
  const marginY = frameOn ? Math.round(outH * 0.085) : 0;
  const drawBounds = {
    x: marginX,
    y: marginY,
    w: Math.max(1, outW - marginX * 2),
    h: Math.max(1, outH - marginY * 2),
  };
  targetCtx.fillStyle = `rgb(${palette.paper.join(',')})`;
  targetCtx.fillRect(0, 0, outW, outH);
  targetCtx.save();
  targetCtx.imageSmoothingEnabled = true;
  try { targetCtx.imageSmoothingQuality = 'high'; } catch (_) {}
  targetCtx.drawImage(renderTarget.canvas, drawBounds.x, drawBounds.y, drawBounds.w, drawBounds.h);
  targetCtx.globalAlpha = 0.06 + paper * 0.22;
  targetCtx.filter = `blur(${0.28 + paper * 0.95}px)`;
  targetCtx.drawImage(renderTarget.canvas, drawBounds.x, drawBounds.y, drawBounds.w, drawBounds.h);
  targetCtx.filter = 'none';
  if (paper > 0.08) {
    targetCtx.globalCompositeOperation = 'multiply';
    targetCtx.globalAlpha = 0.035 + paper * 0.06;
    targetCtx.fillStyle = `rgb(${palette.fiber.join(',')})`;
    targetCtx.beginPath();
    for (let y = drawBounds.y; y < drawBounds.y + drawBounds.h; y += 3) {
      const wobble = ((y * 17 + seed) & 7) - 3;
      targetCtx.rect(drawBounds.x, y + wobble * 0.08, drawBounds.w, 1);
    }
    targetCtx.fill();
    targetCtx.globalCompositeOperation = 'source-over';
  }
  targetCtx.globalAlpha = 1;
  targetCtx.restore();
  if (frameOn) _drawStampIssueFrame(targetCtx, outW, outH, palette, drawBounds);
}
function renderStamp(source, srcW, srcH, targetCtx, mirror, options = {}) {
  _renderStampCore(source, srcW, srcH, targetCtx, mirror, options);
}
