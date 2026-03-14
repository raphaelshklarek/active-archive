import { useRef, useEffect } from 'react';
import { getAudioContext } from '../utils/audioContext';

export function useAudioMeter(wavesurferRef, { key } = {}) {
  const meterRef = useRef(null);

  useEffect(() => {
    let raf = null;
    let analyser = null;
    let source = null;
    let connectedEl = null;
    let smoothed = 0;
    let lastTime = 0;

    const DB_MIN = -60;
    const DECAY_RATE = 8;

    const tick = (timestamp) => {
      // Auto-connect: detect when wavesurfer's media element becomes available
      const ws = wavesurferRef.current;
      if (ws) {
        let mediaElement = null;
        try { mediaElement = ws.getMediaElement(); } catch (e) {}

        if (mediaElement && mediaElement !== connectedEl) {
          // Disconnect previous wiring
          if (source) { try { source.disconnect(); } catch (e) {} }
          if (analyser) { try { analyser.disconnect(); } catch (e) {} }
          analyser = null;
          source = null;

          const ctx = getAudioContext();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;

          // createMediaElementSource can only be called once per element.
          // Reuse if already created by a previous hook instance.
          if (mediaElement._audioMeterSource) {
            source = mediaElement._audioMeterSource;
            try { source.disconnect(); } catch (e) {}
          } else {
            try {
              source = ctx.createMediaElementSource(mediaElement);
              mediaElement._audioMeterSource = source;
            } catch (e) {
              // Element already owned by another context — skip
              analyser = null;
              raf = requestAnimationFrame(tick);
              return;
            }
          }

          source.connect(analyser);
          analyser.connect(ctx.destination);
          connectedEl = mediaElement;
          smoothed = 0;
          lastTime = 0;
        }
      }

      // Update meter if connected
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
      if (raf) cancelAnimationFrame(raf);
      if (source) {
        try { source.disconnect(); } catch (e) {}
        // Reconnect source directly to destination so audio keeps playing
        try {
          const ctx = getAudioContext();
          source.connect(ctx.destination);
        } catch (e) {}
      }
      if (analyser) {
        try { analyser.disconnect(); } catch (e) {}
      }
    };
  }, [key]);

  return meterRef;
}
