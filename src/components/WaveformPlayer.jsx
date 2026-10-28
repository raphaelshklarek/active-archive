import React, { useEffect, useRef } from 'react';
import { useAudioStore } from '../store/audioStore';
import { saveAudioFile } from '../database';
import { prepareAudio, cachePeaksFrom } from '../utils/audioFile';
import { useAudioMeter } from '../hooks/useAudioMeter';
import { createWaveform } from '../utils/waveformRenderer';
import { formatTime } from '../utils/format';

const WaveformPlayer = ({ file }) => {
  const waveformRef = useRef(null);
  const wavesurfer = useRef(null);
  const cursorRef = useRef(null);
  const shouldAutoPlay = useRef(true);
  const isMounted = useRef(true);
  const autoAdvanceTimeout = useRef(null);
  const blobUrlRef = useRef(null);
  const currentFileRef = useRef(file);
  const expectedFileIdRef = useRef(null);
  const { isPaused, masterVolume } = useAudioStore();
  const meterRef = useAudioMeter(wavesurfer);

  // Keep ref in sync with latest file prop on every render
  currentFileRef.current = file;

  // ── Create WaveSurfer once on mount ──────────────────────────────
  useEffect(() => {
    if (!waveformRef.current) return;

    isMounted.current = true;

    const ws = createWaveform(waveformRef.current);
    wavesurfer.current = ws;

    // ── Event listeners (registered once, use refs for current file) ──

    ws.on('ready', async () => {
      try {
        if (!isMounted.current) return;

        const currentFile = currentFileRef.current;
        if (currentFile.id !== expectedFileIdRef.current) return;

        // WAV/AIFF peaks were cached before load; this covers files WaveSurfer decoded itself.
        await cachePeaksFrom(ws, currentFile.id);

        if (!isMounted.current) return;
        if (currentFile.id !== expectedFileIdRef.current) return;

        ws.setVolume(useAudioStore.getState().masterVolume);

        if (!isMounted.current) return;
        if (currentFile.id !== expectedFileIdRef.current) return;

        const duration = ws.getDuration();
        if (currentFile.duration === 0 || !currentFile.duration) {
          const store = useAudioStore.getState();
          const fileToUpdate = store.audioFiles.find(f => f.id === currentFile.id);
          if (fileToUpdate) {
            const updatedFile = { ...fileToUpdate, duration };
            await saveAudioFile(updatedFile);

            if (!isMounted.current) return;

            useAudioStore.setState(state => ({
              audioFiles: state.audioFiles.map(f =>
                f.id === currentFile.id ? { ...f, duration } : f
              )
            }));
          }
        }

        // Auto-play when ready
        if (shouldAutoPlay.current && isMounted.current) {
          shouldAutoPlay.current = false;
          ws.play().catch(err => {
            console.warn('Autoplay prevented:', err);
          });
        }
      } catch (error) {
        console.error('Error in ready event handler:', error);
      }
    });

    const updateCursorPosition = () => {
      if (cursorRef.current && ws.getDuration() > 0) {
        const progress = ws.getCurrentTime() / ws.getDuration();
        cursorRef.current.style.left = `${progress * 100}%`;
      }
    };

    ws.on('audioprocess', () => {
      if (isMounted.current) updateCursorPosition();
    });

    ws.on('seeking', () => {
      if (!isMounted.current) return;
      updateCursorPosition();
    });

    ws.on('finish', () => {
      try {
        if (!isMounted.current) return;
        const currentFile = currentFileRef.current;
        const state = useAudioStore.getState();
        if (state.isRandomPlaybackActive && state.currentlyPlaying === currentFile.id) {
          autoAdvanceTimeout.current = setTimeout(() => {
            autoAdvanceTimeout.current = null;
            useAudioStore.getState().playRandomFile();
          }, 300);
        }
      } catch (error) {
        console.error('Error in finish event handler:', error);
      }
    });

    ws.on('error', (err) => {
      console.error('WaveSurfer error:', err);
    });

    // ── Full teardown on unmount only ──────────────────────────────
    return () => {
      isMounted.current = false;
      if (autoAdvanceTimeout.current) {
        clearTimeout(autoAdvanceTimeout.current);
        autoAdvanceTimeout.current = null;
      }
      if (wavesurfer.current) {
        try { wavesurfer.current.destroy(); } catch (e) {}
        wavesurfer.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // ── Load audio when file changes ─────────────────────────────────
  useEffect(() => {
    if (!wavesurfer.current) return;

    let cancelled = false;
    const abortController = new AbortController();
    shouldAutoPlay.current = true;

    // Stop current playback immediately
    try { wavesurfer.current.stop(); } catch (e) {}

    // Cancel pending auto-advance from previous file
    if (autoAdvanceTimeout.current) {
      clearTimeout(autoAdvanceTimeout.current);
      autoAdvanceTimeout.current = null;
    }

    const loadAudio = async () => {
      try {
        const { blob, peaks } = await prepareAudio(file, abortController.signal);
        if (cancelled) return;

        // Revoke previous blob URL before assigning new one
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        expectedFileIdRef.current = file.id;

        wavesurfer.current.load(blobUrl, peaks ?? undefined);
      } catch (error) {
        if (error.name === 'AbortError') return; // expected on file switch
        console.error('Error loading audio:', error);
      }
    };

    loadAudio();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [file.id]);

  // Handle play/pause
  useEffect(() => {
    if (!wavesurfer.current || !isMounted.current) return;

    const timer = setTimeout(() => {
      if (!wavesurfer.current || !isMounted.current) return;

      if (isPaused) {
        if (wavesurfer.current.isPlaying()) {
          wavesurfer.current.pause();
        }
      } else {
        if (!wavesurfer.current.isPlaying()) {
          wavesurfer.current.play().catch(err => {
            console.warn('Play prevented:', err);
          });
        }
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isPaused]);

  // Handle master volume changes
  useEffect(() => {
    if (!wavesurfer.current || !isMounted.current) return;
    wavesurfer.current.setVolume(masterVolume);
  }, [masterVolume]);

  return (
    <div className="waveform-player">
      <div className="audio-level-meter">
        <div className="audio-level-bar" ref={meterRef} />
      </div>
      <div className="waveform-container" style={{ position: 'relative' }}>
        <div ref={waveformRef}></div>
        <div ref={cursorRef} className="waveform-cursor" />
      </div>
      <div className="waveform-times">
        <span className="time-current">
          {formatTime(wavesurfer.current?.getCurrentTime() || 0)}
        </span>
        <span className="time-total">
          {formatTime(file.duration || 0)}
        </span>
      </div>
    </div>
  );
};

export default WaveformPlayer;
