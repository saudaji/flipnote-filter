// Run against a static server for docs/, with playwright-core and Chrome installed.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(process.env.FLIP_URL || 'http://127.0.0.1:8742');
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0);
    const result = await page.evaluate(async () => {
      cameraRunning = false;
      const makeCanvas = () => {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 192;
        return c;
      };
      const chart = makeCanvas(),
        input = chart.getContext('2d');
      const ctx = makeCanvas().getContext('2d', { willReadFrequently: true });
      function signal(cycles, phase = 0) {
        const frame = input.createImageData(256, 192);
        for (let y = 0; y < 192; y++) {
          for (let x = 0; x < 256; x++) {
            const i = (y * 256 + x) * 4;
            const v = 128 + 70 * Math.sin((2 * Math.PI * cycles * x) / 256 + (y >= 96 ? phase : 0));
            frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = v;
            frame.data[i + 3] = 255;
          }
        }
        input.putImageData(frame, 0, 0);
      }
      const draw = (mode, t) => plotOpticalScope(chart, 256, 192, ctx, false, mode, t);
      const peaks = [0, 4, 12, 32].map((cycles) => {
        signal(cycles);
        draw('FFT', 1000);
        return opticalScopes.get(ctx).peak;
      });
      // Compare the actual beam image with the y=-x line through its center.
      const spreads = [0, Math.PI / 2].map((phase, k) => {
        signal(4, phase);
        draw('XY', 2000 + k * 1000);
        const pixels = opticalScopes
          .get(ctx)
          .beam.getContext('2d')
          .getImageData(0, 0, 256, 192).data;
        let spread = 0;
        for (let y = 0; y < 192; y++)
          for (let x = 0; x < 256; x++) {
            if (pixels[(256 * y + x) * 4 + 1] > 40)
              spread = Math.max(spread, Math.abs(x - 128 + y - 96));
          }
        return spread;
      });
      for (let i = 0; i < 90; i++) {
        const v = Math.round(128 + 80 * Math.sin((2 * Math.PI * i) / 10));
        input.fillStyle = 'rgb(' + [v, v, v].join(',') + ')';
        input.fillRect(0, 0, 256, 192);
        draw('TIME', 5000 + (i * 1000) / 30);
      }
      const hz = opticalScopes.get(ctx).hz;
      _setCamFamily('AUTO03');
      camVariant = 'FLASH';
      _applyCamState();
      const track = vid.srcObject.getVideoTracks()[0],
        calls = [];
      Object.defineProperties(track, {
        getCapabilities: { value: () => ({ torch: true }) },
        applyConstraints: {
          value: async (opts) => {
            calls.push(opts.advanced.at(-1).torch);
          },
        },
      });
      const [flash, duplicate] = await Promise.all([cameraPhoto(), cameraPhoto()]);
      camVariant = 'NIGHT';
      _applyCamState();
      const night = await cameraPhoto();
      return { peaks, spreads, hz, calls, duplicate, jpeg: [flash.type, night.type] };
    });
    assert.deepEqual(result.peaks, [0, 4, 12, 32]);
    assert.ok(result.spreads[0] <= 3 && result.spreads[1] > 25, JSON.stringify(result.spreads));
    assert.ok(Math.abs(result.hz - 3) < 0.03);
    assert.deepEqual(result.calls, [true, false]);
    assert.equal(result.duplicate, null);
    assert.deepEqual(result.jpeg, ['image/jpeg', 'image/jpeg']);
    await page.evaluate(() => {
      const mask = new Float32Array(64 * 64);
      for (let row = 18; row < 46; row++) mask.fill(1, row * 64 + 24, row * 64 + 40);
      createPersonSegmenter = async () => ({
        segmentForVideo: () => ({
          confidenceMasks: [{ width: 64, height: 64, getAsFloat32Array: () => mask }],
        }),
      });
      window._sfParams.trail = 0;
      window.flowGlyphs = [];
      const ctx = document.getElementById('sflowCanvas').getContext('2d');
      const originalText = ctx.fillText.bind(ctx);
      ctx.fillText = function (ch, x, y) {
        const point = new DOMPoint(x, y).matrixTransform(this.getTransform());
        flowGlyphs.push(point.x / this.canvas.width);
        originalText(ch, x, y);
      };
    });
    await page.locator('#modulePicker').selectOption('sflow');
    await page.locator('#btnSflowCam').click();
    await page.waitForFunction(() => window.flowGlyphs.length >= 5);
    const center = await page.evaluate(
      () => flowGlyphs.reduce((a, b) => a + b, 0) / flowGlyphs.length,
    );
    assert.ok(Math.abs(center - 0.5) < 0.12, 'Projected glyph center ' + center);
    console.log('PASS', { ...result, flowCenter: center });
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
