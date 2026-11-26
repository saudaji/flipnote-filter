// Malla de rostro fuera del hilo principal, para CONSOLA (la cara en facetas).
// Mismo trato que el seguimiento de manos: delegado de CPU (igual en todos los dispositivos).
// Protocolo:
//   → { type:'init', lib, wasm, model }
//   ← { type:'ready', ms } | { type:'error', stage, message }
//   → { type:'frame', id, bitmap }                       (el ImageBitmap se transfiere)
//   ← { type:'face', id, points: Float32Array(956)|null, ms }
//       points: x,y normalizados (0…1) de los 478 puntos de la cara, en el espacio de la imagen enviada
'use strict';
let tracker = null;
let lastStamp = 0;

async function init(msg) {
  const started = performance.now();
  const { FaceLandmarker, FilesetResolver } = await import(msg.lib);
  const vision = await FilesetResolver.forVisionTasks(msg.wasm);
  tracker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: msg.model, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  postMessage({ type: 'ready', ms: Math.round(performance.now() - started) });
}

function frame(msg) {
  const bitmap = msg.bitmap;
  if (!tracker) { bitmap.close(); return; }
  const started = performance.now();
  const stamp = Math.max(lastStamp + 1, Math.round(started));
  lastStamp = stamp;
  try {
    const result = tracker.detectForVideo(bitmap, stamp);
    const face = result.faceLandmarks && result.faceLandmarks[0];
    let points = null;
    if (face && face.length >= 468) {
      points = new Float32Array(face.length * 2);
      for (let i = 0; i < face.length; i++) { points[2 * i] = face[i].x; points[2 * i + 1] = face[i].y; }
    }
    postMessage({ type: 'face', id: msg.id, points, ms: performance.now() - started }, points ? [points.buffer] : []);
  } catch (error) {
    postMessage({ type: 'error', stage: 'frame', id: msg.id, message: String(error && error.message || error) });
  } finally {
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
    try { if (tracker) tracker.close(); } catch (_) {}
    tracker = null;
    close();
  }
};
