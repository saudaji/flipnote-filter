// Medios de la alfa: lo que se guarda es lo que se vio.
//   1 · vídeo de CAM con audio: pistas, duración y señal comprobadas con ffprobe/ffmpeg
//   2 · visor frente a un cuadro del vídeo grabado en NIGHT y en VECTOR
//   3 · EDIT importa una foto y un vídeo exportados por CAM y vuelve a exportar
//   4 · actualización desde la alfa anterior con su service worker instalado
//   FLIP_URL=http://127.0.0.1:8760 node tests/alpha-media.cjs [carpeta] [--old-ref ad2272b]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { launch, openFlip, probe, PIXEL } = require('./lib/harness.cjs');

const args = process.argv.slice(2);
const refAt = args.indexOf('--old-ref');
const oldRef = refAt >= 0 ? args.splice(refAt, 2)[1] : 'ad2272b';
const out = path.resolve(args[0] || fs.mkdtempSync(path.join(os.tmpdir(), 'flip-media-')));
fs.mkdirSync(out, { recursive: true });
const SNAP = '#flipBottomNav .btn-center', MODE = '#flipBottomNav button >> nth=0';
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));

async function download(page, action, name) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 25000 }), action()]);
  const target = path.join(out, name + path.extname(file.suggestedFilename()));
  await file.saveAs(target);
  return target;
}
async function record(page, ms, name) {
  await page.locator(SNAP).click();
  await page.waitForFunction(() => recorder && recorder.state === 'recording');
  await page.waitForTimeout(ms);
  const file = await download(page, () => page.locator(SNAP).click(), name);
  await page.waitForFunction(() => !recorder);
  return file;
}
// Luminancia y color medio de una imagen en disco, medidos dentro de la página.
function measure(page, file, size) {
  const mime = /\.png$/.test(file) ? 'image/png' : 'image/jpeg';
  return page.evaluate(async ({ bytes, mime, size }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: mime }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const s = FlipKit.stats(canvas, [0.25, 0.25, 0.5, 0.5]);
    return { luma: Array.from(FlipKit.luma(canvas, null, size)), rg: s.r / s.g, bg: s.b / s.g, width: bitmap.width, height: bitmap.height };
  }, { bytes: fs.readFileSync(file).toString('base64'), mime, size });
}
function frameAt(video, seconds, name) {
  const png = path.join(out, name + '.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(seconds), '-i', video, '-frames:v', '1', png]);
  return png;
}
const correlate = (page, a, b) => page.evaluate(([x, y]) => FlipKit.correlation(Float32Array.from(x), Float32Array.from(y)), [a, b]);

async function cameraMedia(browser) {
  // freeze: la escena no cambia, así visor y archivo se pueden comparar cuadro a cuadro.
  const { context, page, errors } = await openFlip(browser, { sceneCamera: { scene: 'room', w: 1280, h: 720, freeze: 2 } });
  // 1 · Audio: se activa desde el panel de ajustes, como lo haría el usuario.
  await page.locator('#flipSettingsTrigger').click();
  await page.locator('[data-audio-mode="on"]').click();
  await page.evaluate(() => _toggleFlipSettings(false));
  await page.locator('.cam-family-trigger').click();
  await page.locator('#camFamilyTray [data-family="AUTO03"]').click();
  await page.locator(MODE).click();                       // FOTO → VIDEO
  const withAudio = await record(page, 3000, 'video-con-audio');
  let info = probe(withAudio);
  const video = info.streams.find(s => s.codec_type === 'video'), audio = info.streams.find(s => s.codec_type === 'audio');
  assert.ok(audio, 'el vídeo lleva pista de audio');
  const duration = Number(info.format.duration);
  assert.ok(duration > 2.4 && duration < 4.2, 'duración ' + duration);
  assert.ok(Number(video.nb_read_frames) >= 45, 'cuadros ' + video.nb_read_frames);
  // La pista no está vacía: el micrófono simulado de Chrome emite pitidos.
  const heard = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', withAudio, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const meanVolume = Number((heard.match(/mean_volume: (-?[\d.]+) dB/) || [])[1]);
  assert.ok(meanVolume > -60, 'nivel de audio ' + meanVolume + ' dB');
  step('vídeo con audio', { codec: video.codec_name + '+' + audio.codec_name, size: video.width + 'x' + video.height, frames: Number(video.nb_read_frames), duration: +duration.toFixed(2), channels: audio.channels, meanVolume });
  await page.locator('#flipSettingsTrigger').click();
  await page.locator('[data-audio-mode="off"]').click();
  await page.evaluate(() => _toggleFlipSettings(false));
  const mic = await page.evaluate(() => window.__flipSceneCameraState.audioLive);
  step('micrófono tras grabar', { audioLive: mic });

  // 2 · NIGHT: visor frente a vídeo.
  await page.locator('#camVariantPill [data-variant="NIGHT"]').click();
  await page.waitForTimeout(1500);
  const nightVisor = await page.evaluate(() => { const s = FlipKit.stats(display, [0.25, 0.25, 0.5, 0.5]); return { luma: Array.from(FlipKit.luma(display, null, [64, 48])), rg: s.r / s.g, bg: s.b / s.g }; });
  const nightVideo = await record(page, 2200, 'video-night');
  const nightFrame = await measure(page, frameAt(nightVideo, 1.2, 'video-night-cuadro'), [64, 48]);
  const nightMatch = await correlate(page, nightVisor.luma, nightFrame.luma);
  assert.ok(nightMatch > 0.9, 'NIGHT: el vídeo coincide con el visor ' + nightMatch);
  assert.ok(Math.abs(nightFrame.rg - nightVisor.rg) < 0.08 && Math.abs(nightFrame.bg - nightVisor.bg) < 0.08, 'NIGHT: mismo tinte en el vídeo');
  step('NIGHT visor ↔ vídeo', { corr: +nightMatch.toFixed(3), visor: [+nightVisor.rg.toFixed(2), +nightVisor.bg.toFixed(2)], video: [+nightFrame.rg.toFixed(2), +nightFrame.bg.toFixed(2)], size: nightFrame.width + 'x' + nightFrame.height });
  // Foto NIGHT frente al visor.
  await page.locator(MODE).click();                       // VIDEO → FOTO
  const nightPhoto = await measure(page, await download(page, () => page.locator(SNAP).click(), 'foto-night'), [64, 48]);
  const photoMatch = await correlate(page, nightVisor.luma, nightPhoto.luma);
  assert.ok(photoMatch > 0.9, 'NIGHT: la foto coincide con el visor ' + photoMatch);
  step('NIGHT visor ↔ foto', { corr: +photoMatch.toFixed(3), size: nightPhoto.width + 'x' + nightPhoto.height });

  // 3 · VECTOR: visor frente a vídeo y foto.
  await page.evaluate(() => { window.__flipSceneCamera.scene = 'cup'; window.__flipSceneCamera.freeze = 0; });
  await page.locator('.cam-family-trigger').click();
  await page.locator('#camFamilyTray [data-family="OSCAM"]').click();
  await page.waitForTimeout(1200);
  const vectorVisor = await page.evaluate(() => Array.from(FlipKit.luma(display, null, [128, 96])));
  const vectorPhoto = await measure(page, await download(page, () => page.locator(SNAP).click(), 'foto-vector'), [128, 96]);
  const vectorPhotoMatch = await correlate(page, vectorVisor, vectorPhoto.luma);
  assert.ok(vectorPhotoMatch > 0.8, 'VECTOR: la foto coincide con el visor ' + vectorPhotoMatch);
  await page.locator(MODE).click();
  const vectorVideo = await record(page, 2000, 'video-vector');
  const vectorFrame = await measure(page, frameAt(vectorVideo, 1.0, 'video-vector-cuadro'), [128, 96]);
  const vectorMatch = await correlate(page, vectorVisor, vectorFrame.luma);
  assert.ok(vectorMatch > 0.8, 'VECTOR: el vídeo coincide con el visor ' + vectorMatch);
  await page.locator(MODE).click();
  step('VECTOR visor ↔ foto y vídeo', { photo: +vectorPhotoMatch.toFixed(3), video: +vectorMatch.toFixed(3) });

  // 4 · EDIT: importa la foto y el vídeo de CAM y exporta.
  await page.locator('#modulePicker').selectOption('edit');
  await page.setInputFiles('#editFileInput', path.join(out, 'foto-night.jpg'));
  await page.waitForTimeout(900);
  const editPhoto = await measure(page, await download(page, () => page.locator('#btnEditSnap').click(), 'edit-desde-foto'), [64, 48]);
  assert.ok(editPhoto.rg < 0.9, 'EDIT exporta la foto importada (conserva el tinte): ' + editPhoto.rg);
  await page.setInputFiles('#editFileInput', withAudio);
  await page.waitForTimeout(1500);
  const editVideo = await measure(page, await download(page, () => page.locator('#btnEditSnap').click(), 'edit-desde-video'), [64, 48]);
  const flat = Math.max(...editVideo.luma) - Math.min(...editVideo.luma);
  assert.ok(flat > 20, 'EDIT dibuja el vídeo importado');
  step('EDIT importa y exporta', { photo: editPhoto.width + 'x' + editPhoto.height, video: editVideo.width + 'x' + editVideo.height });
  assert.deepEqual(errors, [], 'errores de página');
  await context.close();
}

// Servidor propio cuyo contenido cambia de la alfa anterior a la actual en el mismo origen.
function serve(getRoot) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.otf': 'font/otf' };
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(req.url.split('?')[0]);
    if (file === '/') file = '/index.html';
    fs.readFile(path.join(getRoot(), file), (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
async function serviceWorkerUpdate(browser) {
  const repo = path.join(__dirname, '..');
  const previous = fs.mkdtempSync(path.join(os.tmpdir(), 'flip-old-'));
  execFileSync('sh', ['-c', `git -C "${repo}" archive ${oldRef} docs | tar -x -C "${previous}"`]);
  let root = path.join(previous, 'docs');
  const server = await serve(() => root);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext(PIXEL);
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const before = await page.evaluate(async () => ({ caches: await caches.keys(), night: typeof nightVision !== 'undefined' }));
    assert.equal(before.night, false, 'se parte de la alfa anterior');
    // Se publica la alfa nueva. Quien llega con la anterior instalada ve primero su copia en caché
    // (la sirve el service worker viejo); la nueva se instala detrás y toma el control sin esperar
    // a que se cierren las pestañas. La siguiente apertura ya es la alfa nueva.
    root = path.join(repo, 'docs');
    await page.reload();
    const firstOpen = await page.evaluate(() => typeof nightVision === 'undefined' ? 'alfa anterior' : 'alfa nueva');
    const installed = () => page.evaluate(async previous => {
      const names = await caches.keys();
      const registration = await navigator.serviceWorker.getRegistration();
      return names.length === 1 && names[0] !== previous && !!registration.active && registration.active.state === 'activated' && !registration.waiting;
    }, before.caches[0]);
    const began = Date.now();
    while (!(await installed()) && Date.now() - began < 30000) await page.waitForTimeout(200);
    assert.ok(await installed(), 'la alfa nueva se instala sola con la anterior abierta');
    const installMs = Date.now() - began;
    await page.reload();
    await page.waitForFunction(() => typeof nightVision !== 'undefined', null, { timeout: 10000 });
    const after = await page.evaluate(async () => ({ caches: await caches.keys(), splash: !splash.classList.contains('hidden'), gate: !!document.getElementById('cameraGate') }));
    assert.equal(after.caches.length, 1, 'queda una sola caché: ' + after.caches);
    assert.notDeepEqual(after.caches, before.caches);
    assert.ok(after.splash && after.gate, 'la portada es la de la alfa nueva');
    // Y sigue arrancando sin red con la versión nueva.
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => typeof nightVision !== 'undefined');
    await context.setOffline(false);
    step('actualización desde la alfa anterior', { ref: oldRef, antes: before.caches, despues: after.caches, primeraApertura: firstOpen, instalacionMs: installMs, siguienteApertura: 'alfa nueva' });
  } finally {
    await context.close();
    server.close();
  }
}

async function main() {
  const browser = await launch();
  try {
    if (!process.argv.includes('--only-update')) await cameraMedia(browser);
    await serviceWorkerUpdate(browser);
    console.log('PASS · alpha media · archivos en ' + out);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
