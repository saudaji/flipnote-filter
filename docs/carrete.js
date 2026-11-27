// El carrete de FLIP: donde caen las tomas al disparar, sin preguntar nada.
//
// Una página web no puede escribir en el carrete del teléfono: lo más que puede hacer es bajar un
// archivo (en iPhone, a Archivos y con un aviso por toma; en Android, a Descargas y con una
// notificación por toma) o abrir la hoja de compartir (un toque más por toma). Disparar así es un
// trámite. Con el carrete, la toma se guarda aquí dentro al instante —en el almacén del navegador,
// en este teléfono— y la persona sigue disparando; cuando quiera, las manda TODAS de una vez a Fotos
// (una sola hoja de compartir) o a Descargas.
//
//   flipCarrete.add(blob, nombre, miniatura?)  guarda una toma; devuelve su ficha { id, … }
//   flipCarrete.list()                         las fichas, la más nueva primero (sin el archivo)
//   flipCarrete.get(id)                        la ficha con su archivo (blob)
//   flipCarrete.saved(ids)                     marca tomas como ya sacadas del carrete
//   flipCarrete.remove(ids)                    las borra
//   flipCarrete.stats()                        { count, pending, bytes, persistent }
//
// Caben MAX_ITEMS tomas o MAX_BYTES; al llenarse salen primero las más viejas YA guardadas fuera. Si
// todas siguen sin guardar, add() falla con «lleno» y quien llama baja la toma como antes: una toma
// no se pierde ni se pisa sin permiso. Si el navegador no deja usar su almacén (modo privado), el
// carrete vive en memoria mientras la página esté abierta (persistent: false).
const flipCarrete = (() => {
  'use strict';
  const DB = 'flip-carrete', STORE = 'tomas', MAX_ITEMS = 150, MAX_BYTES = 700 * 1048576;
  let opening = null, memory = null, index = null, nextId = 1, asked = false, asBytes = false;
  const req = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  function open() {
    if (memory) return Promise.resolve(null);
    if (!opening) opening = new Promise((ok, no) => {
      let r;
      try { r = indexedDB.open(DB, 1); } catch (error) { no(error); return; }
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
      r.onblocked = () => no(new Error('bloqueado'));
    }).catch(() => { memory = new Map(); return null; });
    return opening;
  }
  const store = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);
  const card = r => ({ id: r.id, filename: r.filename, type: r.type, size: r.size, at: r.at, saved: !!r.saved, thumb: r.thumb || '', video: /^video\//.test(r.type) });
  async function load() {
    if (index) return index;
    const db = await open();
    const rows = db ? await req(store(db, 'readonly').getAll()) : [...memory.values()];
    index = rows.map(card).sort((a, b) => b.id - a.id);
    return index;
  }
  // La miniatura de una foto, pequeña (la de un vídeo la da quien llama: es lo que había en el visor).
  async function thumbOf(blob) {
    if (!/^image\//.test(blob.type || '') || typeof createImageBitmap !== 'function') return '';
    try {
      const bmp = await createImageBitmap(blob), k = 160 / Math.max(bmp.width, bmp.height), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return c.toDataURL('image/jpeg', 0.7);
    } catch (_) { return ''; }
  }
  async function drop(ids) {
    const db = await open(), gone = new Set(ids);
    if (db) { const s = store(db, 'readwrite'); await Promise.all(ids.map(id => req(s.delete(id)))); }
    else for (const id of ids) memory.delete(id);
    if (index) index = index.filter(c => !gone.has(c.id));
  }
  async function add(blob, filename, thumb) {
    const list = await load();
    // sitio: salen las más viejas ya guardadas fuera; si no basta, no cabe
    let bytes = list.reduce((sum, c) => sum + c.size, 0);
    const out = [];
    for (let i = list.length - 1; i >= 0 && (list.length - out.length >= MAX_ITEMS || bytes + blob.size > MAX_BYTES); i--) if (list[i].saved) { out.push(list[i].id); bytes -= list[i].size; }
    if (list.length - out.length >= MAX_ITEMS || bytes + blob.size > MAX_BYTES) throw new Error('lleno');
    if (out.length) await drop(out);
    if (!asked) { asked = true; try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {} }
    const row = { blob, filename, type: blob.type || '', size: blob.size, at: Date.now(), saved: false, thumb: thumb || await thumbOf(blob) };
    const db = await open();
    if (db) {
      // Safari, en algunas sesiones (navegación privada, y el motor de las pruebas), no deja guardar un
      // archivo como tal en el almacén («Error preparing Blob/File data…»): ahí se guardan sus bytes.
      if (!asBytes) { try { row.id = await req(store(db, 'readwrite').add(row)); } catch (_) { asBytes = true; } }
      if (asBytes) { const bytes = { ...row, blob: null, data: await blob.arrayBuffer() }; row.id = await req(store(db, 'readwrite').add(bytes)); }
    }
    else { row.id = nextId++; memory.set(row.id, row); }
    index.unshift(card(row));
    return index[0];
  }
  async function get(id) {
    const db = await open(), row = db ? await req(store(db, 'readonly').get(id)) : memory.get(id) || null;
    if (row && !row.blob && row.data) row.blob = new Blob([row.data], { type: row.type });
    return row || null;
  }
  async function saved(ids) {
    const db = await open(), set = new Set(ids);
    if (db) { const s = store(db, 'readwrite'); for (const id of ids) { const row = await req(s.get(id)); if (row) { row.saved = true; await req(s.put(row)); } } }
    else for (const id of ids) { const row = memory.get(id); if (row) row.saved = true; }
    for (const c of await load()) if (set.has(c.id)) c.saved = true;
  }
  return {
    add, get, saved,
    remove: ids => drop([].concat(ids)),
    list: async () => (await load()).map(c => ({ ...c })),
    stats: async () => { const list = await load(); return { count: list.length, pending: list.filter(c => !c.saved).length, bytes: list.reduce((sum, c) => sum + c.size, 0), persistent: !memory }; },
    MAX_ITEMS,
  };
})();
