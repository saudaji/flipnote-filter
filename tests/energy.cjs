// Dónde se va el trabajo. Recorre los módulos con la cámara simulada y, de cada uno, mide durante
// unos segundos: CPU del proceso de la página y del proceso de gráficos (segundos de CPU por
// segundo de reloj: 1,00 = un núcleo entero), tiempo del hilo principal, llamadas de animación y
// de temporizador por segundo y de quién son, cuadros que pinta cada motor, cuadros que entrega la
// cámara, mensajes a los hilos de trabajo, contextos de audio y de WebGL vivos y animaciones de CSS
// en marcha. No mide temperatura (eso es del teléfono: tests/device/pixel-heat.cjs); sirve para
// ver qué corre sin hacer falta y para comparar antes y después de un cambio.
//   FLIP_URL=http://127.0.0.1:8760 node tests/energy.cjs [--seconds 6] [--fps 30] [--hz 120] [--only cam,portal] [--grano no] [--json salida.json]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launch, PIXEL, URL } = require('./lib/harness.cjs');

const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const seconds = Number(arg('--seconds', 6)), camFps = Number(arg('--fps', 30));
const only = arg('--only', '') ? arg('--only', '').split(',') : null;
const hz = Number(arg('--hz', 0));

// Se inyecta antes que la app: cuenta sin cambiar lo que la app hace.
function instrument() {
  const E = window.__energy = { raf: 0, rafBy: {}, timers: 0, timerBy: {}, workers: [], toWorkers: 0, fromWorkers: 0, audio: [], gl: 0, frames: {} };
  // --hz 120: la página cree estar en una pantalla de 120 Hz (un Pixel). Los refrescos los da un
  // reloj propio; sirve para contar cuántas veces se despierta y dibuja cada bucle, no para medir GPU.
  if (window.__energyHz) {
    const period = 1000 / window.__energyHz, timeout = window.setTimeout.bind(window);
    let queue = new Map(), id = 0, armed = false, next = performance.now();
    const pump = () => {
      armed = false;
      const run = queue; queue = new Map();
      const now = performance.now();
      for (const fn of run.values()) { try { fn(now); } catch (error) { timeout(() => { throw error; }, 0); } }
    };
    const arm = () => { if (armed) return; armed = true; const now = performance.now(); next = Math.max(next + period, now + 0.5); if (next - now > period * 2) next = now + period; timeout(pump, next - now); };
    window.requestAnimationFrame = fn => { queue.set(++id, fn); arm(); return id; };
    window.cancelAnimationFrame = handle => { queue.delete(handle); };
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (fn) {
    return raf(function (t) { E.raf++; E.tick++; const n = (fn && fn.__name) || (fn && fn.name) || 'anónima'; E.rafBy[n] = (E.rafBy[n] || 0) + 1; return fn(t); });
  };
  for (const kind of ['setInterval', 'setTimeout']) {
    const real = window[kind].bind(window);
    window[kind] = function (fn, ms, ...rest) {
      if (typeof fn !== 'function') return real(fn, ms, ...rest);
      const tag = kind === 'setInterval' ? 'cada ' + (ms | 0) + ' ms' : 'espera';
      return real(function () { E.timers++; E.tick++; E.timerBy[tag] = (E.timerBy[tag] || 0) + 1; return fn.apply(this, arguments); }, ms, ...rest);
    };
  }
  // Cuadros dibujados de verdad en cada lienzo a la vista: vueltas distintas en las que se pintó.
  E.tick = 0; E.canvas = {};
  const touch = canvas => {
    if (!canvas || !canvas.id || !canvas.isConnected) return;
    const entry = E.canvas[canvas.id] || (E.canvas[canvas.id] = { last: -1, n: 0 });
    if (entry.last !== E.tick) { entry.last = E.tick; entry.n++; }
  };
  for (const name of ['drawImage', 'putImageData', 'fillRect', 'fillText', 'stroke', 'fill']) {
    const real = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function () { touch(this.canvas); return real.apply(this, arguments); };
  }
  for (const GL of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!GL) continue;
    for (const name of ['drawArrays', 'drawElements']) {
      const real = GL.prototype[name];
      GL.prototype[name] = function () { touch(this.canvas); return real.apply(this, arguments); };
    }
  }
  const RealWorker = window.Worker;
  window.Worker = function (url, options) {
    const worker = new RealWorker(url, options);
    const entry = { url: String(url).split('/').pop().split('?')[0], alive: true };
    E.workers.push(entry);
    const post = worker.postMessage.bind(worker);
    worker.postMessage = function () { E.toWorkers++; return post.apply(null, arguments); };
    worker.addEventListener('message', () => { E.fromWorkers++; });
    const stop = worker.terminate.bind(worker);
    worker.terminate = function () { entry.alive = false; return stop(); };
    return worker;
  };
  window.Worker.prototype = RealWorker.prototype;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Real = window[name];
    if (!Real) continue;
    window[name] = function (options) { const ctx = new Real(options); E.audio.push(ctx); return ctx; };
    window[name].prototype = Real.prototype;
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    const ctx = getContext.apply(this, arguments);
    if (ctx && /webgl/.test(type) && !this.__counted) { this.__counted = true; E.gl++; }
    return ctx;
  };
}

async function main() {
  const browser = await launch();
  const rows = [];
  try {
    const context = await browser.newContext({ ...PIXEL, acceptDownloads: true });
    if (hz) await context.addInitScript(value => { window.__energyHz = value; }, hz);
    if (arg('--grano', '') === 'no') await context.addInitScript(() => { try { localStorage.setItem('flip.rollo.grano', 'no'); } catch (_) {} });
    await context.addInitScript(instrument);
    await context.addInitScript({ path: path.join(__dirname, 'scenes.js') });
    await context.addInitScript({ path: path.join(__dirname, 'lib', 'page-kit.js') });
    await context.addInitScript(config => { window.__flipSceneCamera = config; }, { scene: 'roomLit', w: 1280, h: 720, fps: camFps, freeze: 2 });
    await context.addInitScript({ path: path.join(__dirname, 'lib', 'scene-camera.js') });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error && error.message || error)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const sys = await browser.newBrowserCDPSession();
    await page.goto(URL);
    await page.locator('#btnSplashOriginal').click();
    await page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    // Cuenta por motor: cada bucle de la app pasa por scheduleFrame; los motores, por sus funciones de dibujo.
    await page.evaluate(() => {
      const E = window.__energy, count = name => { E.frames[name] = (E.frames[name] || 0) + 1; };
      const schedule = scheduleFrame;
      scheduleFrame = function (loop) { if (loop && !loop.__tagged) { loop.__tagged = true; } count('agenda:' + ((loop && loop.name) || 'anónima')); return schedule.apply(this, arguments); };
      const render = _renderCamEngineFrame;
      _renderCamEngineFrame = function (...args) { count('motor:' + ((args[5] && args[5].path) || '?')); return render.apply(this, args); };
      const portal = flipPortal.render;
      flipPortal.render = function () { count('portal'); return portal.apply(this, arguments); };
      const tick = () => { count('cámara'); vid.requestVideoFrameCallback(tick); };
      if (vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(tick);
    });
    const cpu = async () => {
      const { processInfo } = await sys.send('SystemInfo.getProcessInfo');
      const sum = type => processInfo.filter(p => p.type === type).reduce((a, p) => a + p.cpuTime, 0);
      const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      return { renderer: sum('renderer'), gpu: sum('GPU'), browser: sum('browser'), task: metrics.TaskDuration, script: metrics.ScriptDuration, layout: metrics.LayoutDuration + metrics.RecalcStyleDuration };
    };
    const snapshot = () => page.evaluate(() => {
      const E = window.__energy;
      return {
        raf: E.raf, rafBy: { ...E.rafBy }, timers: E.timers, timerBy: { ...E.timerBy }, toWorkers: E.toWorkers, fromWorkers: E.fromWorkers, frames: { ...E.frames },
        canvas: Object.fromEntries(Object.entries(E.canvas).map(([id, entry]) => [id, entry.n])),
        workers: E.workers.filter(w => w.alive).map(w => w.url), audio: E.audio.filter(a => a.state === 'running').length, audioAll: E.audio.filter(a => a.state !== 'closed').length, gl: E.gl,
        animations: document.getAnimations().filter(a => a.playState === 'running').map(a => { const t = a.effect && a.effect.target; return (t ? (t.id ? '#' + t.id : t.tagName.toLowerCase() + (t.classList[0] ? '.' + t.classList[0] : '')) : '?') + ':' + (a.animationName || a.transitionProperty || 'anim'); }),
        stage: typeof flipStage !== 'undefined' ? flipStage.status().fps : 0, stageOn: typeof flipStage !== 'undefined' && flipStage.status().active,
        portal: typeof flipPortal !== 'undefined' ? { ...flipPortal.status() } : null, camera: stream ? stream.getVideoTracks().map(t => t.readyState).join(',') : 'sin cámara',
        hidden: document.hidden,
      };
    });
    const measure = async (name, settle = 1600) => {
      await page.waitForTimeout(settle);
      const a = await snapshot(), ca = await cpu(), t0 = Date.now();
      await page.waitForTimeout(seconds * 1000);
      const b = await snapshot(), cb = await cpu(), dt = (Date.now() - t0) / 1000;
      const per = (x, y) => +((y - x) / dt).toFixed(2);
      const diff = (x, y) => Object.fromEntries(Object.keys(y).map(k => [k, +(((y[k] || 0) - (x[k] || 0)) / dt).toFixed(1)]).filter(e => e[1] > 0.05).sort((p, q) => q[1] - p[1]));
      const row = {
        name, pagina: per(ca.renderer, cb.renderer), graficos: per(ca.gpu, cb.gpu), navegador: per(ca.browser, cb.browser), hilo: per(ca.task, cb.task), script: per(ca.script, cb.script), estilo: per(ca.layout, cb.layout),
        raf: per(a.raf, b.raf), timers: per(a.timers, b.timers), aTrabajo: per(a.toWorkers, b.toWorkers), frames: diff(a.frames, b.frames), rafBy: diff(a.rafBy, b.rafBy), timerBy: diff(a.timerBy, b.timerBy),
        lienzos: diff(a.canvas, b.canvas),
        workers: b.workers, audio: b.audio + '/' + b.audioAll, gl: b.gl, animations: b.animations, stage: b.stageOn ? b.stage : 0,
        portal: b.portal && b.portal.active ? { fase: b.portal.phase, delegado: b.portal.delegate } : null, camera: b.camera,
      };
      rows.push(row);
      const f = row.frames;
      const top = Object.entries(row.lienzos)[0] || ['—', 0];
      console.log(name.padEnd(26), 'página', String(row.pagina.toFixed(2)).padStart(5), ' gráficos', String(row.graficos.toFixed(2)).padStart(5), ' hilo', String(row.hilo.toFixed(2)).padStart(5),
        ' rAF/s', String(Math.round(row.raf)).padStart(4), ' temp/s', String(Math.round(row.timers)).padStart(3), ' →hilos/s', String(Math.round(row.aTrabajo)).padStart(3),
        ' motor/s', String(Math.round((f['motor:preview'] || 0) + (f['motor:capture'] || 0))).padStart(3), ' portal/s', String(Math.round(f.portal || 0)).padStart(3), ' stage', String(Math.round(row.stage)).padStart(3),
        ' cámara/s', String(Math.round(f['cámara'] || 0)).padStart(3), ' dibujo/s', String(Math.round(top[1])).padStart(3), ('(' + top[0] + ')').padEnd(16), ' hilos', row.workers.length, ' audio', row.audio, ' gl', row.gl, row.animations.length ? ' anim ' + row.animations.length : '');
      return row;
    };
    const pick = async (family, variant) => { await page.evaluate(([f, v]) => { _setCamFamily(f); if (v && camVariant !== v) { camVariant = v; _applyCamState(); } }, [family, variant]); };
    const open = async key => { await page.locator('#shellModule').click(); await page.locator('#shellLauncher [data-module="' + key + '"]').click(); };
    const want = name => !only || only.some(o => name.startsWith(o));

    console.log('cámara simulada a ' + camFps + ' cuadros/s · ' + (hz ? 'pantalla simulada de ' + hz + ' Hz · ' : '') + seconds + ' s por medida · CPU en núcleos (1,00 = un núcleo entero)');
    if (want('cam')) {
      await measure('cam DSI (recién abierta)');
      for (const [family, variant] of [['PRENSA', 'ENGR'], ['AUTO03', 'NIGHT'], ['DLPHN', 'STD'], ['CASKIA', 'SEIKO'], ['VFD', 'STD'], ['VFD', 'CRT'], ['OSCAM', 'STD'], ['PRENSA', 'CMYK']]) {
        await pick(family, variant);
        await measure('cam ' + family + (variant ? ' ' + variant : ''), 1600);
      }
      await pick('DSI', 'STD');
      await page.locator('#shellSettings').click();
      await measure('cam DSI + hoja abierta');
      await page.keyboard.press('Escape');
    }
    for (const key of ['portal', 'ascii', 'sflow', 'scrash', 'fusion', 'sono', 'wmp', 'edit']) {
      if (!want(key)) continue;
      await open(key);
      await measure(key, key === 'portal' || key === 'sflow' ? 6000 : 1800);
    }
    if (want('stage')) {
      await open('stage');
      await page.waitForFunction(() => flipStage.status().active && flipStage.status().fps > 0, null, { timeout: 15000 });
      for (const scene of [0, 1, 3, 4]) {
        await page.evaluate(i => flipStage.recall(i, true), scene);
        await measure('stage ' + (await page.evaluate(() => flipStage.status().name)), scene === 3 ? 5000 : 1500);
      }
    }
    if (want('cam')) {
      await open('cam');
      await page.waitForFunction(() => activeTab === 'cam' && vid.videoWidth > 0);
      await pick('DSI', 'STD');
      await measure('cam DSI (después de todo)', 2500);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await measure('cam en segundo plano', 1500);
    }
    if (errors.length) console.log('errores de página', JSON.stringify(errors));
    const out = arg('--json', '');
    if (out) fs.writeFileSync(out, JSON.stringify({ camFps, seconds, rows }, null, 1));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
