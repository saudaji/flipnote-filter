// Recorridos de la alfa en un Pixel emulado con cámara simulada (tests/lib/scene-camera.js):
// permiso denegado y recuperado, foto y vídeo desde los controles visibles, archivo
// exportado comprobado con ffprobe, doble disparo, grabar y parar al instante, cambio de
// cámara, cambios rápidos de modo, segundo plano, rotación y pantalla pequeña.
//   FLIP_URL=http://127.0.0.1:8760 node tests/alpha-flows.cjs [carpeta-de-salida]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, openFlip, probe, openModule } = require('./lib/harness.cjs');

const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'flip-flows-')));
fs.mkdirSync(out, { recursive: true });
// Controles visibles de la barra inferior de CAM: modo foto/vídeo y disparador.
const SNAP = '#deckShutter', MODE = '#deckModeSwitch';
const log = [];
const step = (name, detail) => { log.push({ name, detail }); console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : '')); };

async function download(page, action, name) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), action()]);
  const target = path.join(out, name + path.extname(file.suggestedFilename()));
  await file.saveAs(target);
  return target;
}
const cam = page => page.evaluate(() => ({ ...window.__flipSceneCameraState, stream: !!stream, video: vid.videoWidth, gate: !document.getElementById('cameraGate').hidden, gateTitle: document.getElementById('cameraGateTitle').textContent }));
async function setVisibility(page, state) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function main() {
  const browser = await launch();
  try {
    // ── 1 · Primera visita: permiso denegado, la puerta explica y permite recuperar ──
    const { page, errors } = await openFlip(browser, { boot: false, sceneCamera: { scene: 'roomLit', w: 1280, h: 720, torch: true, deny: 1 } });
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => !document.getElementById('cameraGate').hidden);
    let state = await cam(page);
    assert.equal(state.denied, 1);
    assert.equal(state.gateTitle, 'Cámara bloqueada');
    await page.locator(SNAP).click();   // disparar sin cámara no rompe nada
    await page.locator('#btnCameraGate').click();
    await page.waitForFunction(() => vid.videoWidth > 0 && document.getElementById('cameraGate').hidden);
    state = await cam(page);
    assert.equal(state.live, 1);
    step('permiso denegado y recuperado', { denied: state.denied, opens: state.opens });

    // ── 2 · Foto desde SNAP: archivo JPEG que coincide con el visor ──
    await page.waitForTimeout(700);
    const visor = await page.evaluate(() => Array.from(FlipKit.luma(display, null, [64, 48])));
    const photo = await download(page, () => page.locator(SNAP).click(), 'foto-dsi');
    const shot = probe(photo).streams[0];
    assert.ok(shot.width >= 640 && shot.height >= 480, 'foto ' + shot.width + 'x' + shot.height);
    const match = await page.evaluate(async ({ bytes, visor }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return FlipKit.correlation(Float32Array.from(visor), FlipKit.luma(canvas, null, [64, 48]));
    }, { bytes: fs.readFileSync(photo).toString('base64'), visor });
    assert.ok(match > 0.8, 'la foto coincide con el visor: ' + match);
    step('foto exportada', { size: shot.width + 'x' + shot.height, visor: +match.toFixed(3) });

    // ── 3 · Doble disparo: dos toques seguidos no pierden ni corrompen la toma ──
    const downloads = [];
    const collect = d => downloads.push(d);
    page.on('download', collect);
    await page.locator(SNAP).dblclick();
    await page.waitForTimeout(1500);
    page.off('download', collect);
    assert.ok(downloads.length >= 1 && downloads.length <= 2, 'doble disparo → ' + downloads.length + ' archivos');
    step('doble disparo', { files: downloads.length });

    // ── 4 · Vídeo: grabar 2,5 s, parar, abrir el archivo ──
    await page.locator(MODE).click();            // FOTO → VIDEO
    await page.locator(SNAP).click();           // REC
    await page.waitForFunction(() => recorder && recorder.state === 'recording');
    await page.waitForTimeout(2500);
    const video = await download(page, () => page.locator(SNAP).click(), 'video-dsi');
    const info = probe(video);
    const track = info.streams.find(s => s.codec_type === 'video');
    const frames = Number(track.nb_read_frames);
    const duration = Number(info.format.duration) || 0;
    assert.ok(frames >= 10, 'cuadros grabados: ' + frames);
    step('vídeo exportado', { file: path.basename(video), codec: track.codec_name, size: track.width + 'x' + track.height, frames, duration, audio: info.streams.some(s => s.codec_type === 'audio') });
    await page.waitForFunction(() => !recorder);

    // ── 5 · Grabar y parar al instante: o guarda un archivo válido o avisa, nunca se queda colgada ──
    const quick = [];
    const onQuick = d => quick.push(d);
    page.on('download', onQuick);
    await page.locator(SNAP).click();
    await page.locator(SNAP).click();
    await page.waitForFunction(() => !recorder || recorder.state === 'inactive', null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    page.off('download', onQuick);
    const idle = await page.evaluate(() => ({ recorder: !!recorder, recording: document.getElementById('btnCapture').classList.contains('recording') }));
    assert.deepEqual(idle, { recorder: false, recording: false });
    step('grabar y parar al instante', { files: quick.length });
    await page.locator(MODE).click();            // vuelve a FOTO

    // ── 6 · Cámara trasera/frontal: una sola cámara viva tras cada cambio ──
    const flip = async () => {
      const before = (await cam(page)).opens;
      await page.locator('#deckFlip').click();
      await page.waitForFunction(n => window.__flipSceneCameraState.opens > n && !cameraRequest && vid.videoWidth > 0, before);
    };
    await flip();
    state = await cam(page);
    assert.equal(state.live, 1, 'una cámara viva');
    const facing = state.facing.slice(-2);
    assert.notEqual(facing[0], facing[1], 'cambia de cámara');
    step('cambio de cámara', { facing });
    // Un teléfono que no abre dos cámaras a la vez (visto en un Samsung): el cambio suelta la
    // actual y reintenta; a partir de ahí la suelta siempre antes y ya no hay intento fallido.
    await page.evaluate(() => { window.__flipSceneCamera.exclusive = true; });
    await flip();
    state = await cam(page);
    assert.equal(state.live, 1, 'una cámara viva tras el cambio con cámara exclusiva');
    assert.equal(state.busy, 1, 'un intento fallido, y se recupera');
    assert.notEqual(state.facing.slice(-2)[0], state.facing.slice(-2)[1], 'cambia de cámara aunque no pueda abrir dos');
    assert.equal(await page.evaluate(() => localStorage.getItem('flip.cam.serial')), '1', 'el teléfono queda anotado');
    await flip();
    state = await cam(page);
    assert.equal(state.busy, 1, 'el segundo cambio ya no falla ni una vez');
    assert.equal(state.live, 1);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.flip-toast')].some(t => /video source/i.test(t.textContent))), false, 'sin aviso de error');
    await page.evaluate(() => { window.__flipSceneCamera.exclusive = false; localStorage.removeItem('flip.cam.serial'); camSerialSwitch = false; });
    step('cambio de cámara en un teléfono de cámara exclusiva', { busy: state.busy });

    // ── 7 · NIGHT y FLASH desde los controles; el LED solo se enciende al disparar en FLASH ──
    if (facing[1] !== 'environment') await flip();
    await page.locator('#deckLooks [data-family="AUTO03"]').click();
    await page.locator('#deckVariants [data-variant="NIGHT"]').click();
    const hint = await page.locator('.flip-toast').last().textContent();
    assert.match(hint, /no usa infrarrojo/);
    await page.waitForTimeout(900);
    const night = await download(page, () => page.locator(SNAP).click(), 'foto-night');
    const tint = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const s = FlipKit.stats(canvas, [0.3, 0.3, 0.4, 0.4]);
      return { rg: s.r / s.g, bg: s.b / s.g, mean: s.mean };
    }, fs.readFileSync(night).toString('base64'));
    assert.ok(tint.rg < 0.85 && tint.bg > 0.85, 'la foto NIGHT conserva el tinte: ' + JSON.stringify(tint));
    await page.locator('#deckVariants [data-variant="FLASH"]').click();
    await page.waitForTimeout(300);
    await download(page, () => page.locator(SNAP).click(), 'foto-flash');
    state = await cam(page);
    assert.deepEqual(state.torch, [true, false], 'LED: encender y apagar');
    step('NIGHT y FLASH', { tint: { rg: +tint.rg.toFixed(2), bg: +tint.bg.toFixed(2) }, torch: state.torch });

    // ── 7b · AJUSTES: el botón de la pantalla abre la hoja, la hoja aguanta el uso y LISTO la cierra ──
    const sheetOpen = () => page.evaluate(() => document.body.classList.contains('cam-edit-open') && getComputedStyle(document.getElementById('palettes')).display !== 'none');
    const opened = [];
    for (const family of await page.evaluate(() => Object.keys(CAM_FAMILIES))) {
      await page.locator('#deckLooks [data-family="' + family + '"]').click();
      await page.locator('#deckAdjust').click();
      assert.ok(await sheetOpen(), 'AJUSTES no abre la hoja en ' + family);
      // Tocar dentro de la hoja (título y primer deslizador a la vista) no la cierra.
      await page.locator('#camEditTitle').click();
      const slider = page.locator('#palettes input[type="range"]:visible').first();
      if (await slider.count()) await slider.click();
      assert.ok(await sheetOpen(), 'la hoja de ' + family + ' se cierra al usarla');
      await page.locator('#btnCamEditClose').click();
      assert.equal(await sheetOpen(), false, 'LISTO no cierra la hoja en ' + family);
      opened.push(family);
    }
    await page.locator('#deckLooks [data-family="AUTO03"]').click();
    step('ajustes de cada cámara', { abre: opened.length });

    // ── 8 · Cambios rápidos de familia, variante y módulo ──
    const families = await page.evaluate(() => Object.keys(CAM_FAMILIES));
    for (let round = 0; round < 2; round++) {
      for (const family of families) {
        await page.evaluate(f => { _setCamFamily(f); const v = CAM_FAMILIES[f].variants; camVariant = v[v.length - 1].id; _applyCamState(); }, family);
        await page.waitForTimeout(40);
      }
    }
    for (const tab of ['ascii', 'sono', 'wmp', 'scrash', 'fusion', 'sflow', 'edit', 'stage', 'cam']) {
      await openModule(page, tab);
      await page.waitForTimeout(120);
    }
    // Los módulos de audio sueltan la cámara; FLOW la recupera y arranca solo, sin pulsar nada.
    await openModule(page, 'sono');
    await page.waitForFunction(() => window.__flipSceneCameraState.live === 0);
    await openModule(page, 'sflow');
    await page.waitForFunction(() => window.__flipSceneCameraState.live === 1 && document.getElementById('sflowCanvas').width > 0, null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    // Los ajustes de FLOW vienen plegados y su botón los abre y los vuelve a plegar.
    const flowHud = () => page.evaluate(() => getComputedStyle(document.getElementById('sflowHUD')).display !== 'none');
    assert.equal(await flowHud(), false, 'los ajustes de FLOW empiezan plegados');
    await page.locator('#sflowAdjust').click();
    assert.ok(await flowHud(), 'AJUSTES no abre los ajustes de FLOW');
    await page.locator('#sflowAdjust').click();
    assert.equal(await flowHud(), false, 'AJUSTES no pliega los ajustes de FLOW');
    const flow = await page.evaluate(() => FlipKit.stats(document.getElementById('sflowCanvas')).std);
    assert.ok(flow > 2, 'FLOW dibuja con la cámara de la app: σ ' + flow);
    await openModule(page, 'cam');
    await page.evaluate(() => { _setCamFamily('DSI'); });
    await page.waitForFunction(() => _camLoopAlive && vid.videoWidth > 0);
    state = await cam(page);
    assert.equal(state.live, 1, 'tras los cambios queda una cámara viva: ' + state.live);
    step('cambios rápidos de modo', { opens: state.opens, live: state.live });

    // ── 9 · Segundo plano: suelta cámara y cierra la toma; al volver recupera ──
    await page.locator(MODE).click();
    await page.locator(SNAP).click();
    await page.waitForFunction(() => recorder && recorder.state === 'recording');
    await page.waitForTimeout(1200);
    const parked = page.waitForEvent('download', { timeout: 20000 });
    await setVisibility(page, 'hidden');
    await page.waitForFunction(() => !stream);
    state = await cam(page);
    assert.equal(state.live, 0, 'cámara liberada en segundo plano');
    await page.waitForTimeout(800);
    await setVisibility(page, 'visible');
    const saved = await parked;
    const parkedFile = path.join(out, 'video-segundo-plano' + path.extname(saved.suggestedFilename()));
    await saved.saveAs(parkedFile);
    assert.ok(Number(probe(parkedFile).streams.find(s => s.codec_type === 'video').nb_read_frames) >= 5, 'la toma interrumpida se conserva');
    await page.waitForFunction(() => vid.videoWidth > 0 && !!stream);
    state = await cam(page);
    assert.equal(state.live, 1, 'cámara recuperada al volver');
    await page.locator(MODE).click();
    step('segundo plano y regreso', { live: state.live, file: path.basename(parkedFile) });

    // ── 10 · Rotación y pantalla pequeña: los controles siguen a la vista y sin solaparse ──
    const layout = async (width, height) => {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(500);
      return page.evaluate(() => {
        const box = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
        const need = { snap: box('#deckShutter'), looks: box('#deckLooks'), variants: box('#deckVariants'), visor: box('#display'), flip: box('#deckFlip'), modules: box('#shellModule'), ajustes: box('#shellSettings') };
        const inside = Object.fromEntries(Object.entries(need).map(([k, b]) => [k, !!b && b.w > 20 && b.h > 20 && b.x >= -1 && b.y >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1]));
        const overlap = (a, b) => a && b && a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;
        const controls = ['snap', 'looks', 'variants', 'flip', 'modules', 'ajustes'];
        const collisions = [];
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) if (overlap(need[controls[i]], need[controls[j]])) collisions.push(controls[i] + '×' + controls[j]);
        const overVisor = controls.filter(name => overlap(need[name], need.visor));
        return { inside, collisions, overVisor, visorArea: Math.round(need.visor.w * need.visor.h), view: [innerWidth, innerHeight] };
      });
    };
    // Pixel 10 Pro XL con barra de direcciones, teléfono pequeño y horizontal.
    const portrait = await layout(395, 741), small = await layout(360, 640), landscape = await layout(880, 396);
    for (const [name, l] of [['vertical', portrait], ['pequeña', small], ['horizontal', landscape]]) {
      assert.ok(Object.values(l.inside).every(Boolean), name + ': controles fuera de pantalla ' + JSON.stringify(l.inside));
      assert.deepEqual(l.collisions, [], name + ': mandos encimados');
      assert.deepEqual(l.overVisor, [], name + ': mandos sobre el visor');
      assert.ok(l.visorArea > 30000, name + ': el visor queda demasiado pequeño: ' + l.visorArea);
    }
    await page.setViewportSize({ width: 395, height: 741 });
    step('rotación y pantalla pequeña', { small: small.visorArea, landscape: landscape.visorArea });

    // ── 11 · Salir: ninguna pista viva al cerrar ──
    await page.evaluate(() => { releaseCamera(); });
    state = await cam(page);
    assert.equal(state.live, 0);
    assert.equal(state.audioLive, 0, 'micrófono liberado');
    step('cámara y micrófono liberados', { live: state.live, audio: state.audioLive });

    assert.deepEqual(errors, [], 'errores de página');
    fs.writeFileSync(path.join(out, 'alpha-flows.json'), JSON.stringify(log, null, 1));
    console.log('PASS · alpha flows · archivos en ' + out);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
