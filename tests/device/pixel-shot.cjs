// Captura de la pestaña de la copia de trabajo en el Pixel. Uso: node pixel-shot.cjs salida.jpg [expresión JS previa]
'use strict';
const P = require('./pixel-lib.cjs');
(async () => {
  const page = (await P.targets()).find(t => t.type === 'page' && t.url.startsWith(process.env.PIXEL_URL || 'http://localhost:8760'));
  const c = await P.connect(page);
  if (process.argv[3]) { console.log(JSON.stringify(await c.evaluate(process.argv[3]))); await P.sleep(Number(process.env.PIXEL_WAIT || 900)); }
  await c.screenshot(process.argv[2], { quality: 60 });
  const errs = c.log.filter(e => /exception|error/.test(e.kind) && !/XNNPACK|odml/.test(e.text));
  if (errs.length) console.log('errores:', errs.slice(-5).map(e => e.text.slice(0, 200)));
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
