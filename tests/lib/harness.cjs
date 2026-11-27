// Arnés común de las pruebas de FLIP. Requiere playwright-core y Chrome instalado.
// FLIP_URL apunta al servidor estático de docs/ (por defecto http://127.0.0.1:8760).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium, webkit, devices } = require('playwright-core');

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

// FLIP_ENGINE=webkit corre las pruebas con el motor de Safari (el WebKit de Playwright:
// `node node_modules/playwright-core/cli.js install webkit`), con la pantalla y la identidad de un
// iPhone. No es un iPhone —no tiene su cámara ni su sistema—, pero sí su motor de página: lo que
// Safari no entiende, aquí tampoco. Sin cámara de mentira del navegador, la de escena va siempre.
const ENGINE = process.env.FLIP_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const IPHONE = { ...devices['iPhone 15'] };

async function launch(options = {}) {
  if (ENGINE === 'webkit') return webkit.launch({ headless: options.headless !== false });
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
    ...(options.desktop ? { viewport: { width: 1280, height: 800 } } : ENGINE === 'webkit' ? IPHONE : PIXEL),
    acceptDownloads: true,
    ...(options.context || {}),
  });
  await context.addInitScript({ path: path.join(__dirname, '..', 'scenes.js') });
  await context.addInitScript({ path: path.join(__dirname, 'page-kit.js') });
  // piel: 'objeto' abre la carcasa de aparato (de fábrica FLIP abre la piel INTERFAZ). Se fija antes
  // de cargar, una sola vez por contexto: si la prueba cambia de piel después, se respeta.
  if (options.piel) await context.addInitScript(piel => { try { if (!sessionStorage.getItem('flip.prueba.piel')) { localStorage.setItem('flip.piel', piel); sessionStorage.setItem('flip.prueba.piel', '1'); } } catch (_) {} }, options.piel);
  // En un teléfono (y las pruebas se hacen pasar por uno) las tomas van de fábrica al CARRETE de FLIP,
  // sin descarga. Las pruebas de siempre esperan la descarga de cada toma: abren con GUARDAR EN ·
  // ARCHIVOS ya elegido. La del carrete pide `carrete: true` y abre como un teléfono recién estrenado.
  if (!options.carrete) await context.addInitScript(() => { try { if (!localStorage.getItem('flip_audio_settings')) localStorage.setItem('flip_audio_settings', JSON.stringify({ saveMode: 'files', saveV: 2 })); } catch (_) {} });
  const sceneCamera = options.sceneCamera || (ENGINE === 'webkit' ? { scene: 'roomLit', w: 720, h: 1280, fps: 30 } : null);
  if (sceneCamera) {
    await context.addInitScript(config => { window.__flipSceneCamera = config; }, sceneCamera);
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
// Elige una cámara como lo hace una persona: primero su cajón (FILM · DIGITAL · CUSTOM), luego su
// diapositiva en la tira. Con «variant», la diapositiva de esa variante (las películas de FILM).
async function pickCamera(page, family, variant) {
  const group = await page.evaluate(f => (CAM_FAMILIES[f] && CAM_FAMILIES[f].grupo) || 'digital', family);
  const tab = page.locator('#deckGroups [data-group="' + group + '"]');
  if (!(await tab.evaluate(el => el.classList.contains('is-on')))) { await tab.click(); await page.waitForTimeout(250); }
  const tile = page.locator('#deckLooks [data-family="' + family + '"]' + (variant ? '[data-variant="' + variant + '"]' : '')).first();
  await tile.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  if (!(await tile.evaluate(el => el.classList.contains('is-on')))) await tile.click();   // (en la piel INTERFAZ, tocar la que ya está puesta abre el cajón)
}
// Abre un módulo del TALLER de STAGE como una persona: si STAGE está en la vista FÁCIL, primero TALLER.
async function stageTab(page, id) {
  const tab = page.locator('#rigTabs [data-page="' + id + '"]');
  if (!(await tab.isVisible())) await page.locator('#rigTaller').click();
  await tab.click();
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

module.exports = { URL, PIXEL, IPHONE, ENGINE, launch, openFlip, openModule, pickVariant, pickCamera, stageTab, saveDataUrl, encodeClip, probe };
