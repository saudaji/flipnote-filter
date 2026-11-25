// Arnés común de las pruebas de FLIP. Requiere playwright-core y Chrome instalado.
// FLIP_URL apunta al servidor estático de docs/ (por defecto http://127.0.0.1:8760).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const URL = process.env.FLIP_URL || 'http://127.0.0.1:8760';
// Pixel 10 Pro XL en Chrome para Android, medido en el teléfono por depuración USB: con la barra
// de direcciones a la vista quedan 395 × 741 px CSS a densidad 3,4 (pantalla completa: 396 × 880).
const PIXEL = {
  viewport: { width: 395, height: 741 },
  deviceScaleFactor: 3.4,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36',
};

async function launch(options = {}) {
  const args = [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    ...(options.args || []),
  ];
  return chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: options.headless !== false,
    args,
  });
}

// Abre FLIP con el kit de página. sceneCamera sustituye la cámara por una escena.
async function openFlip(browser, options = {}) {
  const context = await browser.newContext({
    ...(options.desktop ? { viewport: { width: 1280, height: 800 } } : PIXEL),
    acceptDownloads: true,
    ...(options.context || {}),
  });
  await context.addInitScript({ path: path.join(__dirname, '..', 'scenes.js') });
  await context.addInitScript({ path: path.join(__dirname, 'page-kit.js') });
  // piel: 'objeto' abre la carcasa de aparato (de fábrica FLIP abre la piel INTERFAZ). Se fija antes
  // de cargar, una sola vez por contexto: si la prueba cambia de piel después, se respeta.
  if (options.piel) await context.addInitScript(piel => { try { if (!sessionStorage.getItem('flip.prueba.piel')) { localStorage.setItem('flip.piel', piel); sessionStorage.setItem('flip.prueba.piel', '1'); } } catch (_) {} }, options.piel);
  if (options.sceneCamera) {
    await context.addInitScript(config => { window.__flipSceneCamera = config; }, options.sceneCamera);
    await context.addInitScript({ path: path.join(__dirname, 'scene-camera.js') });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error && error.message || error)));
  await page.goto(options.url || URL);
  if (options.boot !== false) {
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
  }
  return { context, page, errors };
}

// Cambia de módulo como lo hace una persona: tecla de módulo y tarjeta del lanzador.
async function openModule(page, key) {
  await page.locator('#shellModule').click();
  await page.locator('#shellLauncher [data-module="' + key + '"]').click();
}

// Elige una variante de la cámara como lo hace una persona: en la piel OBJETO las teclas están a
// la vista; en la piel INTERFAZ viven en el cajón «cámaras y filtros», que se abre y se cierra.
async function pickVariant(page, id) {
  const key = page.locator('#deckVariants [data-variant="' + id + '"]');
  if (!(await key.isVisible())) await page.locator('.si-abrir').click();
  await key.click();
  if (await page.evaluate(() => document.body.classList.contains('banda-abierta'))) await page.locator('.si-abrir').click();
}
function saveDataUrl(file, dataUrl) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}

// Une una secuencia f_0000.png… en un MP4 que cualquier visor abre.
function encodeClip(dir, out, fps = 30) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(dir, 'f_%04d.png'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-movflags', '+faststart', out]);
}

function probe(file) {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,format_name:stream=codec_type,codec_name,width,height,channels,nb_read_frames,avg_frame_rate',
    '-count_frames', '-of', 'json', file]).toString();
  return JSON.parse(raw);
}

module.exports = { URL, PIXEL, launch, openFlip, openModule, pickVariant, saveDataUrl, encodeClip, probe };
