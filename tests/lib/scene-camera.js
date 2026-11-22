// Cámara simulada para las pruebas: si existe window.__flipSceneCamera, getUserMedia
// devuelve un canvas.captureStream() que dibuja una escena de tests/scenes.js.
// Campos: scene, options, w, h, fps, freeze (segundos fijos), torch (LED simulado),
// deny (número de solicitudes de vídeo que se rechazan antes de conceder).
(function () {
  'use strict';
  const cfg = window.__flipSceneCamera;
  if (!cfg || !navigator.mediaDevices) return;
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const state = window.__flipSceneCameraState = { opens: 0, live: 0, denied: 0, torch: [], facing: [], audioLive: 0 };
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    if (!constraints || !constraints.video) {
      const audio = await real(constraints);
      audio.getAudioTracks().forEach(track => {
        state.audioLive++;
        const stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => { if (!stopped) { stopped = true; state.audioLive--; } stop(); };
      });
      return audio;
    }
    const live = window.__flipSceneCamera;
    if (live.deny > 0) {
      live.deny--;
      state.denied++;
      throw new DOMException('Permission denied', 'NotAllowedError');
    }
    const w = live.w || 640, h = live.h || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const started = performance.now();
    let alive = true, torch = false;
    const video = constraints.video === true ? {} : constraints.video;
    const wanted = video.facingMode;
    const facing = (wanted && (wanted.exact || wanted.ideal || wanted)) || 'user';
    const tick = () => {
      if (!alive) return;
      const now = window.__flipSceneCamera;
      const t = now.freeze != null ? now.freeze : (performance.now() - started) / 1000;
      // El LED simulado ilumina la escena: las pruebas ven la diferencia entre encendido y apagado.
      FlipScenes.draw(ctx, w, h, now.scene, t, torch ? { ...(now.options || {}), ...(now.torchOptions || {}) } : now.options);
      requestAnimationFrame(tick);
    };
    tick();
    const stream = canvas.captureStream(live.fps || 30);
    const track = stream.getVideoTracks()[0];
    const stop = track.stop.bind(track);
    track.stop = () => { if (alive) { alive = false; state.live--; } stop(); };
    let applied = {};
    track.getCapabilities = () => (live.torch && facing === 'environment' ? { torch: true, facingMode: [facing] } : { facingMode: [facing] });
    track.getSettings = () => ({ width: w, height: h, frameRate: live.fps || 30, facingMode: facing, torch });
    track.getConstraints = () => applied;
    track.applyConstraints = async next => {
      applied = next || {};
      const last = (applied.advanced || []).filter(entry => 'torch' in entry).pop();
      if (last) {
        if (!track.getCapabilities().torch) throw new DOMException('torch not supported', 'OverconstrainedError');
        torch = !!last.torch;
        state.torch.push(torch);
      }
    };
    if (constraints.audio) {
      try { (await real({ audio: constraints.audio })).getAudioTracks().forEach(audio => stream.addTrack(audio)); } catch (_) {}
    }
    state.opens++; state.live++; state.facing.push(facing);
    return stream;
  };
})();
