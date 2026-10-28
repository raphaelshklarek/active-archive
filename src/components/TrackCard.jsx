import React, { useEffect, useRef, useState } from 'react';
import { useAudioStore } from '../store/audioStore';
import { prepareAudio, cachePeaksFrom } from '../utils/audioFile';
import { useAudioMeter } from '../hooks/useAudioMeter';
import { createWaveform } from '../utils/waveformRenderer';
import { ipcRenderer } from '../utils/electron';
import { formatTime, formatDate } from '../utils/format';

const TrackCard = ({ track }) => {
  const waveformRef = useRef(null);
  const wavesurfer = useRef(null);
  const cursorRef = useRef(null);
  const isMounted = useRef(true);
  const blobUrlRef = useRef(null);
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

  // Effective volume after mute, solo and master volume. Kept in a ref as well
  // so a freshly loaded WaveSurfer (reshuffle) picks it up when it becomes ready.
  const anySoloed = shufflerTracks.some(t => t.isSoloed);
  const silenced = track.isMuted || (anySoloed && !track.isSoloed);
  const volume = silenced ? 0 : track.volume * masterVolume;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    if (!waveformRef.current || !file) return;

    isMounted.current = true;
    setCurrentTime(0);

    // Clean up previous blob URL when loading new file
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

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

      wavesurfer.current = createWaveform(waveformRef.current);

      // Load audio
      const loadAudio = async () => {
        try {
          const { blob, peaks } = await prepareAudio(file);
          if (!isMounted.current || !wavesurfer.current) return;

          const blobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = blobUrl; // Store URL for cleanup

          wavesurfer.current.load(blobUrl, peaks ?? undefined);
        } catch (error) {
          console.error('Error loading track audio:', error);
        }
      };

      loadAudio();

      // Event listeners
      wavesurfer.current.on('ready', async () => {
        if (!isMounted.current) return;

        wavesurfer.current.setVolume(volumeRef.current);
        await cachePeaksFrom(wavesurfer.current, file.id);
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

  // Apply volume changes (mute / solo / master are already folded into `volume`)
  useEffect(() => {
    if (!wavesurfer.current || !isMounted.current) return;
    wavesurfer.current.setVolume(volume);
  }, [volume]);

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

  const handleShowInFinder = () => {
    ipcRenderer.invoke('shell:showInFolder', file.location);
  };

  const handleCopyFile = async () => {
    await ipcRenderer.invoke('clipboard:copyFiles', [file.location]);
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
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(file.duration || 0)}</span>
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
          onClick={() => updateTrack(track.id, { isSoloed: !track.isSoloed })}
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