// FLIP · MP4 de una pieza.
//
// MediaRecorder (Chrome y Safari) escribe MP4 «fragmentado»: la cabecera llega sin tabla de
// cuadros y cada tramo trae la suya (moof). Sirve para emitir en directo, pero quien abre el
// archivo para importarlo —Instagram, WhatsApp, el carrete— espera el MP4 de siempre, con el
// índice completo en la cabecera, y si no lo encuentra da error o no deja recortar.
//
// flatten() reescribe solo el índice: los cuadros y el sonido se quedan como salieron del
// codificador (no se vuelve a comprimir nada) y el resultado es un Blob hecho de trozos del
// original, así que una toma larga no se duplica en memoria. Ante cualquier cosa que no
// entienda devuelve el archivo tal cual: una toma nunca se pierde por esto.
(function (root) {
  'use strict';

  const TWO32 = 4294967296;
  const str = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const u64 = (dv, o) => dv.getUint32(o) * TWO32 + dv.getUint32(o + 4);

  // Hijos directos de una caja contenedora ya leída.
  function children(dv, start, end) {
    const out = [];
    let off = start;
    while (off + 8 <= end) {
      let size = dv.getUint32(off), head = 8;
      const type = str(dv, off + 4);
      if (size === 1) { if (off + 16 > end) break; size = u64(dv, off + 8); head = 16; }
      else if (size === 0) size = end - off;
      if (size < head || off + size > end) break;
      out.push({ type, off, size, head, body: off + head, end: off + size });
      off += size;
    }
    return out;
  }
  const child = (list, type) => list.find(b => b.type === type);
  const bytesOf = (dv, box) => new Uint8Array(dv.buffer, dv.byteOffset + box.off, box.size).slice();

  // Cajas de primer nivel, leyendo solo las cabeceras (los mdat no se cargan).
  async function topLevel(blob) {
    const out = [];
    let off = 0;
    while (off + 8 <= blob.size) {
      const dv = new DataView(await blob.slice(off, Math.min(blob.size, off + 16)).arrayBuffer());
      let size = dv.getUint32(0), head = 8;
      const type = str(dv, 4);
      if (size === 1) { if (dv.byteLength < 16) break; size = u64(dv, 8); head = 16; }
      else if (size === 0) size = blob.size - off;
      if (size < head) break;
      out.push({ type, off, size: Math.min(size, blob.size - off), head });
      off += size;
    }
    return out;
  }

  function parseMoov(dv) {
    const movie = { tracks: new Map(), order: [], mvhd: null, timescale: 1000, fragmented: false };
    for (const box of children(dv, 8, dv.byteLength)) {
      if (box.type === 'mvhd') {
        movie.mvhd = bytesOf(dv, box);
        movie.timescale = dv.getUint32(box.body + (dv.getUint8(box.body) ? 20 : 12)) || 1000;
      } else if (box.type === 'trak') {
        const track = parseTrak(dv, box);
        if (track) { movie.tracks.set(track.id, track); movie.order.push(track.id); }
      } else if (box.type === 'mvex') {
        movie.fragmented = true;
        for (const sub of children(dv, box.body, box.end)) {
          if (sub.type !== 'trex') continue;
          movie.trex = movie.trex || new Map();
          movie.trex.set(dv.getUint32(sub.body + 4), {
            desc: dv.getUint32(sub.body + 8), duration: dv.getUint32(sub.body + 12),
            size: dv.getUint32(sub.body + 16), flags: dv.getUint32(sub.body + 20),
          });
        }
      }
    }
    return movie;
  }

  function parseTrak(dv, trak) {
    const kids = children(dv, trak.body, trak.end);
    const tkhd = child(kids, 'tkhd'), mdia = child(kids, 'mdia');
    if (!tkhd || !mdia) return null;
    const mk = children(dv, mdia.body, mdia.end);
    const mdhd = child(mk, 'mdhd'), hdlr = child(mk, 'hdlr'), minf = child(mk, 'minf');
    if (!mdhd || !hdlr || !minf) return null;
    const nk = children(dv, minf.body, minf.end);
    const stbl = child(nk, 'stbl');
    if (!stbl) return null;
    const sk = children(dv, stbl.body, stbl.end);
    const stsd = child(sk, 'stsd');
    if (!stsd) return null;
    const stsz = child(sk, 'stsz');
    const edts = child(kids, 'edts');
    return {
      id: dv.getUint32(tkhd.body + (dv.getUint8(tkhd.body) ? 20 : 12)),
      tkhd: bytesOf(dv, tkhd),
      edts: edts ? bytesOf(dv, edts) : null,
      mdhd: bytesOf(dv, mdhd),
      hdlr: bytesOf(dv, hdlr),
      handler: str(dv, hdlr.body + 8),
      timescale: dv.getUint32(mdhd.body + (dv.getUint8(mdhd.body) ? 20 : 12)) || 1,
      minfHead: nk.filter(b => b.type !== 'stbl').map(b => bytesOf(dv, b)),
      stsd: bytesOf(dv, stsd),
      codec: str(dv, stsd.body + 12),
      tableSamples: stsz ? dv.getUint32(stsz.body + 8) : 0,
      sizes: [], durations: [], sync: [], cts: [], offsets: [], desc: [],
      anyCts: false, allSync: true, start: null, next: 0,
    };
  }

  // Un moof: añade a cada pista sus cuadros con la posición que ocupan en el archivo de origen.
  function parseMoof(dv, at, movie, limit) {
    let previousEnd = at, index = 0;
    for (const traf of children(dv, 8, dv.byteLength)) {
      if (traf.type !== 'traf') continue;
      const kids = children(dv, traf.body, traf.end);
      const tfhd = child(kids, 'tfhd');
      if (!tfhd) continue;
      const flags = dv.getUint32(tfhd.body) & 0xffffff;
      const track = movie.tracks.get(dv.getUint32(tfhd.body + 4));
      const trex = (movie.trex && track && movie.trex.get(track.id)) || { desc: 1, duration: 0, size: 0, flags: 0 };
      let p = tfhd.body + 8;
      let base = (flags & 0x20000) || index === 0 ? at : previousEnd;
      if (flags & 0x1) { base = u64(dv, p); p += 8; }
      let desc = trex.desc || 1, defDuration = trex.duration, defSize = trex.size, defFlags = trex.flags;
      if (flags & 0x2) { desc = dv.getUint32(p); p += 4; }
      if (flags & 0x8) { defDuration = dv.getUint32(p); p += 4; }
      if (flags & 0x10) { defSize = dv.getUint32(p); p += 4; }
      if (flags & 0x20) { defFlags = dv.getUint32(p); p += 4; }
      index++;
      if (!track) continue;

      const tfdt = child(kids, 'tfdt');
      if (tfdt) {
        const decode = dv.getUint8(tfdt.body) ? u64(dv, tfdt.body + 4) : dv.getUint32(tfdt.body + 4);
        if (track.start === null) { track.start = decode; track.next = decode; }
        else if (decode > track.next && track.durations.length) {
          // Hueco entre tramos: el último cuadro dura hasta el siguiente, para no perder el compás.
          track.durations[track.durations.length - 1] += decode - track.next;
          track.next = decode;
        }
      } else if (track.start === null) track.start = 0;

      let cursor = null;
      for (const trun of kids) {
        if (trun.type !== 'trun') continue;
        const version = dv.getUint8(trun.body), tf = dv.getUint32(trun.body) & 0xffffff;
        const count = dv.getUint32(trun.body + 4);
        let q = trun.body + 8;
        let pos = cursor === null ? base : cursor;
        if (tf & 0x1) { pos = base + dv.getInt32(q); q += 4; }
        let firstFlags = null;
        if (tf & 0x4) { firstFlags = dv.getUint32(q); q += 4; }
        for (let i = 0; i < count; i++) {
          let duration = defDuration, size = defSize, sampleFlags = i === 0 && firstFlags !== null ? firstFlags : defFlags, offset = 0;
          if (tf & 0x100) { duration = dv.getUint32(q); q += 4; }
          if (tf & 0x200) { size = dv.getUint32(q); q += 4; }
          if (tf & 0x400) { sampleFlags = dv.getUint32(q); q += 4; }
          if (tf & 0x800) { offset = version ? dv.getInt32(q) : dv.getUint32(q); q += 4; }
          if (pos + size > limit) { cursor = pos; break; }      // tramo final cortado: hasta aquí
          const key = !(sampleFlags & 0x10000);
          track.sizes.push(size); track.durations.push(duration); track.sync.push(key);
          track.cts.push(offset); track.offsets.push(pos); track.desc.push(desc);
          if (offset) track.anyCts = true;
          if (!key) track.allSync = false;
          track.next += duration;
          pos += size;
        }
        cursor = pos;
      }
      if (cursor !== null) previousEnd = cursor;
    }
  }

  // ── Escritura ────────────────────────────────────────────────────────────────────────────
  function box(type, ...parts) {
    let size = 8;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size), dv = new DataView(out.buffer);
    dv.setUint32(0, size);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let off = 8;
    for (const part of parts) { out.set(part, off); off += part.length; }
    return out;
  }
  function table(words) {                       // versión/flags a cero + palabras de 32 bits
    const out = new Uint8Array(4 + words.length * 4), dv = new DataView(out.buffer);
    for (let i = 0; i < words.length; i++) dv.setUint32(4 + i * 4, words[i] >>> 0);
    return out;
  }
  function runs(values) {                       // [cuenta, valor, cuenta, valor…]
    const out = [];
    for (let i = 0; i < values.length;) {
      let j = i + 1;
      while (j < values.length && values[j] === values[i]) j++;
      out.push(j - i, values[i]);
      i = j;
    }
    return out;
  }
  function setDuration(bytes, value) {          // mvhd, tkhd y mdhd: la duración según la versión
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = str(dv, 4), v1 = dv.getUint8(8) === 1;
    const at = 8 + (type === 'tkhd' ? (v1 ? 28 : 20) : (v1 ? 24 : 16));
    if (v1) { dv.setUint32(at, Math.floor(value / TWO32)); dv.setUint32(at + 4, value >>> 0); }
    else dv.setUint32(at, Math.min(value, 0xffffffff));
    if (type === 'tkhd') bytes[11] |= 7;        // pista activa, en la película y en la vista previa
    return bytes;
  }

  function buildTrack(track, movie, mapOffset, wide) {
    const n = track.sizes.length;
    // Un cuadro sin duración (el último de la toma) dura lo que el anterior.
    for (let i = 0; i < n; i++) if (!track.durations[i]) track.durations[i] = track.durations[i - 1] || track.durations[i + 1] || 1;
    const media = track.durations.reduce((a, b) => a + b, 0);
    const toMovie = value => Math.round(value * movie.timescale / track.timescale);
    const lead = Math.max(0, Math.round(((track.start || 0) / track.timescale - movie.origin) * movie.timescale));  // empieza tarde: hueco inicial
    const shift = track.anyCts ? track.cts.reduce((a, b) => Math.min(a, b), 0) : 0;
    const first = track.anyCts ? track.cts[0] : 0;
    track.movieDuration = lead + toMovie(media);

    // Trozos: cuadros seguidos en el archivo.
    const chunks = [];
    for (let i = 0; i < n; i++) {
      const last = chunks[chunks.length - 1];
      if (last && last.desc === track.desc[i] && last.end === track.offsets[i] && last.count < 64) { last.count++; last.end += track.sizes[i]; }
      else chunks.push({ at: track.offsets[i], end: track.offsets[i] + track.sizes[i], count: 1, desc: track.desc[i] });
    }
    const stsc = [];
    chunks.forEach((chunk, i) => {
      const prev = chunks[i - 1];
      if (!prev || prev.count !== chunk.count || prev.desc !== chunk.desc) stsc.push(i + 1, chunk.count, chunk.desc);
    });
    const offsets = chunks.map(chunk => mapOffset(chunk.at));
    let chunkOffsets;
    if (wide) {
      const bytes = new Uint8Array(8 + offsets.length * 8), dv = new DataView(bytes.buffer);
      dv.setUint32(4, offsets.length);
      offsets.forEach((value, i) => { dv.setUint32(8 + i * 8, Math.floor(value / TWO32)); dv.setUint32(12 + i * 8, value >>> 0); });
      chunkOffsets = box('co64', bytes);
    } else chunkOffsets = box('stco', table([offsets.length, ...offsets]));

    const stts = runs(track.durations);
    const parts = [track.stsd, box('stts', table([stts.length / 2, ...stts]))];
    if (!track.allSync) {
      const keys = [];
      track.sync.forEach((key, i) => { if (key) keys.push(i + 1); });
      if (keys.length) parts.push(box('stss', table([keys.length, ...keys])));
    }
    if (track.anyCts) {
      const ctts = runs(track.cts), bytes = table([ctts.length / 2, ...ctts]);
      if (shift < 0) bytes[0] = 1;                          // desplazamientos con signo
      parts.push(box('ctts', bytes));
    }
    parts.push(box('stsc', table([stsc.length / 3, ...stsc])));
    parts.push(box('stsz', table([0, n, ...track.sizes])));
    parts.push(chunkOffsets);

    const kids = [setDuration(track.tkhd, track.movieDuration)];
    if (lead > 0 || first > 0) {
      const entries = [];
      if (lead > 0) entries.push(lead, 0xffffffff, 0x10000);
      entries.push(toMovie(media), first, 0x10000);
      kids.push(box('edts', box('elst', table([entries.length / 3, ...entries]))));
    }
    kids.push(box('mdia', setDuration(track.mdhd, media), track.hdlr, box('minf', ...track.minfHead, box('stbl', ...parts))));
    return box('trak', ...kids);
  }

  async function flatten(blob) {
    const t0 = (root.performance || Date).now();
    const type = String(blob.type || 'video/mp4').split(';')[0] || 'video/mp4';
    const same = reason => ({ blob, info: { changed: false, reason } });
    let top;
    try { top = await topLevel(blob); } catch (_) { return same('ilegible'); }
    const moovBox = top.find(b => b.type === 'moov');
    const moofs = top.filter(b => b.type === 'moof');
    const mdats = top.filter(b => b.type === 'mdat');
    if (!moovBox || !top.some(b => b.type === 'ftyp')) return same('no es MP4');
    if (!moofs.length) return same('ya es de una pieza');
    if (!mdats.length) return same('sin datos');

    const movie = parseMoov(new DataView(await blob.slice(moovBox.off, moovBox.off + moovBox.size).arrayBuffer()));
    if (!movie.mvhd || !movie.tracks.size) return same('cabecera incompleta');
    if ([...movie.tracks.values()].some(track => track.tableSamples)) return same('mezcla de índice y tramos');
    for (const moof of moofs) {
      parseMoof(new DataView(await blob.slice(moof.off, moof.off + moof.size).arrayBuffer()), moof.off, movie, blob.size);
    }
    const tracks = movie.order.map(id => movie.tracks.get(id)).filter(track => track.sizes.length);
    if (!tracks.length) return same('sin cuadros');
    // El reloj de la película arranca con la pista que empieza antes.
    movie.origin = Math.min(...tracks.map(track => (track.start || 0) / track.timescale));

    // Los datos se copian en el orden en que están; cada mdat aporta su contenido entero.
    const spans = [];
    let total = 0;
    for (const mdat of mdats) {
      const start = mdat.off + mdat.head, end = mdat.off + mdat.size;
      if (end > start) { spans.push({ start, end, base: total }); total += end - start; }
    }
    const inside = at => {
      let lo = 0, hi = spans.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, span = spans[mid];
        if (at < span.start) hi = mid - 1; else if (at >= span.end) lo = mid + 1; else return span;
      }
      return null;
    };
    for (const track of tracks) {
      for (let i = 0; i < track.sizes.length; i++) {
        const span = inside(track.offsets[i]);
        if (!span || track.offsets[i] + track.sizes[i] > span.end) return same('cuadros fuera de los datos');
      }
    }

    const brands = ['isom', 'iso2'];
    if (tracks.some(track => /^avc[13]$/.test(track.codec))) brands.push('avc1');
    brands.push('mp41');
    const ftyp = box('ftyp', new TextEncoder().encode('isom'), new Uint8Array([0, 0, 2, 0]), new TextEncoder().encode(brands.join('')));
    const wide = blob.size + 65536 >= TWO32;
    const build = dataStart => {
      const mapOffset = at => { const span = inside(at); return dataStart + span.base + (at - span.start); };
      const traks = tracks.map(track => buildTrack(track, movie, mapOffset, wide));
      const duration = Math.max(...tracks.map(track => track.movieDuration));
      return box('moov', setDuration(movie.mvhd, duration), ...traks);
    };
    const mdatHead = total + 8 >= TWO32 ? 16 : 8;
    const probe = build(0);                                  // primero el tamaño, luego las posiciones
    const moov = build(ftyp.length + probe.length + mdatHead);
    if (moov.length !== probe.length) return same('índice inestable');
    const head = new Uint8Array(mdatHead), hv = new DataView(head.buffer);
    if (mdatHead === 16) { hv.setUint32(0, 1); hv.setUint32(8, Math.floor((total + 16) / TWO32)); hv.setUint32(12, (total + 16) >>> 0); }
    else hv.setUint32(0, total + 8);
    head.set([0x6d, 0x64, 0x61, 0x74], 4);

    const out = new Blob([ftyp, moov, head, ...spans.map(span => blob.slice(span.start, span.end))], { type });
    return {
      blob: out,
      info: {
        changed: true,
        fragments: moofs.length,
        ms: Math.round((root.performance || Date).now() - t0),
        seconds: +(Math.max(...tracks.map(track => track.movieDuration)) / movie.timescale).toFixed(3),
        tracks: tracks.map(track => ({ kind: track.handler, codec: track.codec, samples: track.sizes.length })),
      },
    };
  }

  const api = { flatten };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.flipMp4 = api;
})(typeof self !== 'undefined' ? self : globalThis);
