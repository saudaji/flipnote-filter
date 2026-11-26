// Start a static server for docs/, then run this file with playwright-core available.
// FLIP_URL and CHROME_PATH can point to a different local server or Chromium binary.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { stageTab } = require('./lib/harness.cjs');

async function hasImage(page, id) {
  await page.waitForFunction(id => {
    const canvas = document.getElementById(id);
    if (!canvas?.width) return false;
    const sample = document.createElement('canvas');
    sample.width = sample.height = 16;
    const ctx = sample.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 16, 16);
    const pixels = ctx.getImageData(0, 0, 16, 16).data;
    for (let i = 4; i < pixels.length; i += 4) {
      if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2]) return true;
    }
    return false;
  }, id, { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.FLIP_URL || 'http://127.0.0.1:8742');
    await page.locator('#btnSplashOriginal').click();
    await hasImage(page, 'display');
    await page.locator('#deckLooks [data-family="PRENSA"]').click();
    await page.evaluate(() => { camVariant = 'ENGR'; _applyCamState(); });       // el sello postal: ahora, una variante de PRINT
    const geometry = await page.evaluate(async () => {
      flipAudioSettings.resolution = 'high';
      const bitmap = await createImageBitmap(await cameraPhoto());
      const size = [bitmap.width, bitmap.height];
      bitmap.close();
      return size;
    });
    assert.deepEqual(geometry, [1440, 1080]);
    const calls = await page.evaluate(async () => {
      let draws = 0;
      const draw = () => draws++;
      for (let index = 0; index < 100; index++) scheduleFrame(draw);
      await new Promise(requestAnimationFrame);
      return draws;
    });
    assert.equal(calls, 1);
    // STAGE: el sintetizador dibuja la cámara y su ventana de salida recibe la imagen.
    await page.locator('#shellModule').click();
    await page.locator('#shellLauncher [data-module="stage"]').click();
    await page.waitForFunction(() => flipStage.status().ok && flipStage.status().hasA, null, { timeout: 15000 });
    await hasImage(page, 'stageCanvas');
    const popup = page.waitForEvent('popup');
    await stageTab(page, 'out');
    await page.locator('#rigPanel [data-act="window"]').click();
    const output = await popup;
    output.on('pageerror', error => errors.push(error.message));
    await hasImage(output, 'out');
    await page.locator('#rigMic').click();
    await page.waitForFunction(() => flipStage.status().audio.on && flipStage.status().audio.kind === 'mic');
    await output.close();
    await page.waitForFunction(() => !flipStage.status().out.window);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.context().setOffline(true);
    await page.reload();
    await page.locator('#btnSplashOriginal').click();
    await hasImage(page, 'display');
    assert.deepEqual(errors, []);
    console.log('PASS · camera, HD photo, frame scheduling, STAGE output, offline launch');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
