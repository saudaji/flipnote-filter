// Segmentación de personas fuera del hilo principal.
// Usa siempre el delegado de CPU: en GPUs como la PowerVR del Pixel 10 la lectura de la máscara
// del delegado de GPU falla sin lanzar error y devuelve todo ceros.
// Protocolo:
//   → { type:'init', lib, wasm, model }
//   ← { type:'ready', ms } | { type:'error', stage, message }
//   → { type:'frame', id, bitmap, faces? }    (el ImageBitmap se transfiere; faces: la dirección del
//                                              modelo de caras, si quien pide la máscara las quiere)
//   ← { type:'mask', id, width, height, data, ms, faces }   (data: Float32Array transferido, 0…1;
//                                              faces: [[x0, y0, x1, y1, confianza], …] en fracción
//                                              del cuadro, o null si no se pidieron o aún no cargan)
// Las caras son opcionales y perezosas: el segmentador es un modelo de selfies y, sin nadie cerca,
// toma por persona un sillón o una cortina. Quien necesite estar seguro de que hay una persona
// (CLON · FIGURA) pide además las caras; STAGE y FLOW no las piden y no cargan ese modelo.
'use strict';
let segmenter = null;
let lastStamp = 0;
let lib = null, vision = null, faceDetector = null, faceState = '';   // '', 'loading', 'ready' o 'failed'

function loadFaces(model) {
  faceState = 'loading';
  lib.FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: model, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 })
    .then(detector => { faceDetector = detector; faceState = 'ready'; }, () => { faceState = 'failed'; });
}
function facesIn(bitmap) {
  const w = bitmap.width, h = bitmap.height;
  return faceDetector.detect(bitmap).detections.map(d => {
    const b = d.boundingBox, score = d.categories && d.categories[0] ? d.categories[0].score : 0;
    return [b.originX / w, b.originY / h, (b.originX + b.width) / w, (b.originY + b.height) / h, +score.toFixed(3)];
  });
}

async function init(msg) {
  const started = performance.now();
  lib = await import(msg.lib);
  const { ImageSegmenter, FilesetResolver } = lib;
  vision = await FilesetResolver.forVisionTasks(msg.wasm);
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
    let faces = null;
    if (msg.faces) {
      if (!faceState) loadFaces(msg.faces);
      else if (faceState === 'ready') { try { faces = facesIn(bitmap); } catch (_) { faces = null; } }
    }
    postMessage({ type: 'mask', id: msg.id, width: mask.width, height: mask.height, data, faces, faceState, ms: performance.now() - started }, [data.buffer]);
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
    try { if (faceDetector) faceDetector.close(); } catch (_) {}
    segmenter = null; faceDetector = null;
    close();
  }
};
