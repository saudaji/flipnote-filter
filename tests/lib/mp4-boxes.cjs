// Vuelca la estructura de cajas de un MP4 y lo que importa para que otra app lo importe:
// si está fragmentado, las duraciones declaradas y los códecs.
//   node mp4-boxes.cjs archivo.mp4 [--json]
'use strict';
const fs = require('node:fs');

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf', 'udta']);

function walk(buf, start, end, depth, out, parent) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let head = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); head = 16; }
    else if (size === 0) size = end - off;
    if (size < head || off + size > end) { out.push({ depth, type: '??' + type, off, size }); break; }
    const box = { depth, type, off, size, head, parent };
    out.push(box);
    if (CONTAINERS.has(type)) walk(buf, off + head, off + size, depth + 1, out, box);
    off += size;
  }
  return out;
}

function inspect(file) {
  const buf = fs.readFileSync(file);
  const boxes = walk(buf, 0, buf.length, 0, []);
  const of = type => boxes.filter(b => b.type === type);
  const info = { bytes: buf.length, top: boxes.filter(b => b.depth === 0).map(b => b.type) };
  const mvhd = of('mvhd')[0];
  if (mvhd) {
    const p = mvhd.off + mvhd.head, v = buf[p];
    const timescale = buf.readUInt32BE(p + (v ? 20 : 12));
    const duration = v ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
    info.mvhd = { timescale, duration, seconds: +(duration / timescale).toFixed(3) };
  }
  info.tracks = of('trak').map(trak => {
    const inside = boxes.filter(b => b.off > trak.off && b.off < trak.off + trak.size);
    const pick = type => inside.find(b => b.type === type);
    const t = {};
    const hdlr = pick('hdlr'); if (hdlr) t.handler = buf.toString('latin1', hdlr.off + hdlr.head + 8, hdlr.off + hdlr.head + 12);
    const mdhd = pick('mdhd');
    if (mdhd) {
      const p = mdhd.off + mdhd.head, v = buf[p];
      t.timescale = buf.readUInt32BE(p + (v ? 20 : 12));
      t.duration = v ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
    }
    const stsd = pick('stsd'); if (stsd) t.codec = buf.toString('latin1', stsd.off + stsd.head + 12, stsd.off + stsd.head + 16);
    const stsz = pick('stsz'); if (stsz) t.samplesInTable = buf.readUInt32BE(stsz.off + stsz.head + 8);
    const stts = pick('stts'); if (stts) t.sttsEntries = buf.readUInt32BE(stts.off + stts.head + 4);
    t.elst = !!pick('elst');
    return t;
  });
  info.fragmented = of('moof').length > 0 || of('mvex').length > 0;
  info.fragments = of('moof').length;
  info.moovBeforeData = info.top.indexOf('moov') >= 0 && info.top.indexOf('moov') < info.top.indexOf('mdat');
  const ftyp = of('ftyp')[0];
  if (ftyp) {
    const brands = [];
    for (let p = ftyp.off + 16; p + 4 <= ftyp.off + ftyp.size; p += 4) brands.push(buf.toString('latin1', p, p + 4));
    info.brand = buf.toString('latin1', ftyp.off + 8, ftyp.off + 12) + ' [' + brands.join(' ') + ']';
  }
  return { info, boxes };
}

if (require.main === module) {
  const file = process.argv[2];
  const { info, boxes } = inspect(file);
  if (process.argv.includes('--json')) console.log(JSON.stringify(info));
  else {
    console.log(JSON.stringify(info, null, 1));
    if (process.argv.includes('--tree')) for (const b of boxes.slice(0, 80)) console.log('  '.repeat(b.depth) + b.type + ' ' + b.size);
  }
}
module.exports = { inspect };
