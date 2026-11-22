// Cliente mínimo del protocolo de depuración de Chrome para el Pixel conectado por USB.
// Antes: adb forward tcp:9333 localabstract:chrome_devtools_remote
// Solo se tocan pestañas de FLIP (túnel de prueba o localhost:87xx); las demás ni se listan.
'use strict';
const fs = require('node:fs');
const BASE = process.env.PIXEL_CDP || 'http://127.0.0.1:9333';
const FLIP = /trycloudflare\.com|flipnote|localhost:87|127\.0\.0\.1:87/;

async function targets() {
  const all = await (await fetch(BASE + '/json/list')).json();
  return all.filter(t => FLIP.test(t.url));
}

async function openTab(url) {
  const res = await fetch(BASE + '/json/new?' + url, { method: 'PUT' });
  return res.json();
}

async function closeTab(id) {
  return (await fetch(BASE + '/json/close/' + id)).text();
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const listeners = [];
    const log = [];
    ws.onerror = e => reject(new Error('websocket: ' + (e.message || 'error')));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
        log.push({ t: Date.now(), kind: msg.params.type, text });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        log.push({ t: Date.now(), kind: 'exception', text: (d.exception && (d.exception.description || d.exception.value)) || d.text, where: (d.url || '') + ':' + d.lineNumber });
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        log.push({ t: Date.now(), kind: 'log:' + e.level + ':' + e.source, text: e.text, where: e.url ? e.url.slice(-60) : '' });
      }
      listeners.forEach(fn => fn(msg));
    };
    const send = (method, params = {}) => new Promise((ok, fail) => {
      const id = ++seq;
      pending.set(id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.onopen = async () => {
      const api = {
        send, log,
        on: fn => listeners.push(fn),
        async evaluate(expression, { timeout = 30000 } = {}) {
          const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout });
          if (r.exceptionDetails) {
            const d = r.exceptionDetails;
            throw new Error('page: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
          }
          return r.result.value;
        },
        async screenshot(file, { quality = 70 } = {}) {
          const r = await send('Page.captureScreenshot', { format: 'jpeg', quality });
          fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
          return file;
        },
        // Toques de verdad (eventos de entrada del navegador, no clics por código): centro del elemento.
        async point(selector) {
          const p = await api.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; })()`);
          if (!p || !p[2] || !p[3]) throw new Error('no se ve ' + selector);
          return p;
        },
        async tap(selector, hold = 70) {
          const [x, y] = await api.point(selector);
          await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          await sleep(hold);
          await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await sleep(160);
        },
        async drag(selector, dx, dy, steps = 8) {
          const [x, y] = await api.point(selector);
          await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let i = 1; i <= steps; i++) { await sleep(24); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y: y + dy * i / steps }] }); }
          await sleep(30);
          await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await sleep(160);
        },
        async reload() { await send('Page.reload', { ignoreCache: false }); },
        async navigate(url) { await send('Page.navigate', { url }); },
        close() { try { ws.close(); } catch (_) {} },
      };
      try {
        await send('Runtime.enable');
        await send('Log.enable');
        await send('Page.enable');
        resolve(api);
      } catch (e) { reject(e); }
    };
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { targets, openTab, closeTab, connect, sleep, BASE };
