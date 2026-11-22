'use strict';

// Multiple input events may wake the same loop before its next display frame.
const pendingFrames = new Set();
const frameCallbacks = new WeakMap();
function scheduleFrame(loop) {
  if (pendingFrames.has(loop)) return;
  let callback = frameCallbacks.get(loop);
  if (!callback) {
    callback = time => {
      pendingFrames.delete(loop);
      loop(time);
    };
    frameCallbacks.set(loop, callback);
  }
  pendingFrames.add(loop);
  requestAnimationFrame(callback);
}

const analyserSnapshots = new WeakMap();
function sampleAudio(analyser) {
  let snapshot = analyserSnapshots.get(analyser);
  if (!snapshot || snapshot.timeData.length !== analyser.fftSize) {
    snapshot = {
      freqData: new Uint8Array(analyser.frequencyBinCount),
      timeData: new Uint8Array(analyser.fftSize),
    };
    analyserSnapshots.set(analyser, snapshot);
  }
  analyser.getByteFrequencyData(snapshot.freqData);
  analyser.getByteTimeDomainData(snapshot.timeData);
  return snapshot;
}
