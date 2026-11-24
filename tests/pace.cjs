// Ritmo de los bucles en una pantalla de 120 Hz (un Pixel). Antes cada motor dibujaba o, como
// poco, se despertaba en cada refresco: 120 veces por segundo. Ahora cada uno tiene su tope
// (docs/frame-runtime.js) y duerme entre cuadro y cuadro. Aquí se comprueba, con la pantalla de
// 120 Hz simulada de tests/energy.cjs, que:
//   · ningún módulo dibuja más deprisa que su tope (30 GLITCH y FLOW, 24 FUSION, 60 SONO, WMP y STAGE);
//   · ninguno se queda corto (el tope no le quita cuadros a nadie);
//   · CAM a 8 cuadros por segundo no despierta el hilo principal 120 veces por segundo.
//   FLIP_URL=http://127.0.0.1:8760 node tests/pace.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flip-pace-')), 'energy.json');
execFileSync(process.execPath, [path.join(__dirname, 'energy.cjs'), '--hz', '120', '--seconds', '3', '--only', 'cam,scrash,sflow,fusion,sono,wmp,stage', '--json', out],
  { stdio: ['ignore', 'ignore', 'inherit'], env: process.env, timeout: 280000 });
const rows = JSON.parse(fs.readFileSync(out, 'utf8')).rows;
const row = name => { const found = rows.find(r => r.name.startsWith(name)); assert.ok(found, 'falta la medida de ' + name); return found; };
const drawn = r => Math.max(0, ...Object.values(r.lienzos));
// Despertares de la app: llamadas de animación (sin las de la cámara simulada, que son de la prueba) y temporizadores.
const wakes = r => r.raf - (r.rafBy.tick || 0) + r.timers;
const step = (name, detail) => console.log('✓ ' + name + ' · ' + JSON.stringify(detail));

const dsi = row('cam DSI (recién abierta)');
const motor = dsi.frames['motor:preview'] || 0;
assert.ok(motor >= 3 && motor <= 14, 'CAM · DSi dibuja a su cadencia: ' + motor);
assert.ok(wakes(dsi) <= motor * 6 + 12, 'CAM · DSi duerme entre cuadros: ' + wakes(dsi).toFixed(0) + ' despertares/s para ' + motor + ' cuadros (antes, 120)');
step('CAM a baja cadencia duerme entre cuadros', { cuadros: motor, despertares: +wakes(dsi).toFixed(0) });

const fast = row('cam OSCAM');
assert.ok((fast.frames['motor:preview'] || 0) >= 26 && fast.frames['motor:preview'] <= 31.5, 'CAM a 30 no pierde cuadros: ' + fast.frames['motor:preview']);
step('CAM a 30 sigue a 30', { cuadros: fast.frames['motor:preview'], despertares: +wakes(fast).toFixed(0) });

for (const [name, low, high, cap] of [['scrash', 26, 32, 30], ['sflow', 12, 32, 30], ['fusion', 20, 26, 24], ['sono', 50, 63, 60], ['wmp', 50, 63, 60], ['stage DIRECTO', 50, 63, 60], ['stage TÚNEL', 50, 63, 60]]) {
  const r = row(name), n = drawn(r);
  assert.ok(n >= low && n <= high, name + ' dibuja ' + n + ' veces por segundo en una pantalla de 120 Hz (se espera entre ' + low + ' y ' + high + ')');
  step(name, { dibujo: n, tope: cap });
}
const hidden = row('cam en segundo plano');
assert.equal(drawn(hidden), 0, 'en segundo plano no se dibuja');
console.log('PACE PASS');
