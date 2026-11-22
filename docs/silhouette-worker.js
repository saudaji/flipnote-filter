// Segmentación de personas fuera del hilo principal.
// Usa siempre el delegado de CPU: en GPUs como la PowerVR del Pixel 10 la lectura de la máscara
// del delegado de GPU falla sin lanzar error y devuelve todo ceros.
// Protocolo:
//   → { type:'init', lib, wasm, model }
//   ← { type:'ready', ms } | { type:'error', stage, message }
//   → { type:'frame', id, bitmap }            (el ImageBitmap se transfiere)
//   ← { type:'mask', id, width, height, data, ms }   (data: Float32Array transferido, 0…1)
'use strict';
let segmenter = null;
let lastStamp = 0;

async function init(msg) {
  const started = performance.now();
  const { ImageSegmenter, FilesetResolver } = await import(msg.lib);
  const vision = await FilesetResolver.forVisionTasks(msg.wasm);
  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: msg.model, delegate: 'CPU' },
    outputCategoryMask: false,
    outputConfidenceMasks: true,
    runningMode: 'VIDEO',
  });
  postMessage({ type: 'ready', ms: Math.round(performance.now() - started) });
}

function frame(msg) {
  const bitmap = msg.bitmap;
  if (!segmenter) { bitmap.close(); return; }
  const started = performance.now();
  // El grafo exige marcas de tiempo estrictamente crecientes.
  const stamp = Math.max(lastStamp + 1, Math.round(started));
  lastStamp = stamp;
  let result = null;
  try {
    result = segmenter.segmentForVideo(bitmap, stamp);
    const mask = result.confidenceMasks[0];
    const data = mask.getAsFloat32Array().slice();
    postMessage({ type: 'mask', id: msg.id, width: mask.width, height: mask.height, data, ms: performance.now() - started }, [data.buffer]);
  } catch (error) {
    postMessage({ type: 'error', stage: 'frame', id: msg.id, message: String(error && error.message || error) });
  } finally {
    if (result) result.close();
    bitmap.close();
  }
}

onmessage = event => {
  const msg = event.data || {};
  if (msg.type === 'init') {
    init(msg).catch(error => postMessage({ type: 'error', stage: 'init', message: String(error && error.message || error) }));
  } else if (msg.type === 'frame') {
    frame(msg);
  } else if (msg.type === 'close') {
    try { if (segmenter) segmenter.close(); } catch (_) {}
    segmenter = null;
    close();
  }
};
