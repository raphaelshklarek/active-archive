import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { useAudioStore } from '../store/audioStore';
import { saveWaveform, getWaveform, saveAudioFile } from '../database';
import { convertAiffToWav, isAiffFile } from '../utils/audioConverter';
import { useAudioMeter } from '../hooks/useAudioMeter';
import { renderAmplitudeColoredWaveform } from '../utils/waveformRenderer';

// Get MIME type based on file extension
const getMimeType = (filePath) => {
  const ext = filePath.toLowerCase().split('.').pop();
  const mimeTypes = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'aiff': 'audio/aiff',
    'aif': 'audio/aiff',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'ogg': 'audio/ogg'
  };
  return mimeTypes[ext] || 'audio/*';
};

const isWavFile = (filePath) => {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext === 'wav';
};

// Compute waveform peaks directly from a WAV buffer's raw PCM bytes.
// This avoids AudioContext.decodeAudioData, which allocates a huge
// AudioBuffer (~2x file size) that can OOM-crash the renderer for
// large WAV/AIFF files.
const computeWavPeaks = (arrayBuffer, targetPeaks = 8000) => {
  try {
    const view = new DataView(arrayBuffer);

    // Scan chunks to find 'fmt ' and 'data'
    let offset = 12; // Skip 'RIFF' (4) + fileSize (4) + 'WAVE' (4)
    let fmtFound = false;
    let dataOffset = 0;
    let dataSize = 0;
    let channels = 1;
    let bitsPerSample = 16;
    let audioFormat = 1; // 1 = PCM integer, 3 = IEEE float

    while (offset < arrayBuffer.byteLength - 8) {
      const id = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );
      const size = view.getUint32(offset + 4, true);

      if (id === 'fmt ') {
        audioFormat = view.getUint16(offset + 8, true);
        channels = view.getUint16(offset + 10, true);
        bitsPerSample = view.getUint16(offset + 22, true);
        fmtFound = true;
      } else if (id === 'data') {
        dataOffset = offset + 8;
        dataSize = size;
        break;
      }

      offset += 8 + size;
      if (size % 2) offset++; // WAV chunks are word-aligned
    }

    if (!fmtFound || !dataOffset) return null;

    const bytesPerSample = bitsPerSample / 8;
    const bytesPerFrame = bytesPerSample * channels;
    const totalFrames = Math.floor(dataSize / bytesPerFrame);
    const framesPerPeak = Math.max(1, Math.floor(totalFrames / targetPeaks));
    const numPeaks = Math.ceil(totalFrames / framesPerPeak);

    const peaks = [];
    for (let ch = 0; ch < channels; ch++) {
      peaks.push(new Array(numPeaks));
    }

    for (let p = 0; p < numPeaks; p++) {
      const startFrame = p * framesPerPeak;
      const endFrame = Math.min(startFrame + framesPerPeak, totalFrames);

      for (let ch = 0; ch < channels; ch++) {
        let peak = 0;
        for (let f = startFrame; f < endFrame; f++) {
          const off = dataOffset + f * bytesPerFrame + ch * bytesPerSample;
          if (off + bytesPerSample > arrayBuffer.byteLength) break;

          let sample;
          switch (bitsPerSample) {
            case 8:
              sample = (view.getUint8(off) - 128) / 128;
              break;
            case 16:
              sample = view.getInt16(off, true) / 32768;
              break;
            case 24: {
              const b0 = view.getUint8(off);
              const b1 = view.getUint8(off + 1);
              const b2 = view.getInt8(off + 2); // signed for sign extension
              sample = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
              break;
            }
            case 32:
              if (audioFormat === 3) {
                // IEEE 754 float
                sample = view.getFloat32(off, true);
              } else {
                // 32-bit integer PCM
                sample = view.getInt32(off, true) / 2147483648;
              }
              break;
            default:
              return null; // unsupported bit depth — let WaveSurfer decode
          }

          const abs = Math.abs(sample);
          if (abs > peak) peak = abs;
        }

        // Match WaveSurfer exportPeaks precision (4 decimal places)
        peaks[ch][p] = Math.round(peak * 10000) / 10000;
      }
    }

    return peaks;
  } catch (e) {
    console.warn('Could not compute WAV peaks:', e);
    return null;
  }
};

const WaveformPlayer = ({ file }) => {
  const waveformRef = useRef(null);
  const wavesurfer = useRef(null);
  const cursorRef = useRef(null);
  const shouldAutoPlay = useRef(true);
  const isMounted = useRef(true);
  const autoAdvanceTimeout = useRef(null);
  const blobUrlRef = useRef(null);
  const blobRef = useRef(null);
  const currentFileRef = useRef(file);
  const expectedFileIdRef = useRef(null);
  const { setPlaybackProgress, isPaused, masterVolume } = useAudioStore();
  const meterRef = useAudioMeter(wavesurfer);

  // Keep ref in sync with latest file prop on every render
  currentFileRef.current = file;

  // ── Create WaveSurfer once on mount ──────────────────────────────
  useEffect(() => {
    if (!waveformRef.current) return;

    isMounted.current = true;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: 'rgba(100, 100, 100, 0.3)',
      progressColor: 'transparent',
      cursorColor: 'transparent',
      cursorWidth: 0,
      height: 88,
      normalize: false,
      mediaControls: false,
      renderFunction: renderAmplitudeColoredWaveform
    });

    wavesurfer.current = ws;

    // Prevent WaveSurfer from clipping the wave canvas in the played region.
    // By default it clips the wave canvas away and shows a progress canvas
    // filled with progressColor. We want the original colorful waveform to
    // stay visible at all times, so we disable the clip-path.
    const shadowRoot = ws.getWrapper().getRootNode();
    const noClipStyle = document.createElement('style');
    noClipStyle.textContent = '.canvases { clip-path: none !important; }';
    shadowRoot.appendChild(noClipStyle);

    // ── Event listeners (registered once, use refs for current file) ──

    ws.on('ready', async () => {
      try {
        if (!isMounted.current) return;

        const currentFile = currentFileRef.current;
        if (currentFile.id !== expectedFileIdRef.current) return;

        // Only export & save peaks if we don't already have them cached.
        // For WAV/AIFF files, peaks are pre-computed from raw PCM in
        // loadAudio and saved before ws.load(), so this is skipped.
        const existing = await getWaveform(currentFile.id);
        if (!existing || !existing.peaks || existing.peaks.length === 0) {
          const peaks = ws.exportPeaks();
          if (peaks && peaks.length > 0) {
            await saveWaveform(currentFile.id, peaks);
          }
        }

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
      try {
        if (!isMounted.current) return;
        const progress = ws.getCurrentTime() / ws.getDuration();
        setPlaybackProgress(progress);
        updateCursorPosition();
      } catch (error) {
        console.error('Error in audioprocess event handler:', error);
      }
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
      blobRef.current = null;
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
        const fs = window.require('fs');
        const fileBuffer = await fs.promises.readFile(
          file.location,
          { signal: abortController.signal }
        );

        if (cancelled) return;

        let blob;
        let wavBuffer = null; // set for WAV/AIFF — used for peak computation

        // Node.js Buffers can be views into a shared ArrayBuffer pool.
        // We must slice out the exact file bytes so computeWavPeaks
        // and convertAiffToWav read from the correct offset.
        const fileArrayBuffer = fileBuffer.buffer.slice(
          fileBuffer.byteOffset,
          fileBuffer.byteOffset + fileBuffer.byteLength
        );

        if (isAiffFile(file.location)) {
          wavBuffer = convertAiffToWav(fileArrayBuffer);
          blob = new Blob([wavBuffer], { type: 'audio/wav' });
        } else if (isWavFile(file.location)) {
          wavBuffer = fileArrayBuffer;
          const mimeType = getMimeType(file.location);
          blob = new Blob([fileBuffer], { type: mimeType });
        } else {
          const mimeType = getMimeType(file.location);
          blob = new Blob([fileBuffer], { type: mimeType });
        }

        if (cancelled) return;

        const blobUrl = URL.createObjectURL(blob);

        // Try to get cached peaks from database (version-checked)
        let peaks = null;
        const cached = await getWaveform(file.id);
        if (cached && cached.peaks && cached.peaks.length > 0) {
          peaks = cached.peaks;
        }

        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        // For WAV/AIFF without cached peaks: compute peaks from raw PCM
        // bytes instead of letting WaveSurfer call decodeAudioData, which
        // allocates a ~200MB AudioBuffer for large files.
        if (!peaks && wavBuffer) {
          peaks = computeWavPeaks(wavBuffer);
          if (peaks) {
            await saveWaveform(file.id, peaks);
          }
        }

        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }

        // Revoke previous blob URL before assigning new one
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = blobUrl;
        blobRef.current = blob;

        expectedFileIdRef.current = file.id;

        if (peaks) {
          wavesurfer.current.load(blobUrl, peaks);
        } else {
          // Compressed formats (MP3, FLAC, etc.) — these are small enough
          // that WaveSurfer's decode won't cause memory issues.
          wavesurfer.current.load(blobUrl);
        }
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

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default WaveformPlayer;
