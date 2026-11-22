// Seguimiento de manos fuera del hilo principal, para PORTAL y STAGE.
// El delegado lo elige quien lo lanza: CPU es el de referencia (igual en todos los dispositivos);
// GPU es varias veces más rápido, pero en algunas GPU móviles su lectura de resultados no es de
// fiar, así que portal.js solo lo adopta después de comprobar que coincide con el de CPU.
// Protocolo:
//   → { type:'init', lib, wasm, model, delegate:'CPU'|'GPU' }
//   ← { type:'ready', ms } | { type:'error', stage, message }
//   → { type:'frame', id, bitmap }                       (el ImageBitmap se transfiere)
//   ← { type:'hands', id, hands:[{ points: Float32Array(42), meta: Float32Array(3)|null, score }], ms }
//       points: x,y normalizados (0…1) de los 21 puntos de cada mano, en el espacio de la imagen enviada
//       meta: distancias reales en metros (del modelo 3D de la mano): anular–pulgar, índice–pulgar,
//             índice–muñeca. En 2D dos yemas pueden coincidir por perspectiva sin tocarse; en 3D no.
'use strict';
let tracker = null;
let lastStamp = 0;

async function init(msg) {
  const started = performance.now();
  const { HandLandmarker, FilesetResolver } = await import(msg.lib);
  const vision = await FilesetResolver.forVisionTasks(msg.wasm);
  tracker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: msg.model, delegate: msg.delegate === 'GPU' ? 'GPU' : 'CPU' },
    ...(msg.delegate === 'GPU' && typeof OffscreenCanvas !== 'undefined' ? { canvas: new OffscreenCanvas(8, 8) } : {}),
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
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
    const sides = result.handedness || result.handednesses || [];
    const world = result.worldLandmarks || [];
    const hands = (result.landmarks || []).map((landmarks, index) => {
      const points = new Float32Array(42);
      for (let i = 0; i < 21; i++) { points[2 * i] = landmarks[i].x; points[2 * i + 1] = landmarks[i].y; }
      const w = world[index];
      const far = (a, b) => Math.hypot(w[a].x - w[b].x, w[a].y - w[b].y, w[a].z - w[b].z);
      const meta = w && w.length >= 21 ? new Float32Array([far(16, 4), far(8, 4), far(8, 0)]) : null;
      return { points, meta, score: sides[index] && sides[index][0] ? sides[index][0].score : 1 };
    });
    postMessage({ type: 'hands', id: msg.id, hands, ms: performance.now() - started }, hands.map(hand => hand.points.buffer));
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
