// Pasar un look de CLON a otra persona: el look viaja DENTRO de un enlace (FLIP no tiene servidor) y
// quien lo abre lo recibe en su galería. Y la galería: caben cincuenta, en orden alfabético.
//
//   FLIP_URL=http://127.0.0.1:8760 node tests/pase.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, openFlip, URL } = require('./lib/harness.cjs');

const CAM = { sceneCamera: { scene: 'roomLit', w: 1280, h: 720, fps: 30 } };
const step = (text, data) => console.log('✓ ' + text + (data ? ' · ' + JSON.stringify(data) : ''));

(async () => {
  const browser = await launch();
  try {
    // ── 1 · Quien pasa: aprende dos looks (uno de color continuo, uno de tintas planas) ──
    const a = await openFlip(browser, CAM);
    await a.page.waitForFunction(() => window.flipClon && window.flipShell && typeof flipQR !== 'undefined');
    await a.page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'lib/clon-estilos.js'), 'utf8') });
    const made = await a.page.evaluate(() => {
      const E = clonEstilos, n = 384, A = E.scenes.retrato(n), B = E.scenes.cuarto(n), out = {};
      for (const estilo of ['neon', 'cartel', 'dominante']) {
        const look = flipClon.keep(flipClon.learn(E.styled(A, E.recipes[estilo]), n, n)), P = flipClon.pass;
        const bytes = P.pack(look), copia = P.unpack(bytes), otra = P.pack(copia), link = P.link(look.id), qr = P.qr(look.id);
        // la copia, puesta sobre dos escenas, frente al original
        const pinta = (l, src) => { const c = document.createElement('canvas'); c.width = c.height = n; flipClon._render(l, src, c); return c; };
        const lejos = [A, B].map(src => +(E.apart(pinta(copia, src), pinta(look, src)).lejos * 100).toFixed(2));
        out[estilo] = { id: look.id, nombre: look.name, limitado: look.limited, bytes: bytes.length, igual: String(bytes) === String(otra), enlace: link, largo: link.length, qr: qr && { version: qr.version, lado: qr.size }, qrTexto: P.qrText(look.id), lejos,
          copia: { nombre: copia.name, muestras: copia.ot ? copia.ot.length / 6 : 0, propias: copia.otOwn, sinMiniatura: !copia.thumb, sinEstrella: !copia.fav, sinId: !copia.id }, leeEnlace: !!P.read('mira: ' + link + ' (te lo paso)'), leeQr: !!P.read(P.qrText(look.id)) };
      }
      return out;
    });
    for (const [estilo, m] of Object.entries(made)) {
      assert.ok(m.bytes < 1250 && m.largo < 1750, estilo + ': el look viaja en poco (' + m.bytes + ' bytes, enlace de ' + m.largo + ' letras)');
      assert.ok(m.igual, estilo + ': empaquetar lo recibido da lo mismo (no se degrada al pasar de mano en mano)');
      assert.ok(Math.max(...m.lejos) < 1.2, estilo + ': la copia pinta igual que el original (distancia ' + m.lejos + ' sobre 100; 2 apenas se nota)');
      assert.ok(m.copia.nombre === m.nombre && m.copia.sinMiniatura && m.copia.sinEstrella && m.copia.sinId, estilo + ': viaja con su nombre, sin miniatura de la referencia ni estrella');
      assert.ok(m.leeEnlace && m.leeQr, estilo + ': se lee del enlace (aunque venga entre texto) y del texto del QR');
      assert.ok(m.qr && m.qr.version <= 26, estilo + ': su QR no es demasiado denso (versión ' + (m.qr && m.qr.version) + ')');
      assert.ok(/[A-Za-z0-9]$/.test(m.enlace) && /[0-9A-Z]$/.test(m.qrTexto), estilo + ': el enlace acaba en letra o número (un chat no le come el final)');
    }
    assert.ok(!made.neon.limitado && made.neon.copia.muestras === 200 && made.neon.copia.propias >= 60, 'el reparto de color viaja en 200 muestras: ' + JSON.stringify(made.neon.copia));
    assert.ok(made.cartel.limitado && made.cartel.copia.muestras === 0 && made.cartel.bytes < 600, 'un cartel de tintas planas viaja en menos todavía: ' + made.cartel.bytes + ' bytes');
    step('un look cabe en un enlace y la copia pinta igual', Object.fromEntries(Object.entries(made).map(([k, m]) => [k, { bytes: m.bytes, enlace: m.largo, qr: 'v' + m.qr.version, lejos: m.lejos }])));

    // ── 2 · Lo que llega es de fuera: un enlace roto o trucado no mete nada ──
    const malos = await a.page.evaluate(link => {
      const P = flipClon.pass, at = link.indexOf('#clon=') + 6, carga = link.slice(at), bytes = Uint8Array.from(atob(carga.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const b64 = b => btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const con = fn => { const b = bytes.slice(); fn(b); return P.read('#clon=' + b64(b)); };
      // un nombre con marcas HTML: 4 = largo del nombre; se escribe encima otro de su mismo largo
      const largoNombre = bytes[3], malo = new TextEncoder().encode('<img src=x onerror=1>'.slice(0, largoNombre).padEnd(largoNombre, 'x'));
      const conNombre = con(b => b.set(malo, 4));
      let ruido = 0;
      for (let i = 0; i < 300; i++) { const b = bytes.slice(); for (let k = 0; k < 6; k++) b[Math.floor(Math.random() * b.length)] = Math.floor(Math.random() * 256); try { const l = P.read('#clon=' + b64(b)); if (l && (!Array.isArray(l.palette) || l.cdf.length !== 33 || /[<>]/.test(l.name) || !isFinite(l.sat))) ruido++; } catch (_) { ruido++; } }
      return { cortado: P.read(link.slice(0, link.length - 40)), otraVersion: con(b => { b[0] = 9; }), sinCierre: con(b => { b[b.length - 1] = 7; }), tintas: con(b => { b[2] = 40; }), basura: P.read('#clon=' + 'A'.repeat(900)), vacio: P.read(''), nada: P.read(null), otro: P.read('https://example.org/#clon=hola'),
        nombre: conNombre && conNombre.name, ruido, antes: flipClon.looks().length, llega: flipClon.arrive(link.slice(0, link.length - 40)), despues: flipClon.looks().length };
    }, made.neon.enlace);
    assert.deepEqual([malos.cortado, malos.otraVersion, malos.sinCierre, malos.tintas, malos.basura, malos.vacio, malos.nada, malos.otro], [null, null, null, null, null, null, null, null], 'un enlace cortado, de otra versión o inventado no se lee: ' + JSON.stringify(malos));
    assert.ok(malos.nombre && !/[<>]/.test(malos.nombre), 'un nombre con marcas HTML llega sin ellas: ' + malos.nombre);
    assert.equal(malos.ruido, 0, 'trescientos enlaces con bytes cambiados al azar: ninguno rompe nada ni mete un look deforme');
    assert.deepEqual([malos.llega, malos.despues], [null, malos.antes], 'y un enlace roto no añade nada a la galería');
    step('un enlace roto o trucado no mete nada');

    // ── 3 · Pasarlo desde la galería: la tecla PASAR enseña el QR y manda el enlace ──
    await a.page.evaluate(id => { flipClon.use(id); }, made.neon.id);
    await a.page.waitForFunction(() => { const k = document.querySelector('.clon-rapidas [data-clon="galeria"]'); return !!k && k.getBoundingClientRect().width > 0; }, null, { timeout: 15000 });
    await a.page.locator('.clon-rapidas [data-clon="galeria"]').click();
    await a.page.waitForFunction(() => { const g = document.getElementById('clonGaleria'); return g && !g.hidden && g.getAnimations().every(x => x.playState !== 'running'); }, null, { timeout: 5000 });
    const barra = await a.page.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), Math.round(b.width), Math.round(b.height)]; }; return { estrella: r('[data-clon="fav"]'), nombre: r('#clonNombre'), pasar: r('[data-clon="pasar"]'), borrar: r('[data-clon="borrar"]'), ancho: innerWidth }; });
    assert.ok(barra.pasar[2] >= 44 && barra.pasar[3] >= 34 && barra.nombre[2] >= 110 && barra.borrar[1] <= barra.ancho && barra.pasar[1] <= barra.borrar[0], 'PASAR cabe junto al nombre y a BORRAR sin apretarlos: ' + JSON.stringify(barra));
    await a.page.locator('[data-clon="pasar"]').click();
    await a.page.waitForTimeout(350);
    const capa = await a.page.evaluate(() => {
      const g = document.getElementById('clonGaleria'), c = document.getElementById('clonCapa'), q = document.getElementById('clonQr'), r = q.getBoundingClientRect(), s = g.getBoundingClientRect();
      const lado = Math.min(r.width, r.height);
      return { abierta: !c.hidden && c.dataset.modo === 'pasar', nombre: document.getElementById('clonPaseNombre').textContent, lado: Math.round(lado), puntos: q.width, porCuadro: +(lado / (q.width / 8)).toFixed(2), cabe: s.top >= 0 && s.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight, teclas: [...c.querySelectorAll('.clon-pase button')].map(b => b.textContent) };
    });
    assert.ok(capa.abierta && capa.nombre === '«' + made.neon.nombre + '»' && capa.cabe, 'PASAR abre la capa con el nombre del look: ' + JSON.stringify(capa));
    assert.ok(capa.lado >= 240 && capa.porCuadro >= 2, 'el QR sale grande: ' + capa.lado + ' px de lado, ' + capa.porCuadro + ' px por cuadrito');
    assert.deepEqual(capa.teclas, ['ENVIAR ENLACE', 'VOLVER']);
    // el QR pintado, leído por el lector de códigos del propio navegador (donde lo hay)
    const lector = await a.page.evaluate(async () => {
      if (typeof BarcodeDetector === 'undefined') return null;
      try { const found = await new BarcodeDetector({ formats: ['qr_code'] }).detect(document.getElementById('clonQr')); return found.map(f => f.rawValue); } catch (error) { return 'error: ' + error; }
    });
    if (Array.isArray(lector) && lector.length) { assert.equal(lector[0], made.neon.qrTexto, 'el QR, leído por el navegador, da el enlace del look'); step('el QR se lee con el lector del navegador'); }
    else console.log('· (este navegador no trae lector de códigos: el QR se comprueba aparte, con el lector de macOS) ' + JSON.stringify(lector));
    // ENVIAR ENLACE: la hoja de compartir del sistema (de mentira: anota lo que recibe)
    await a.page.evaluate(() => { window.__shared = []; navigator.share = async data => { window.__shared.push(data); }; });
    await a.page.locator('[data-clon="enviar"]').click();
    await a.page.waitForFunction(() => window.__shared.length === 1);
    const enviado = await a.page.evaluate(() => ({ ...window.__shared[0], lee: flipClon.pass.read(window.__shared[0].url).name }));
    assert.ok(enviado.url === made.neon.enlace && enviado.lee === made.neon.nombre && enviado.text.includes(made.neon.nombre), 'ENVIAR ENLACE abre la hoja de compartir con el enlace del look: ' + JSON.stringify({ texto: enviado.text, titulo: enviado.title }));
    // sin hoja de compartir (una computadora): se copia
    await a.page.evaluate(() => { window.__copied = []; navigator.share = undefined; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); }, readText: async () => window.__clip || '' } }); });
    await a.page.locator('[data-clon="enviar"]').click();
    await a.page.waitForFunction(() => window.__copied.length === 1);
    assert.equal(await a.page.evaluate(() => window.__copied[0]), made.neon.enlace, 'sin hoja de compartir, el enlace se copia');
    await a.page.locator('#clonCapa .clon-pase [data-clon="capa-cerrar"]').click();
    await a.page.waitForTimeout(200);
    assert.deepEqual(await a.page.evaluate(() => [document.getElementById('clonCapa').hidden, document.getElementById('clonGaleria').hidden]), [true, false], 'VOLVER regresa a la galería');
    step('PASAR: el QR a la vista y el enlace a la hoja de compartir', { lado: capa.lado, porCuadro: capa.porCuadro });

    // ── 4 · Quien recibe: abre el enlace y el look ya está en su FLIP ──
    const b = await openFlip(browser, { ...CAM, url: made.neon.enlace.replace(/^[^#]*/, URL + '/'), boot: false });
    await b.page.waitForFunction(() => window.flipClon && flipClon.looks().length === 1, null, { timeout: 20000 });
    const portada = await b.page.evaluate(() => ({ hash: location.hash, pildora: document.getElementById('clonPildora').hidden, look: flipClon.looks()[0] }));
    assert.equal(portada.hash, '', 'el look se quita de la dirección al recibirlo (recargar no lo vuelve a meter)');
    assert.ok(portada.pildora, 'en la portada todavía no se avisa (el aviso sale en la cámara)');
    assert.ok(portada.look.name === made.neon.nombre && /^data:image\/jpeg;base64,/.test(portada.look.thumb) && portada.look.thumb.length > 800 && !portada.look.fav, 'llega con su nombre y con una miniatura hecha aquí: ' + JSON.stringify({ nombre: portada.look.name, miniatura: (portada.look.thumb || '').length }));
    await b.page.locator('#btnSplashOriginal').click();
    await b.page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await b.page.waitForFunction(() => !document.getElementById('clonPildora').hidden, null, { timeout: 8000 });
    const llego = await b.page.evaluate(() => ({ familia: camFamily, puesto: camVariant === flipClon.looks()[0].id, pildora: document.getElementById('clonPildora').textContent, lcd: document.getElementById('lcdLook').textContent, cuadro: flipClon.state().frame }));
    assert.ok(llego.familia === 'CLON' && llego.puesto && llego.pildora.includes('LLEGÓ · ' + made.neon.nombre) && llego.lcd.includes(made.neon.nombre), 'al entrar a la cámara el look está puesto y se avisa: ' + JSON.stringify(llego));
    await b.page.waitForFunction(n => flipClon.state().frame > n + 5, llego.cuadro, { timeout: 10000 });
    // el mismo enlace otra vez (con FLIP abierto): no se duplica
    await b.page.evaluate(link => { location.hash = link.slice(link.indexOf('#')); }, made.neon.enlace);
    await b.page.waitForFunction(() => location.hash === '' && /YA LO TENÍAS/.test(document.getElementById('clonPildora').textContent), null, { timeout: 8000 });
    assert.equal(await b.page.evaluate(() => flipClon.looks().length), 1, 'el mismo look dos veces no se duplica');
    // otro, por el texto del QR (lo que abre la cámara del teléfono al leerlo)
    await b.page.evaluate(text => { location.hash = text.slice(text.indexOf('#')); }, made.cartel.qrTexto);
    await b.page.waitForFunction(() => flipClon.looks().length === 2 && location.hash === '', null, { timeout: 8000 });
    const dos = await b.page.evaluate(() => ({ nombres: flipClon.looks().map(l => l.name), puesto: flipClon.looks().find(l => l.id === camVariant).name, limitado: flipClon.looks()[1].limited }));
    assert.ok(dos.puesto === made.cartel.nombre && dos.limitado, 'el del QR llega y se pone: ' + JSON.stringify(dos));
    // y siguen ahí al recargar
    await b.page.reload();
    await b.page.waitForFunction(() => window.flipClon && flipClon.looks().length === 2, null, { timeout: 20000 });
    step('abrir el enlace mete el look en la galería y lo pone en la cámara', { nombres: dos.nombres });

    // ── 5 · RECIBIR dentro de FLIP (la app instalada en un iPhone no recibe los enlaces: se pega) ──
    await b.page.locator('#btnSplashOriginal').click();
    await b.page.waitForFunction(() => vid.videoWidth > 0, null, { timeout: 15000 });
    await b.page.waitForFunction(() => { const k = document.querySelector('.clon-rapidas [data-clon="galeria"]'); return !!k && k.getBoundingClientRect().width > 0; }, null, { timeout: 15000 });
    await b.page.waitForTimeout(600);
    await b.page.locator('.clon-rapidas [data-clon="galeria"]').click();
    await b.page.waitForFunction(() => { const g = document.getElementById('clonGaleria'); return g && !g.hidden && g.getAnimations().every(x => x.playState !== 'running'); }, null, { timeout: 5000 });
    // (el portapapeles, de mentira: lo que «tiene copiado» esta persona)
    await b.page.evaluate(() => { window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.__clip, writeText: async () => {} } }); });
    await b.page.locator('#clonRejilla [data-clon="recibir"]').scrollIntoViewIfNeeded();
    await b.page.locator('#clonRejilla [data-clon="recibir"]').click();
    await b.page.waitForFunction(() => { const c = document.getElementById('clonCapa'); return !c.hidden && c.dataset.modo === 'recibir'; });
    assert.equal(await b.page.evaluate(() => flipClon.looks().length), 2, 'sin nada copiado, RECIBIR pide el enlace');
    await b.page.locator('#clonEnlace').fill('esto no es un enlace de FLIP');
    assert.match(await b.page.locator('#clonLlegaDice').textContent(), /no trae un look/, 'un texto cualquiera: se dice que no trae un look');
    await b.page.locator('#clonEnlace').fill('Te paso mi look ' + made.dominante.enlace);
    await b.page.waitForFunction(() => flipClon.looks().length === 3 && document.getElementById('clonCapa').hidden, null, { timeout: 8000 });
    const pegado = await b.page.evaluate(() => ({ puesto: flipClon.looks().find(l => l.id === camVariant).name, marcada: (document.querySelector('.clon-carta.is-on b') || {}).textContent, cuenta: document.getElementById('clonCuenta').textContent, galeria: !document.getElementById('clonGaleria').hidden }));
    assert.ok(pegado.puesto === made.dominante.nombre && pegado.marcada === made.dominante.nombre && pegado.cuenta === '3 / 50' && pegado.galeria, 'pegado el enlace, el look entra y queda puesto, con la galería abierta: ' + JSON.stringify(pegado));
    // con el enlace ya copiado, RECIBIR lo mete de un toque
    await b.page.evaluate(id => { const borrar = flipClon.looks().find(l => l.name === id); flipClon.forget(borrar.id); }, made.dominante.nombre);
    await b.page.evaluate(link => { window.__clip = link; }, made.dominante.enlace);
    await b.page.locator('#clonRejilla [data-clon="recibir"]').scrollIntoViewIfNeeded();
    await b.page.locator('#clonRejilla [data-clon="recibir"]').click();
    await b.page.waitForFunction(() => flipClon.looks().length === 3 && document.getElementById('clonCapa').hidden, null, { timeout: 8000 });
    step('RECIBIR: pegar el enlace (o tenerlo copiado) mete el look');

    // ── 6 · Una captura del QR, abierta con ABRIR, también lo recibe (donde el navegador lee códigos) ──
    if (Array.isArray(lector) && lector.length) {
      const png = await a.page.evaluate(() => document.getElementById('clonQr').toDataURL('image/png'));
      await b.page.evaluate(id => { flipClon.forget(flipClon.looks().find(l => l.name === id).id); }, made.neon.nombre);
      await b.page.keyboard.press('Escape'); await b.page.waitForTimeout(250);
      const [chooser] = await Promise.all([b.page.waitForEvent('filechooser'), b.page.locator('.clon-rapidas [data-clon="abrir"]').click()]);
      await chooser.setFiles({ name: 'qr.png', mimeType: 'image/png', buffer: Buffer.from(png.slice(png.indexOf(',') + 1), 'base64') });
      await b.page.waitForFunction(n => flipClon.looks().some(l => l.name === n), made.neon.nombre, { timeout: 15000 });
      const leido = await b.page.evaluate(n => { const l = flipClon.looks().find(x => x.name === n); return { muestras: l.ot.length / 6, total: flipClon.looks().length, limitado: l.limited }; }, made.neon.nombre);
      assert.deepEqual(leido, { muestras: 200, total: 3, limitado: false }, 'la captura de un QR no se «aprende» como imagen: se recibe el look que lleva dentro');
      step('una captura del QR abierta con ABRIR mete el look');
    }

    // ── 7 · La galería: de fábrica por nombre; el chip pasa a los otros órdenes y se recuerda ──
    const orden = await b.page.evaluate(() => {
      const base = flipClon.looks()[0];
      for (const nombre of ['ZAFIRO', 'look 10', 'look 2', 'Árbol', 'BRUMA']) { const c = JSON.parse(JSON.stringify(base)); c.name = nombre.toUpperCase(); c.fav = false; delete c.id; flipClon.keep(c); }
      flipClon.fav(flipClon.looks().find(l => l.name === 'ZAFIRO').id, true);
      flipClon.gallery(false); flipClon.gallery(true);
      const cartas = () => [...document.querySelectorAll('.clon-carta b')].map(x => x.textContent), chip = document.querySelector('[data-clon="orden"]');
      const out = { modo: flipClon.order(), chip: chip.textContent, visible: !chip.hidden, porNombre: cartas() };
      chip.click();
      out.modo2 = flipClon.order(); out.chip2 = chip.textContent; out.recientes = cartas();
      return out;
    });
    const esperado = orden.porNombre.slice().sort((x, y) => x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' }));
    assert.ok(orden.modo === 'a-z' && orden.chip === 'A – Z' && orden.visible, 'de fábrica, por nombre: ' + JSON.stringify([orden.modo, orden.chip]));
    assert.deepEqual(orden.porNombre, esperado, 'en orden alfabético');
    assert.ok(orden.porNombre.indexOf('ÁRBOL') < orden.porNombre.indexOf('BRUMA') && orden.porNombre.indexOf('LOOK 2') < orden.porNombre.indexOf('LOOK 10') && orden.porNombre[orden.porNombre.length - 1] === 'ZAFIRO', 'los acentos no descolocan, «2» va antes que «10» y la estrella no cambia el sitio: ' + JSON.stringify(orden.porNombre));
    assert.ok(orden.modo2 === 'recientes' && orden.chip2 === 'RECIENTES' && orden.recientes[0] === 'ZAFIRO', 'el chip pasa a RECIENTES (favoritos primero): ' + JSON.stringify(orden.recientes));
    await b.page.reload();
    await b.page.waitForFunction(() => window.flipClon && flipClon.looks().length === 8, null, { timeout: 20000 });
    assert.equal(await b.page.evaluate(() => flipClon.order()), 'recientes', 'y el orden elegido se recuerda');
    step('la galería va por nombre y el chip cambia de orden', { porNombre: orden.porNombre });

    const errors = a.errors.concat(b.errors);
    assert.deepEqual(errors, [], 'sin errores de página: ' + errors.join(' | '));
    console.log('\nPASE: todo en orden');
  } finally { await browser.close(); }
})().catch(error => { console.error('\n✗ ' + (error && error.stack || error)); process.exit(1); });
