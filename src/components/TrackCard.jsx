import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { useAudioStore } from '../store/audioStore';
import { getWaveform, saveWaveform } from '../database';
import { convertAiffToWav, isAiffFile } from '../utils/audioConverter';
import { useAudioMeter } from '../hooks/useAudioMeter';
import { renderAmplitudeColoredWaveform } from '../utils/waveformRenderer';

const isElectron = typeof window !== 'undefined' && window.require;
const ipcRenderer = isElectron ? window.require('electron').ipcRenderer : null;

const isWavFile = (filePath) => {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext === 'wav';
};

// Compute waveform peaks directly from a WAV buffer's raw PCM bytes.
// This avoids AudioContext.decodeAudioData, which allocates a huge
// AudioBuffer that can OOM-crash the renderer for large WAV/AIFF files.
const computeWavPeaks = (arrayBuffer, targetPeaks = 8000) => {
  try {
    const view = new DataView(arrayBuffer);

    let offset = 12;
    let fmtFound = false;
    let dataOffset = 0;
    let dataSize = 0;
    let channels = 1;
    let bitsPerSample = 16;
    let audioFormat = 1;

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
      if (size % 2) offset++;
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
              const b2 = view.getInt8(off + 2);
              sample = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
              break;
            }
            case 32:
              if (audioFormat === 3) {
                sample = view.getFloat32(off, true);
              } else {
                sample = view.getInt32(off, true) / 2147483648;
              }
              break;
            default:
              return null;
          }

          const abs = Math.abs(sample);
          if (abs > peak) peak = abs;
        }

        peaks[ch][p] = Math.round(peak * 10000) / 10000;
      }
    }

    return peaks;
  } catch (e) {
    console.warn('Could not compute WAV peaks:', e);
    return null;
  }
};

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

const TrackCard = ({ track }) => {
  const waveformRef = useRef(null);
  const wavesurfer = useRef(null);
  const cursorRef = useRef(null);
  const isMounted = useRef(true);
  const blobUrlRef = useRef(null);
  const blobRef = useRef(null); // Store blob to prevent garbage collection
  const [currentTime, setCurrentTime] = useState(0);

  const {
    audioFiles,
    isShufflerPlaying,
    isShufflerPaused,
    shufflerTracks,
    updateTrack,
    removeTrack,
    reshuffleTrack,
    masterVolume,
    shufflerResetTimestamp,
    toggleFavorite
  } = useAudioStore();

  const file = audioFiles.find(f => f.id === track.fileId);
  const meterRef = useAudioMeter(wavesurfer, { key: file?.id });

  useEffect(() => {
    if (!waveformRef.current || !file) return;

    isMounted.current = true;
    setCurrentTime(0);

    // Clean up previous blob URL when loading new file
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    blobRef.current = null; // Release previous blob reference

    // Clean up any existing instance first
    if (wavesurfer.current) {
      if (wavesurfer.current.isPlaying()) {
        wavesurfer.current.pause();
      }
      wavesurfer.current.destroy();
      wavesurfer.current = null;
    }

    // Small delay to ensure DOM is ready
    const initTimer = setTimeout(() => {
      if (!isMounted.current || !waveformRef.current) return;

      // Create WaveSurfer instance
      wavesurfer.current = WaveSurfer.create({
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

      // Prevent WaveSurfer from clipping the wave canvas in the played region
      const shadowRoot = wavesurfer.current.getWrapper().getRootNode();
      const noClipStyle = document.createElement('style');
      noClipStyle.textContent = '.canvases { clip-path: none !important; }';
      shadowRoot.appendChild(noClipStyle);

      // Load audio
      const loadAudio = async () => {
        try {
          const fs = window.require('fs');
          const fileBuffer = fs.readFileSync(file.location);

          // Node.js Buffers can be views into a shared ArrayBuffer pool.
          // We must slice out the exact file bytes for correct AIFF conversion.
          const fileArrayBuffer = fileBuffer.buffer.slice(
            fileBuffer.byteOffset,
            fileBuffer.byteOffset + fileBuffer.byteLength
          );

          let blob;
          let wavBuffer = null;
          if (isAiffFile(file.location)) {
            // Convert AIFF to WAV for browser compatibility
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

          const blobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = blobUrl; // Store URL for cleanup
          blobRef.current = blob; // Store blob to prevent garbage collection

          if (!isMounted.current || !wavesurfer.current) return;

          let peaks = null;
          const cached = await getWaveform(file.id);
          if (cached && cached.peaks && cached.peaks.length > 0) {
            peaks = cached.peaks;
          }

          if (!isMounted.current || !wavesurfer.current) return;

          // For WAV/AIFF without cached peaks: compute from raw PCM bytes
          if (!peaks && wavBuffer) {
            peaks = computeWavPeaks(wavBuffer);
            if (peaks) {
              await saveWaveform(file.id, peaks);
            }
          }

          if (!isMounted.current || !wavesurfer.current) return;

          if (peaks) {
            wavesurfer.current.load(blobUrl, peaks);
          } else {
            wavesurfer.current.load(blobUrl);
          }
        } catch (error) {
          console.error('Error loading track audio:', error);
        }
      };

      loadAudio();

      // Event listeners
      wavesurfer.current.on('ready', async () => {
        if (!isMounted.current) return;
        
        const peaks = wavesurfer.current.exportPeaks();
        await saveWaveform(file.id, peaks);
        
        wavesurfer.current.setVolume(track.volume);
      });

      // Loop the track
      wavesurfer.current.on('finish', () => {
        if (isMounted.current && !track.isPaused) {
          wavesurfer.current.play().catch(err => {
            console.warn('Loop play prevented:', err);
          });
        }
      });

      const updateCursorPosition = () => {
        if (cursorRef.current && wavesurfer.current && wavesurfer.current.getDuration() > 0) {
          const progress = wavesurfer.current.getCurrentTime() / wavesurfer.current.getDuration();
          cursorRef.current.style.left = `${progress * 100}%`;
        }
      };

      // Update time counter - throttle re-renders but always update cursor
      let lastUpdate = 0;
      wavesurfer.current.on('audioprocess', () => {
        if (isMounted.current) {
          updateCursorPosition();
          const now = Date.now();
          if (now - lastUpdate > 100) {
            setCurrentTime(wavesurfer.current.getCurrentTime());
            lastUpdate = now;
          }
        }
      });

      wavesurfer.current.on('seeking', () => {
        if (isMounted.current) updateCursorPosition();
      });
    }, 100);

    return () => {
      clearTimeout(initTimer);
      isMounted.current = false;
      if (wavesurfer.current) {
        if (wavesurfer.current.isPlaying()) {
          wavesurfer.current.pause();
        }
        wavesurfer.current.destroy();
        wavesurfer.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      blobRef.current = null;
    };
  }, [file?.id, track.id]);

  // Handle playback state
  useEffect(() => {
    if (!wavesurfer.current || !isMounted.current) return;

    const timer = setTimeout(() => {
      if (!wavesurfer.current || !isMounted.current) return;

      const shouldPlay = isShufflerPlaying && !isShufflerPaused && !track.isPaused;
      
      if (shouldPlay) {
        if (!wavesurfer.current.isPlaying()) {
          wavesurfer.current.play().catch(err => {
            console.warn('Play prevented:', err);
          });
        }
      } else {
        if (wavesurfer.current.isPlaying()) {
          wavesurfer.current.pause();
        }
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isShufflerPlaying, isShufflerPaused, track.isPaused]);

  // Handle volume (including solo logic and master volume)
  useEffect(() => {
    if (!wavesurfer.current || !isMounted.current) return;
    
    const anySoloed = shufflerTracks.some(t => t.isSoloed);
    
    let actualVolume = track.volume;
    
    if (track.isMuted) {
      actualVolume = 0;
    } else if (anySoloed && !track.isSoloed) {
      actualVolume = 0;
    }
    
    // Apply master volume
    actualVolume = actualVolume * masterVolume;
    
    wavesurfer.current.setVolume(actualVolume);
  }, [track.volume, track.isMuted, track.isSoloed, shufflerTracks, masterVolume]);

  // Handle stop/reset - when shufflerResetTimestamp changes, seek to 0
  useEffect(() => {
    if (!wavesurfer.current || !isMounted.current || shufflerResetTimestamp === 0) return;
    
    const timer = setTimeout(() => {
      if (!wavesurfer.current || !isMounted.current) return;
      
      wavesurfer.current.seekTo(0);
      setCurrentTime(0);
    }, 50);

    return () => clearTimeout(timer);
  }, [shufflerResetTimestamp]);

  if (!file) return null;

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleShowInFinder = () => {
    if (ipcRenderer) {
      ipcRenderer.invoke('shell:showInFolder', file.location);
    }
  };

  const handleCopyFile = async () => {
    if (ipcRenderer) {
      await ipcRenderer.invoke('clipboard:copyFiles', [file.location]);
    }
  };

  const handleSolo = () => {
    updateTrack(track.id, { isSoloed: !track.isSoloed });
  };

  return (
    <div className="track-card">
      <div className="track-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
        <span
          className={`track-favorite ${file.isFavorite ? 'favorite-filled' : 'favorite-empty'}`}
          onClick={() => toggleFavorite(file.id)}
          style={{ cursor: 'pointer', fontSize: '18px' }}
          title={file.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {file.isFavorite ? '★' : '☆'}
        </span>
        <div className="file-name-frame">
          <h4>{file.name}</h4>
        </div>
      </div>

      <div className="audio-level-meter">
        <div className="audio-level-bar" ref={meterRef} />
      </div>

      <div className="track-waveform">
        <div style={{ position: 'relative' }}>
          <div ref={waveformRef}></div>
          <div ref={cursorRef} className="waveform-cursor" />
        </div>
        <div className="track-times">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(file.duration || 0)}</span>
        </div>
      </div>

      <div className="track-controls">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          disabled={track.isMuted}
          className="volume-slider"
        />
        <button
          className={`track-button ${track.isMuted ? 'active' : ''}`}
          onClick={() => updateTrack(track.id, { isMuted: !track.isMuted })}
        >
          Mute
        </button>
        <button
          className={`track-button ${track.isSoloed ? 'active' : ''}`}
          onClick={handleSolo}
        >
          Solo
        </button>
        <button
          className={`track-button ${track.isPaused ? 'active' : ''}`}
          onClick={() => updateTrack(track.id, { isPaused: !track.isPaused })}
        >
          {track.isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          className="track-button"
          onClick={() => removeTrack(track.id)}
        >
          Remove
        </button>
        <button
          className="track-button"
          onClick={() => reshuffleTrack(track.id)}
          title="Replace with a random different track"
        >
          Reshuffle
        </button>
        <button
          className="track-button"
          onClick={handleShowInFinder}
        >
          Show
        </button>
        <button
          className="track-button"
          onClick={handleCopyFile}
          title="Copy audio file to clipboard"
        >
          Copy
        </button>
      </div>

      <div className="track-footer">
        <span>{formatDate(file.date)}</span>
      </div>
    </div>
  );
};

export default TrackCard;