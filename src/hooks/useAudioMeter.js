import { useRef, useEffect } from 'react';
import { getAudioContext } from '../utils/audioContext';

// One MediaElementAudioSourceNode per <audio> element. createMediaElementSource
// throws if called twice for the same element, and routing an element through it
// is permanent, so we create the node once and keep it alive in a WeakMap
// (entries are reclaimed when WaveSurfer destroys the element). Each entry also
// holds the analyser tap that drives the level meter.
const sourceCache = new WeakMap();

export function useAudioMeter(wavesurferRef, { key } = {}) {
  const meterRef = useRef(null);

  useEffect(() => {
    let raf = null;
    let analyser = null;
    let smoothed = 0;
    let lastTime = 0;

    const DB_MIN = -60;
    const DECAY_RATE = 8;

    // Route the WaveSurfer <audio> element through our shared AudioContext so we
    // can tap it with an analyser. Once an element is routed through Web Audio it
    // only plays through the graph, so the source MUST also connect to the
    // destination or audio goes silent.
    const ensureAnalyser = () => {
      const ws = wavesurferRef.current;
      if (!ws) return;

      let el = null;
      try { el = ws.getMediaElement(); } catch (e) {}
      if (!el || !(el instanceof HTMLMediaElement)) return;

      let entry = sourceCache.get(el);
      if (!entry) {
        const ctx = getAudioContext();
        try {
          const source = ctx.createMediaElementSource(el);
          const a = ctx.createAnalyser();
          a.fftSize = 2048;
          source.connect(a);
          source.connect(ctx.destination);
          entry = { source, analyser: a };
          sourceCache.set(el, entry);
        } catch (e) {
          return; // try again on a later tick
        }
      }
      analyser = entry.analyser;
    };

    const tick = (timestamp) => {
      if (!analyser) ensureAnalyser();

      if (analyser) {
        const dt = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.1) : 0.016;
        lastTime = timestamp;

        const dataArray = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(dataArray);

        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sumSq += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSq / dataArray.length);

        const db = rms > 0 ? 20 * Math.log10(rms) : DB_MIN;
        const normalized = Math.max(0, Math.min(1, (db - DB_MIN) / -DB_MIN));

        if (normalized > smoothed) {
          smoothed = normalized;
        } else {
          smoothed = Math.max(normalized, smoothed - DECAY_RATE * dt);
        }

        if (meterRef.current) {
          meterRef.current.style.width = `${smoothed * 100}%`;
          if (smoothed > 0) {
            meterRef.current.style.backgroundSize = `${(1 / smoothed) * 100}% 100%`;
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      // Only stop our animation loop. The MediaElementSource and its connection
      // to the destination must stay intact, otherwise the element's audio would
      // be cut off; the WeakMap lets it all be reclaimed when the element dies.
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);

  return meterRef;
}
