// Recorrido exploratorio: entra en cada módulo y toca al azar (con semilla) todo lo que se
// puede tocar, como un dedo impaciente. No comprueba ningún resultado concreto: comprueba que
// nada se rompe. Falla si aparece un error de página, un error en la consola, una promesa
// sin atender, si la página deja de responder o si se queda atrapada en una pantalla sin salida.
// Al fallar deja la traza de los últimos toques y una captura para repetirlo con la misma semilla.
//   FLIP_URL=http://127.0.0.1:8760 node tests/explore.cjs [--seed 7] [--taps 45] [--modules cam,stage] [--desktop] [--out carpeta]
//   … --replay carpeta/traza-7.txt    repite una traza guardada, toque a toque
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, openFlip } = require('./lib/harness.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf('--' + name); return at >= 0 ? args[at + 1] : fallback; };
const seed = Number(opt('seed', 7)), taps = Number(opt('taps', 45)), desktop = args.includes('--desktop');
const modules = opt('modules', 'cam,portal,ascii,sflow,scrash,fusion,sono,wmp,edit,stage').split(',');
const out = path.resolve(opt('out', fs.mkdtempSync(path.join(os.tmpdir(), 'flip-explore-'))));
const replay = opt('replay', '') ? fs.readFileSync(opt('replay', ''), 'utf8').split('\n').filter(Boolean) : null;
fs.mkdirSync(out, { recursive: true });

function mulberry(start) {
  let a = start >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Lo que un dedo puede tocar ahora mismo: visible, dentro de la pantalla y sin nada encima.
const touchables = page => page.evaluate(() => {
  const list = [], seen = new Set();
  const selector = 'button, [role="button"], [role="tab"], [role="switch"], input[type="range"], input[type="checkbox"], input[type="color"], select, label, summary, .look, .hw, [data-act], [data-page], [data-scene], [data-jack], canvas#display';
  for (const node of document.querySelectorAll(selector)) {
    if (seen.has(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') continue;
    seen.add(node);
    const r = node.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
    const top = document.elementFromPoint(x, y);
    if (!top || !(node === top || node.contains(top))) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.pointerEvents === 'none' || +style.opacity === 0) continue;
    if (node.matches('a[href], input[type="file"]') || node.closest('a[href]')) continue;
    list.push({
      x: Math.round(x), y: Math.round(y), w: Math.round(r.width),
      name: (node.id ? '#' + node.id : node.tagName.toLowerCase() + (node.classList[0] ? '.' + node.classList[0] : '')) + ' "' + (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16) + '"',
      kind: node.matches('input[type="range"]') ? 'range' : node.matches('select') ? 'select' : node.matches('canvas') ? 'canvas' : 'tap',
    });
  }
  return list;
});

async function main() {
  const browser = await launch();
  const trail = [];
  let page, current = 'arranque';
  try {
    const opened = await openFlip(browser, { desktop, sceneCamera: { scene: 'roomLit', w: 1280, h: 720 } });
    page = opened.page;
    const { errors } = opened;
    const noise = [];
    // No son errores de FLIP: la librería de visión escribe sus avisos informativos por el canal de
    // errores, y Chrome avisa de la «descripción del códec» al grabar MP4 con audio (comprobado: el
    // archivo sale con una sola cabecera de secuencia y se decodifica entero).
    const benign = /^(INFO: Created TensorFlow Lite|W\d{4} |I\d{4} |Graph successfully started|When using "avc1" for mp4 encoding)/;
    page.on('console', message => { if (message.type() === 'error' && !benign.test(message.text())) noise.push(message.text().slice(0, 300)); });
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    page.on('filechooser', () => {});                       // el selector de archivos no se abre de verdad
    page.on('download', download => download.cancel().catch(() => {}));
    opened.context.on('page', popup => { if (popup !== page) popup.close().catch(() => {}); });
    await page.evaluate(() => {
      window.__rejections = [];
      addEventListener('unhandledrejection', event => window.__rejections.push(String(event.reason && (event.reason.message || event.reason)).slice(0, 300)));
      navigator.share = () => Promise.reject(new DOMException('cancelado', 'AbortError'));   // compartir: como si la persona cancelara
    });
    const rnd = mulberry(seed);
    const summary = [];
    // Volver a un estado desde el que se pueda cambiar de módulo, como haría una persona:
    // salir de pantalla completa, Escape, y los botones de cerrar que estén a la vista.
    const surface = async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const reachable = await page.evaluate(() => {
          const key = document.getElementById('shellModule');
          if (!key) return false;
          const r = key.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.width > 0 && !!top && (top === key || key.contains(top));
        });
        if (reachable) return true;
        if (attempt === 0) await page.evaluate(() => document.fullscreenElement && document.exitFullscreen().catch(() => {}));
        else if (attempt === 1) await page.keyboard.press('Escape');
        else if (attempt === 2) await page.mouse.click(Math.round(page.viewportSize().width / 2), 150);   // el fondo de una hoja abierta
        else {
          const closers = (await touchables(page)).filter(t => /LISTO|CERRAR|Cerrar|SALIR|Salir|VOLVER|×|✕|Hecho|OK/.test(t.name));
          if (closers.length) await page.mouse.click(closers[0].x, closers[0].y);
          else await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(350);
      }
      return false;
    };
    // Repetición de una traza: los mismos toques, en el mismo orden y en el mismo sitio.
    if (replay) {
      let inside = '';
      for (const line of replay) {
        const [key, action] = line.split(' · ');
        current = key;
        if (key !== inside) {
          assert.ok(await surface(), 'no se puede volver a la tecla de módulo antes de entrar en ' + key);
          await page.locator('#shellModule').click();
          await page.locator('#shellLauncher [data-module="' + key + '"]').click();
          await page.waitForTimeout(700);
          inside = key;
        }
        trail.push(line);
        const at = /@(\d+),(\d+)$/.exec(action), x = at ? +at[1] : 0, y = at ? +at[2] : 0;
        if (action === 'Escape') await page.keyboard.press('Escape');
        else if (action.startsWith('doble ')) await page.mouse.dblclick(x, y);
        else if (action.startsWith('largo ')) { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); }
        else if (action.startsWith('arrastra ')) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y, { steps: 4 }); await page.mouse.up(); }
        else await page.mouse.click(x, y);
        await page.waitForTimeout(170);
        if (noise.length || errors.length) break;
      }
      const rejections = await page.evaluate(() => window.__rejections.splice(0));
      console.log('repetidos ' + trail.length + ' de ' + replay.length + ' toques');
      assert.deepEqual(errors, [], 'errores de página en ' + current);
      assert.deepEqual(rejections, [], 'promesas sin atender en ' + current);
      assert.deepEqual(noise, [], 'errores en la consola en ' + current);
      console.log('PASS · traza repetida sin errores');
      return;
    }
    for (const key of modules) {
      current = key;
      assert.ok(await surface(), 'no se puede volver a la tecla de módulo antes de entrar en ' + key);
      await page.locator('#shellModule').click();
      await page.locator('#shellLauncher [data-module="' + key + '"]').click();
      await page.waitForTimeout(700);
      let done = 0, empty = 0;
      for (let i = 0; i < taps; i++) {
        // Un dedo también cierra lo que abrió y toca donde no hay botón.
        const whim = rnd();
        if (whim < 0.1) { trail.push(key + ' · Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); continue; }
        if (whim < 0.2) {
          const x = Math.round(8 + rnd() * (page.viewportSize().width - 16)), y = Math.round(8 + rnd() * (page.viewportSize().height - 16));
          trail.push(key + ' · toca la pantalla @' + x + ',' + y);
          await page.mouse.click(x, y); await page.waitForTimeout(200); continue;
        }
        const list = await touchables(page);
        if (!list.length) { empty++; await page.mouse.click(Math.round(page.viewportSize().width / 2), Math.round(page.viewportSize().height * 0.4)); await page.waitForTimeout(250); continue; }
        const pick = list[Math.floor(rnd() * list.length)];
        const how = pick.kind === 'range' ? 'arrastra' : rnd() < 0.08 ? 'doble' : rnd() < 0.08 ? 'largo' : 'toca';
        trail.push(key + ' · ' + how + ' ' + pick.name + ' @' + pick.x + ',' + pick.y);
        if (pick.kind === 'range' || pick.kind === 'canvas') {
          const dx = (rnd() - 0.5) * Math.min(160, pick.w), dy = pick.kind === 'canvas' ? (rnd() - 0.5) * 120 : 0;
          await page.mouse.move(pick.x, pick.y); await page.mouse.down();
          await page.mouse.move(pick.x + dx / 2, pick.y + dy / 2, { steps: 3 }); await page.mouse.move(pick.x + dx, pick.y + dy, { steps: 3 });
          await page.mouse.up();
        } else if (pick.kind === 'select') {
          await page.evaluate(({ x, y, r }) => {
            const node = document.elementFromPoint(x, y), select = node && node.closest('select');
            if (!select || !select.options.length) return;
            select.selectedIndex = Math.floor(r * select.options.length);
            select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true }));
          }, { x: pick.x, y: pick.y, r: rnd() });
        } else if (how === 'doble') await page.mouse.dblclick(pick.x, pick.y);
        else if (how === 'largo') { await page.mouse.move(pick.x, pick.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); }
        else await page.mouse.click(pick.x, pick.y);
        done++;
        await page.waitForTimeout(90 + Math.floor(rnd() * 160));
        // Sigue viva: responde en menos de cinco segundos.
        await Promise.race([page.evaluate(() => 1), new Promise((_, reject) => setTimeout(() => reject(new Error('la página no responde')), 5000))]);
      }
      const rejections = await page.evaluate(() => window.__rejections.splice(0));
      assert.deepEqual(errors, [], 'errores de página en ' + key);
      assert.deepEqual(rejections, [], 'promesas sin atender en ' + key);
      assert.deepEqual(noise, [], 'errores en la consola en ' + key);
      summary.push(key + ' ' + done + (empty ? ' (+' + empty + ' en vacío)' : ''));
    }
    // Después de todo, la cámara sigue siendo una cámara: vuelve a CAM y pinta.
    current = 'vuelta a CAM';
    assert.ok(await surface(), 'no se puede volver a la tecla de módulo al terminar');
    await page.locator('#shellModule').click();
    await page.locator('#shellLauncher [data-module="cam"]').click();
    // Si el recorrido dejó una grabación en marcha, se para como lo haría una persona.
    await page.waitForTimeout(600);
    if (await page.evaluate(() => typeof recorder !== 'undefined' && !!recorder && recorder.state === 'recording')) { await page.locator('#deckShutter').click(); await page.waitForTimeout(900); }
    await page.waitForFunction(() => {
      if (!(vid.videoWidth > 0)) return false;
      const probe = document.createElement('canvas'); probe.width = probe.height = 8;
      const ctx = probe.getContext('2d'); ctx.drawImage(display, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data; let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum > 300;
    }, null, { timeout: 15000 });
    assert.deepEqual(errors, [], 'errores de página al volver a CAM');
    console.log('PASS · recorrido exploratorio · semilla ' + seed + (desktop ? ' · escritorio' : ' · teléfono') + ' · ' + summary.join(' · '));
  } catch (error) {
    console.log('── últimos toques (' + current + ', semilla ' + seed + ') ──\n' + trail.slice(-18).join('\n'));
    if (page) { try { await page.screenshot({ path: path.join(out, 'fallo-' + seed + '.png') }); console.log('captura: ' + path.join(out, 'fallo-' + seed + '.png')); } catch (_) {} }
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'traza-' + seed + (desktop ? '-escritorio' : '') + '.txt'), trail.join('\n'));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
