// El vídeo que sale de FLIP tiene que poder importarse en otra app (Instagram, WhatsApp, el
// carrete). MediaRecorder lo escribe fragmentado (sin índice de cuadros) y, en muchas tomas
// largas, con duración 0 en la cabecera; docs/mp4-flat.js lo deja como un MP4 de una pieza. Aquí se graba
// con la tubería real y se comprueba el archivo que llega a Descargas:
//   · sin tramos (moof/mvex), con el índice completo y la duración verdadera en la cabecera
//   · los mismos cuadros y el mismo sonido que salieron del codificador, bit a bit
//   · tipo «video/mp4» limpio y medidas pares
//   · y que el conversor devuelve el original ante un archivo que no entiende o cortado
//   FLIP_URL=http://127.0.0.1:8760 node tests/video-file.cjs [carpeta-de-salida]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, openFlip } = require('./lib/harness.cjs');
const { inspect } = require('./lib/mp4-boxes.cjs');
const { flatten } = require('../docs/mp4-flat.js');

const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'flip-video-')));
fs.mkdirSync(out, { recursive: true });
const step = (name, detail) => console.log('✓ ' + name + (detail ? ' · ' + JSON.stringify(detail) : ''));
const packets = file => execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-map', '0', '-c', 'copy', '-f', 'framemd5', '-'], { maxBuffer: 1 << 28 })
  .toString().split('\n').filter(line => line && line[0] !== '#').map(line => line.split(',').map(cell => cell.trim()));
const streams = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration:stream=codec_type,codec_name,width,height,nb_read_packets', '-count_packets', '-of', 'json', file]).toString());

async function take(page, name, seconds) {
  await page.locator('#deckShutter').click();
  await page.waitForFunction(() => recorder && recorder.state === 'recording', null, { timeout: 15000 });
  const started = Date.now();
  await page.waitForTimeout(seconds * 1000);
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('#deckShutter').click()]);
  const wall = (Date.now() - started) / 1000;
  const saved = path.join(out, name + path.extname(file.suggestedFilename()));
  await file.saveAs(saved);
  const raw = await page.evaluate(async () => {
    const bytes = new Uint8Array(await lastBlob.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    const sealed = _flipSealed.get(lastBlob);
    return { b64: btoa(text), type: lastBlob.type, sealedType: sealed && sealed.type, sealedSize: sealed && sealed.size };
  });
  const rawFile = path.join(out, name + '-crudo.mp4');
  fs.writeFileSync(rawFile, Buffer.from(raw.b64, 'base64'));
  await page.waitForFunction(() => !recorder);
  return { saved, rawFile, raw, wall, suggested: file.suggestedFilename() };
}

function check(name, shot, wantAudio) {
  assert.match(shot.suggested, /\.mp4$/, 'se guarda como .mp4');
  assert.equal(shot.raw.sealedType, 'video/mp4', 'tipo limpio, sin coletilla de códecs');
  assert.equal(fs.statSync(shot.saved).size, shot.raw.sealedSize, 'lo descargado es la toma sellada');
  const before = inspect(shot.rawFile).info, after = inspect(shot.saved).info;
  assert.equal(before.fragmented, true, 'el grabador sigue escribiendo por tramos (si deja de hacerlo, esta prueba sobra)');
  assert.deepEqual(after.top, ['ftyp', 'moov', 'mdat'], 'una pieza: cabecera, índice y datos');
  assert.equal(after.fragmented, false);
  const probe = streams(shot.saved);
  const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264');
  assert.ok(video.width % 2 === 0 && video.height % 2 === 0, 'medidas pares: ' + video.width + '×' + video.height);
  assert.equal(!!audio, wantAudio, 'pista de sonido');
  if (audio) assert.equal(audio.codec_name, 'aac', 'el sonido va en AAC');
  for (const track of after.tracks) {
    const stream = track.handler === 'vide' ? video : audio;
    assert.equal(track.samplesInTable, Number(stream.nb_read_packets), 'índice completo de ' + track.handler);
    assert.ok(track.duration > 0, 'duración de pista');
  }
  assert.ok(Math.abs(after.mvhd.seconds - shot.wall) < 1.2, 'duración en la cabecera ≈ lo grabado: ' + after.mvhd.seconds + ' s de ' + shot.wall.toFixed(2));
  assert.ok(Math.abs(Number(probe.format.duration) - after.mvhd.seconds) < 0.05, 'cabecera y contenido coinciden');
  const a = packets(shot.rawFile), b = packets(shot.saved);
  assert.equal(a.length, b.length, 'mismo número de paquetes');
  for (let i = 0; i < a.length; i++) assert.ok(a[i][0] === b[i][0] && a[i][2] === b[i][2] && a[i][5] === b[i][5], 'paquete ' + i + ' idéntico (pista, tiempo y contenido)');
  // El arranque: la imagen empieza con el sonido (no medio segundo después) y con un solo fotograma
  // clave. Si el flujo de vídeo se abre antes de que el sonido esté listo, el grabador recibe un
  // primer cuadro suelto por otro camino: en un teléfono Chrome avisa de que «la descripción del
  // códec cambia» y el vídeo arranca tarde, con dos fotogramas clave seguidos.
  const start = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration:packet=stream_index,pts_time,flags', '-of', 'json', shot.saved], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const picture = start.streams.findIndex(s => s.codec_type === 'video'), sound = start.streams.find(s => s.codec_type === 'audio');
  const keys = start.packets.filter(p => p.stream_index === picture && /K/.test(p.flags) && Number(p.pts_time) < 0.5).length;
  const lead = Number(start.streams[picture].start_time) || 0, seconds = Number(start.streams[picture].duration);
  assert.equal(keys, 1, 'un solo fotograma clave en el arranque');
  if (sound) assert.ok(lead < 0.25 && Math.abs(seconds - Number(sound.duration)) < 0.4, 'la imagen empieza con el sonido: imagen desde ' + lead + ' s, ' + seconds + ' s de imagen y ' + sound.duration + ' s de sonido');
  execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', shot.saved, '-f', 'null', '-']);
  step(name, { arranque: lead,  antes: before.top.join(' '), cabeceraAntes: before.mvhd.seconds, ahora: after.top.join(' '), segundos: after.mvhd.seconds, paquetes: b.length, sonido: audio ? audio.codec_name : 'sin' });
}

(async () => {
  const browser = await launch();
  try {
    const { page, errors } = await openFlip(browser, { sceneCamera: { scene: 'roomLit', w: 720, h: 1280, fps: 30 } });
    await page.locator('#deckModeSwitch').click();
    check('toma corta sin sonido', await take(page, 'corta', 3.5), false);

    // Con sonido y lo bastante larga para que el grabador cierre varios tramos: es el caso en
    // que la cabecera original declara duración 0.
    await page.evaluate(() => { flipAudioSettings.audioMode = 'on'; });
    const long = await take(page, 'larga', 13);
    check('toma larga con sonido', long, true);
    // El original, según cuántos tramos haya cerrado el grabador, declara su duración o declara 0.
    // No depende de FLIP, así que solo se anota; lo que se exige es cómo queda el archivo guardado.
    const rawInfo = inspect(long.rawFile).info;
    step('el original largo, tal como lo escribe el navegador', { tramos: rawInfo.fragments, duracionDeclarada: rawInfo.mvhd.seconds, cuadrosEnElIndice: rawInfo.tracks.map(t => t.samplesInTable) });
    assert.deepEqual(errors, [], 'sin errores de página');

    // ── El conversor no pierde tomas ──
    const raw = fs.readFileSync(long.rawFile), flat = fs.readFileSync(long.saved);
    const again = await flatten(new Blob([flat], { type: 'video/mp4' }));
    assert.equal(again.info.changed, false, 'un MP4 de una pieza se deja como está');
    const junk = new Blob([Buffer.from('esto no es un vídeo, ni lo parece'.repeat(40))], { type: 'video/mp4' });
    assert.equal((await flatten(junk)).blob, junk, 'un archivo ilegible vuelve tal cual');
    // Cortado a media escritura (la página se cerró): se salva lo que esté entero.
    const cut = await flatten(new Blob([raw.subarray(0, Math.round(raw.length * 0.6))], { type: 'video/mp4' }));
    const cutFile = path.join(out, 'cortado.mp4');
    fs.writeFileSync(cutFile, Buffer.from(await cut.blob.arrayBuffer()));
    if (cut.info.changed) {
      execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', cutFile, '-f', 'null', '-']);
      assert.deepEqual(inspect(cutFile).info.top, ['ftyp', 'moov', 'mdat']);
    }
    step('conversor: deja en paz lo que ya está bien, lo ilegible y lo cortado', { cortado: cut.info.changed ? cut.info.seconds + ' s rescatados' : cut.info.reason });
    console.log('VIDEO-FILE PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error('VIDEO-FILE FAIL\n', error); process.exit(1); });
