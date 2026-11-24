// Calor en el teléfono, por módulo. Con el teléfono por USB (adb) y la pestaña de FLIP abierta
// (pixel-open.cjs), deja cada módulo en marcha el tiempo que se le diga y lee del propio teléfono:
//   · trabajo: segundos de CPU por segundo de reloj (1,00 = un núcleo entero) del teléfono entero
//     y, aparte, de la página, del proceso de gráficos de Chrome, del navegador, del servicio de
//     cámara y del compositor del sistema. Sale de /proc, contando el tramo completo;
//   · temperatura de la batería, de la piel y del chip, y estado térmico (0 = normal … 3 = severo);
//   · de la página: cuadros que dibuja cada motor, refresco de la pantalla y cámara.
// Solo lee: no cambia ningún ajuste del teléfono. Mientras mide no deja ningún bucle propio en la
// página (el refresco de la pantalla se mide en una ráfaga corta al final de cada tramo), para no
// despertarla más de lo que ella se despierta sola. Para comparar antes y después: la versión
// anterior servida en el mismo origen (adb reverse tcp:8760 tcp:<otro puerto>) y un rato de
// enfriado entre una y otra.
//   node pixel-heat.cjs [segundos por módulo = 90] [salida.json]
//   PIXEL_ONLY=cam,portal …   limita los módulos
'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const P = require('./pixel-lib.cjs');
const seconds = Number(process.argv[2] || 90), out = process.argv[3] || '';
const only = process.env.PIXEL_ONLY ? process.env.PIXEL_ONLY.split(',') : null;
const adb = args => { try { return execFileSync('adb', ['shell', ...args], { encoding: 'utf8', timeout: 15000 }); } catch (error) { return ''; } };

function temperatures() {
  const battery = adb(['dumpsys', 'battery']);
  const thermal = adb(['dumpsys', 'thermalservice']);
  const num = (text, pattern) => { const m = text.match(pattern); return m ? Number(m[1]) : null; };
  const temps = {};
  // Temperature{mValue=31.2, mType=3, mName=skin, mStatus=0} — se guardan las de ahora (tras «Current temperatures»).
  const current = thermal.split(/Current temperatures from HAL/i)[1] || thermal;
  for (const m of current.matchAll(/mValue=([\d.]+),\s*mType=(\d+),\s*mName=([^,}]+)/g)) if (!(m[3] in temps)) temps[m[3].trim()] = Number(m[1]);
  const skin = Object.entries(temps).filter(([name]) => /skin/i.test(name)).map(e => e[1]);
  const cpu = Object.entries(temps).filter(([name]) => /cpu|soc|ap\b|big|mid|little/i.test(name)).map(e => e[1]);
  return {
    bateria: (num(battery, /temperature:\s*(-?\d+)/) || 0) / 10, nivel: num(battery, /level:\s*(\d+)/),
    estado: num(thermal, /Thermal Status:\s*(\d+)/), piel: skin.length ? Math.max(...skin) : null, chip: cpu.length ? Math.max(...cpu) : null,
  };
}

// Tiempo de CPU acumulado (en tics de 10 ms) del teléfono entero y de los procesos que importan.
const WATCH = 'chrome|cameraserver|camera.provider|surfaceflinger';
function cpuTicks() {
  const text = adb([`head -1 /proc/stat; ps -A -o PID,NAME | grep -E '${WATCH}' | while read pid name; do echo "P $name $(cat /proc/$pid/stat 2>/dev/null)"; done`]);
  const sum = { at: Date.now(), sistema: 0, pagina: 0, graficos: 0, navegador: 0, camara: 0, compositor: 0 };
  for (const line of text.split('\n')) {
    if (line.startsWith('cpu ')) {
      const f = line.trim().split(/\s+/).slice(1).map(Number);          // user nice system idle iowait irq softirq steal
      sum.sistema = f[0] + f[1] + f[2] + f[5] + f[6] + (f[7] || 0);
      continue;
    }
    if (!line.startsWith('P ')) continue;
    const name = line.split(' ')[1], rest = line.slice(line.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(rest[11]) + Number(rest[12]);
    if (!Number.isFinite(ticks)) continue;
    if (/chrome.*sandboxed|chrome.*isolated/.test(name)) sum.pagina += ticks;
    else if (/chrome.*privileged/.test(name)) sum.graficos += ticks;
    else if (/chrome/.test(name)) sum.navegador += ticks;
    else if (/camera/.test(name)) sum.camara += ticks;
    else if (/surfaceflinger/.test(name)) sum.compositor += ticks;
  }
  return sum;
}
const cores = (a, b, key) => +(((b[key] - a[key]) / 100) / ((b.at - a.at) / 1000)).toFixed(2);

(async () => {
  if (!/\bdevice\b/.test(execFileSync('adb', ['devices'], { encoding: 'utf8' }).split('\n').slice(1).join('\n'))) throw new Error('no hay teléfono con depuración por USB (adb devices)');
  const page = (await P.targets()).find(t => t.type === 'page' && (!process.env.PIXEL_URL || t.url.startsWith(process.env.PIXEL_URL)));
  if (!page) throw new Error('no hay pestaña de FLIP abierta: corre antes pixel-open.cjs');
  const c = await P.connect(page);
  await c.send('Page.bringToFront').catch(() => {});
  // La pantalla no se apaga mientras se mide (se suelta al final).
  await c.evaluate(`navigator.wakeLock ? navigator.wakeLock.request('screen').then(lock => { window.__heatLock = lock; return 1; }).catch(() => 0) : 0`);
  // Contadores pasivos: cuántas veces dibuja cada motor. No añaden vueltas a la página.
  await c.evaluate(`(() => {
    if (window.__heat) return;
    const H = window.__heat = { render: [], real: _renderCamEngineFrame, draws: {}, patched: [] };
    _renderCamEngineFrame = function (...args) { const t0 = performance.now(); const r = H.real.apply(this, args); H.render.push(performance.now() - t0); return r; };
    // Un lienzo a la vista cuenta un cuadro cada vez que se le pinta en una tarea distinta.
    let stamp = 0, queued = false;
    const touch = canvas => {
      if (!canvas || !canvas.id || !canvas.isConnected) return;
      const e = H.draws[canvas.id] || (H.draws[canvas.id] = { last: -1, n: 0 });
      if (e.last !== stamp) { e.last = stamp; e.n++; }
      if (!queued) { queued = true; Promise.resolve().then(() => { queued = false; stamp++; }); }
    };
    const wrap = (proto, name) => { const real = proto[name]; proto[name] = function () { touch(this.canvas); return real.apply(this, arguments); }; H.patched.push([proto, name, real]); };
    for (const name of ['drawImage', 'putImageData', 'fillRect']) wrap(CanvasRenderingContext2D.prototype, name);
    for (const GL of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) if (GL) wrap(GL.prototype, 'drawArrays');
  })()`);
  const info = await c.evaluate(`({ url: location.origin, version: typeof cancelFrame === 'function' ? 'con ritmo nuevo' : 'sin ritmo nuevo', camara: stream ? stream.getVideoTracks()[0].getSettings() : null, pantalla: [innerWidth, innerHeight, devicePixelRatio] })`);
  console.log(JSON.stringify(info));
  const go = key => c.evaluate(`(() => { if (flipShell.module() !== ${JSON.stringify(key)}) { document.getElementById('shellModule').click(); document.querySelector('#shellLauncher [data-module="${key}"]').click(); } return true; })()`);
  const pick = (family, variant) => c.evaluate(`(() => { _setCamFamily(${JSON.stringify(family)}); if (${JSON.stringify(variant)} && camVariant !== ${JSON.stringify(variant)}) { camVariant = ${JSON.stringify(variant)}; _applyCamState(); } return true; })()`);
  const scenarios = [
    ['cam DSI', async () => { await go('cam'); await pick('DSI', 'STD'); }],
    ['cam VFD CRT', async () => { await go('cam'); await pick('VFD', 'CRT'); }],
    ['cam STAMP', async () => { await go('cam'); await pick('STAMP', 'ENGR'); }],
    ['glitch', async () => { await go('scrash'); }],
    ['fusion', async () => { await go('fusion'); }],
    ['ascii', async () => { await go('ascii'); }],
    ['flow', async () => { await go('sflow'); }],
    ['stage', async () => { await go('stage'); }],
    ['portal', async () => { await go('portal'); }],
  ].filter(([name]) => !only || only.some(o => name.startsWith(o)));
  const rows = [];
  console.log('módulo        teléfono  página  gráficos  naveg.  cámara  compos.   batería °C    piel °C    chip °C  térm.  dibujo/s  ms/cuadro  pantalla Hz  cámara/s  rastreador/s');
  for (const [name, enter] of scenarios) {
    await enter();
    await P.sleep(5000);
    await c.evaluate('(() => { const H = __heat; H.render.length = 0; for (const k in H.draws) H.draws[k].n = 0; H.frames0 = typeof flipPortal !== "undefined" ? flipPortal.status().frames : 0; H.t0 = performance.now(); })()');
    const t0 = temperatures(), c0 = cpuTicks();
    let worst = t0.estado || 0;
    for (let elapsed = 0; elapsed < seconds; elapsed += 15) { await P.sleep(Math.min(15, seconds - elapsed) * 1000); }
    const c1 = cpuTicks(), t1 = temperatures();
    worst = Math.max(worst, t1.estado || 0);
    const stats = await c.evaluate(`(() => {
      const H = __heat, dt = (performance.now() - H.t0) / 1000, sorted = Float64Array.from(H.render).sort();
      const s = typeof flipStage !== 'undefined' ? flipStage.status() : null, p = typeof flipPortal !== 'undefined' ? flipPortal.status() : null;
      const draws = Object.entries(H.draws).map(([id, e]) => [id, +(e.n / dt).toFixed(1)]).filter(e => e[1] > 0.5).sort((a, b) => b[1] - a[1]);
      return { dibujo: draws[0] || ['—', 0], motor: +(H.render.length / dt).toFixed(1), ms: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : 0, stage: s && s.active ? s.fps : 0,
        rastreador: p && p.active ? +((p.frames - H.frames0) / dt).toFixed(1) : 0, delegado: p ? p.delegate : '', camaraFps: stream ? Math.round(stream.getVideoTracks()[0].getSettings().frameRate || 0) : 0,
        modulo: flipShell.module() + (p && p.active ? ' (PORTAL activo)' : '') };
    })()`);
    // Refresco de la pantalla: una ráfaga de 40 refrescos, fuera del tramo medido.
    const hz = await c.evaluate(`new Promise(done => { const gaps = []; let last = 0, n = 0; const step = t => { if (last) gaps.push(t - last); last = t; if (++n < 40) requestAnimationFrame(step); else { gaps.sort((a, b) => a - b); done(Math.round(1000 / gaps[gaps.length >> 1])); } }; requestAnimationFrame(step); })`);
    const row = {
      name, segundos: +((c1.at - c0.at) / 1000).toFixed(1),
      telefono: cores(c0, c1, 'sistema'), pagina: cores(c0, c1, 'pagina'), graficos: cores(c0, c1, 'graficos'), navegador: cores(c0, c1, 'navegador'), camara: cores(c0, c1, 'camara'), compositor: cores(c0, c1, 'compositor'),
      bateria: [t0.bateria, t1.bateria], piel: [t0.piel, t1.piel], chip: [t0.chip, t1.chip], estado: worst, hz, ...stats,
    };
    rows.push(row);
    const span = pair => pair[0] == null ? '    —    ' : (pair[0].toFixed(1) + '→' + pair[1].toFixed(1)).padStart(10);
    const n = (value, width) => value.toFixed(2).padStart(width);
    console.log(name.padEnd(12), n(row.telefono, 9), n(row.pagina, 7), n(row.graficos, 9), n(row.navegador, 7), n(row.camara, 7), n(row.compositor, 8), ' ', span(row.bateria), span(row.piel), span(row.chip), String(row.estado).padStart(6),
      String(Math.round(row.dibujo[1])).padStart(9), String(row.ms).padStart(10), String(row.hz).padStart(12), String(row.camaraFps).padStart(9), String(row.rastreador + (row.delegado ? ' ' + row.delegado : '')).padStart(13), ' ' + row.dibujo[0]);
  }
  await c.evaluate(`(() => { const H = __heat; _renderCamEngineFrame = H.real; for (const [proto, name, real] of H.patched) proto[name] = real; delete window.__heat; if (window.__heatLock) { window.__heatLock.release(); delete window.__heatLock; } return true; })()`);
  await go('cam');
  if (out) fs.writeFileSync(out, JSON.stringify({ info, seconds, rows }, null, 1));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
