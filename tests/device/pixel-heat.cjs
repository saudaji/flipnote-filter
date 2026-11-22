// Calor en el teléfono, por módulo. Con el teléfono por USB (adb) y la pestaña de FLIP abierta
// (pixel-open.cjs), deja cada módulo en marcha el tiempo que se le diga y, mientras, lee del
// propio teléfono: temperatura de la batería y de la piel, estado térmico (0 = normal … 3 = severo),
// CPU de los procesos de Chrome (página y gráficos) y, de la página, cuadros por segundo y coste.
// Solo lee: no cambia ningún ajuste del teléfono. Para comparar antes y después, correrlo con la
// app publicada y con la copia de trabajo, dejando enfriar el teléfono entre una y otra.
//   node pixel-heat.cjs [segundos por módulo = 90] [salida.json]
//   PIXEL_ONLY=cam,portal …   limita los módulos
'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const P = require('./pixel-lib.cjs');
const seconds = Number(process.argv[2] || 90), out = process.argv[3] || '';
const only = process.env.PIXEL_ONLY ? process.env.PIXEL_ONLY.split(',') : null;
const adb = args => { try { return execFileSync('adb', ['shell', ...args], { encoding: 'utf8', timeout: 15000 }); } catch (error) { return ''; } };

function phone() {
  const battery = adb(['dumpsys', 'battery']);
  const thermal = adb(['dumpsys', 'thermalservice']);
  const num = (text, pattern) => { const m = text.match(pattern); return m ? Number(m[1]) : null; };
  const temps = {};
  // Temperature{mValue=31.2, mType=3, mName=skin, mStatus=0} — se guardan las de ahora (tras «Current temperatures»).
  const current = thermal.split(/Current temperatures from HAL/i)[1] || thermal;
  for (const m of current.matchAll(/mValue=([\d.]+),\s*mType=(\d+),\s*mName=([^,}]+)/g)) if (!(m[3] in temps)) temps[m[3].trim()] = Number(m[1]);
  const skin = Object.entries(temps).filter(([name]) => /skin/i.test(name)).map(e => e[1]);
  const cpu = Object.entries(temps).filter(([name]) => /cpu|soc|ap\b|big|mid|little/i.test(name)).map(e => e[1]);
  // CPU de Chrome: una pasada de top; la columna %CPU va delante del nombre del proceso.
  const top = adb(['top', '-b', '-n', '1', '-o', '%CPU,ARGS']);
  let page = 0, gpu = 0, browser = 0;
  for (const line of top.split('\n')) {
    const m = line.trim().match(/^([\d.]+)\s+(.*chrome.*)$/i);
    if (!m) continue;
    const use = Number(m[1]);
    if (/sandboxed|renderer|isolated/i.test(m[2])) page += use;
    else if (/privileged|gpu/i.test(m[2])) gpu += use;
    else browser += use;
  }
  return {
    bateria: (num(battery, /temperature:\s*(-?\d+)/) || 0) / 10, nivel: num(battery, /level:\s*(\d+)/),
    estado: num(thermal, /Thermal Status:\s*(\d+)/), piel: skin.length ? Math.max(...skin) : null, chip: cpu.length ? Math.max(...cpu) : null,
    cpuPagina: +page.toFixed(0), cpuGraficos: +gpu.toFixed(0), cpuNavegador: +browser.toFixed(0),
  };
}

(async () => {
  if (!/\bdevice\b/.test(execFileSync('adb', ['devices'], { encoding: 'utf8' }).split('\n').slice(1).join('\n'))) throw new Error('no hay teléfono con depuración por USB (adb devices)');
  const page = (await P.targets()).find(t => t.type === 'page' && (!process.env.PIXEL_URL || t.url.startsWith(process.env.PIXEL_URL)));
  if (!page) throw new Error('no hay pestaña de FLIP abierta: corre antes pixel-open.cjs');
  const c = await P.connect(page);
  await c.send('Page.bringToFront').catch(() => {});
  // La pantalla no se apaga mientras se mide (se suelta al final).
  await c.evaluate(`navigator.wakeLock ? navigator.wakeLock.request('screen').then(lock => { window.__heatLock = lock; return 1; }).catch(() => 0) : 0`);
  await c.evaluate(`(() => {
    if (window.__heat) return;
    const H = window.__heat = { render: [], raf: [], last: 0, real: _renderCamEngineFrame };
    _renderCamEngineFrame = function (...args) { const t0 = performance.now(); const r = H.real.apply(this, args); H.render.push(performance.now() - t0); return r; };
    const tick = now => { if (H.last) H.raf.push(now - H.last); H.last = now; if (window.__heat) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })()`);
  const info = await c.evaluate(`({ url: location.origin, cache: (navigator.serviceWorker.controller || {}).scriptURL || '', camara: stream ? stream.getVideoTracks()[0].getSettings() : null, pantalla: [innerWidth, innerHeight, devicePixelRatio] })`);
  console.log(JSON.stringify(info));
  const go = key => c.evaluate(`(() => { if (flipShell.module() !== ${JSON.stringify(key)}) { document.getElementById('shellModule').click(); document.querySelector('#shellLauncher [data-module="${key}"]').click(); } return true; })()`);
  const pick = (family, variant) => c.evaluate(`(() => { _setCamFamily(${JSON.stringify(family)}); if (${JSON.stringify(variant)} && camVariant !== ${JSON.stringify(variant)}) { camVariant = ${JSON.stringify(variant)}; _applyCamState(); } return true; })()`);
  const scenarios = [
    ['cam DSI', async () => { await go('cam'); await pick('DSI', 'STD'); }],
    ['cam VFD CRT', async () => { await go('cam'); await pick('VFD', 'CRT'); }],
    ['cam STAMP', async () => { await go('cam'); await pick('STAMP', 'ENGR'); }],
    ['portal', async () => { await go('portal'); }],
    ['flow', async () => { await go('sflow'); }],
    ['stage', async () => { await go('stage'); }],
  ].filter(([name]) => !only || only.some(o => name.startsWith(o)));
  const rows = [];
  console.log('módulo        batería °C  piel °C  chip °C  térmico  CPU página  CPU gráficos  cuadros/s  ms/cuadro  cámara/s  rastreador/s');
  for (const [name, enter] of scenarios) {
    await enter();
    await P.sleep(4000);
    await c.evaluate('(() => { __heat.render.length = 0; __heat.raf.length = 0; __heat.frames0 = window.flipPortal ? flipPortal.status().frames : 0; __heat.t0 = performance.now(); })()');
    const before = phone(), samples = [];
    for (let elapsed = 0; elapsed < seconds; elapsed += 10) { await P.sleep(Math.min(10, seconds - elapsed) * 1000); samples.push(phone()); }
    const page = await c.evaluate(`(() => {
      const H = __heat, dt = (performance.now() - H.t0) / 1000, sort = list => Float64Array.from(list).sort(), at = (list, q) => list.length ? list[Math.min(list.length - 1, Math.floor(q * list.length))] : 0;
      const s = window.flipStage ? flipStage.status() : null, p = window.flipPortal ? flipPortal.status() : null;
      return { fps: +(1000 / (at(sort(H.raf), 0.5) || 1000)).toFixed(0), motor: +(H.render.length / dt).toFixed(1), ms: +at(sort(H.render), 0.5).toFixed(1), stage: s && s.active ? s.fps : 0,
        rastreador: p && p.active ? +((p.frames - H.frames0) / dt).toFixed(1) : 0, delegado: p ? p.delegate : '', camara: stream ? Math.round(stream.getVideoTracks()[0].getSettings().frameRate || 0) : 0 };
    })()`);
    const last = samples[samples.length - 1], avg = key => +(samples.reduce((a, s) => a + (s[key] || 0), 0) / samples.length).toFixed(0);
    const row = { name, segundos: seconds, bateria: [before.bateria, last.bateria], piel: [before.piel, last.piel], chip: [before.chip, last.chip], estado: Math.max(...samples.map(s => s.estado || 0)), cpuPagina: avg('cpuPagina'), cpuGraficos: avg('cpuGraficos'), ...page };
    rows.push(row);
    const span = pair => pair[0] == null ? '   —   ' : (pair[0].toFixed(1) + '→' + pair[1].toFixed(1)).padStart(9);
    console.log(name.padEnd(12), span(row.bateria), span(row.piel), span(row.chip), String(row.estado).padStart(6), String(row.cpuPagina + ' %').padStart(11), String(row.cpuGraficos + ' %').padStart(12),
      String(row.stage || row.motor || row.fps).padStart(10), String(row.ms).padStart(9), String(row.camara).padStart(9), String(row.rastreador + (row.delegado ? ' ' + row.delegado : '')).padStart(12));
  }
  await c.evaluate(`(() => { _renderCamEngineFrame = __heat.real; delete window.__heat; if (window.__heatLock) { window.__heatLock.release(); delete window.__heatLock; } return true; })()`);
  await go('cam');
  if (out) fs.writeFileSync(out, JSON.stringify({ info, seconds, rows }, null, 1));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
