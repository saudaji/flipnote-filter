// Corre todas las regresiones de FLIP contra FLIP_URL y resume el resultado.
//   node .claude/serve.js 8760 &     (o cualquier servidor estático de docs/)
//   FLIP_URL=http://127.0.0.1:8760 node tests/run-all.cjs
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const TESTS = [
  ['alpha-smoke.cjs'], ['optical-cameras.cjs'], ['night-vision.cjs'], ['vector-beam.cjs'],
  ['material-audit.cjs', '--strict'], ['alpha-flows.cjs'], ['alpha-media.cjs'], ['alpha-performance.cjs', '--seconds', '3', '--soak', '24'],
  ['portal.cjs'], ['feel.cjs'], ['console.cjs'], ['stage.cjs'], ['vfd-crt.cjs'], ['boot-guard.cjs'], ['webkit-smoke.cjs'],
  ['video-file.cjs'], ['object.cjs'], ['pace.cjs'], ['rest.cjs'],
];
let failed = 0;
for (const [file, ...args] of TESTS) {
  const began = Date.now();
  const run = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { encoding: 'utf8', env: process.env });
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file.padEnd(24)} ${((Date.now() - began) / 1000).toFixed(0).padStart(4)} s`);
  if (!ok) console.log((run.stdout + run.stderr).split('\n').slice(-12).join('\n'));
}
console.log(failed ? failed + ' prueba(s) fallan' : 'Todas las pruebas pasan');
process.exitCode = failed ? 1 : 0;
