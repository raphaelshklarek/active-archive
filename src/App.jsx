import React, { useEffect } from 'react';
import { useAudioStore, getPlaylistFiles } from './store/audioStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { formatTotalDuration } from './utils/format';
import ArchiveView from './components/ArchiveView';
import ShufflerView from './components/ShufflerView';

function App() {
  const {
    selectedTab,
    setSelectedTab,
    initialize,
    currentlyPlaying,
    isPlaying,
    isPaused,
    togglePlayback,
    stopPlayback,
    isShufflerPlaying,
    isShufflerPaused,
    toggleShufflerPlayback,
    stopShuffler,
    audioFiles,
    selectedPlaylist,
    playlists,
    isAnalyzingFiles
  } = useAudioStore();

  useKeyboardShortcuts();

  // Dim the toolbar when the window loses focus, matching how macOS renders
  // inactive windows (the native traffic lights grey out at the same time).
  const [isWindowActive, setIsWindowActive] = React.useState(document.hasFocus());

  useEffect(() => {
    initialize();

    const onFocus = () => setIsWindowActive(true);
    const onBlur = () => setIsWindowActive(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    if (!navigator.mediaSession) return;

    const handlePlay = () => {
      const state = useAudioStore.getState();
      if (state.selectedTab === 'archive') {
        if (state.currentlyPlaying && state.isPaused) {
          state.togglePlayback(state.currentlyPlaying);
        }
      } else if (state.isShufflerPaused) {
        state.toggleShufflerPlayback();
      }
    };

    const handlePause = () => {
      const state = useAudioStore.getState();
      if (state.selectedTab === 'archive') {
        if (state.currentlyPlaying && !state.isPaused) {
          state.togglePlayback(state.currentlyPlaying);
        }
      } else if (!state.isShufflerPaused) {
        state.toggleShufflerPlayback();
      }
    };

    navigator.mediaSession.setActionHandler('play', handlePlay);
    navigator.mediaSession.setActionHandler('pause', handlePause);

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, []);

  const handlePlayPause = () => {
    if (selectedTab === 'archive') {
      if (currentlyPlaying) {
        togglePlayback(currentlyPlaying);
      }
    } else {
      toggleShufflerPlayback();
    }
  };

  const handleStop = () => {
    if (selectedTab === 'archive') {
      stopPlayback();
    } else {
      stopShuffler();
    }
  };

  const getPlayLabel = () => {
    if (selectedTab === 'archive') {
      return (isPlaying && !isPaused) ? 'Pause' : 'Play';
    } else {
      return (isShufflerPlaying && !isShufflerPaused) ? 'Pause' : 'Play';
    }
  };

  const isStopEnabled = () => {
    if (selectedTab === 'archive') {
      return currentlyPlaying !== null;
    } else {
      return isShufflerPlaying;
    }
  };

  // Status bar counts the selected playlist on the Archive tab, the whole library otherwise
  const displayedFiles = selectedTab === 'archive'
    ? getPlaylistFiles({ audioFiles, selectedPlaylist, playlists })
    : audioFiles;
  const totalDuration = displayedFiles.reduce((sum, file) => sum + file.duration, 0);

  return (
    <div className={`app ${isWindowActive ? '' : 'window-inactive'}`}>
      {/* Unified toolbar: the native traffic lights sit at its left edge */}
      <div className="titlebar">
        <div className="titlebar-row">
          <div className="titlebar-controls">
            <button
              className={`control-button ${getPlayLabel() !== 'Play' ? 'playing' : ''}`}
              onClick={handlePlayPause}
              title={getPlayLabel()}
            >
              <svg viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
            <button 
              className="control-button"
              onClick={handleStop}
              disabled={!isStopEnabled()}
              title="Stop"
            >
              <svg viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z"/>
              </svg>
            </button>
          </div>

          <div className="titlebar-tabs">
            <button
              className={`tab ${selectedTab === 'archive' ? 'active' : ''}`}
              onClick={() => setSelectedTab('archive')}
            >
              Archive
            </button>
            <button
              className={`tab ${selectedTab === 'shuffler' ? 'active' : ''}`}
              onClick={() => setSelectedTab('shuffler')}
            >
              Shuffler
            </button>
          </div>
        </div>
      </div>

      <div className="content">
        {selectedTab === 'archive' ? <ArchiveView /> : <ShufflerView />}
      </div>

      <div className="statusbar">
        <span>{displayedFiles.length} files</span>
        <span>•</span>
        <span>Total: {formatTotalDuration(totalDuration)}</span>
        {isAnalyzingFiles && (
          <>
            <span>•</span>
            <span className="analyzing-indicator">
              <svg className="spinner" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="31.4 31.4" />
              </svg>
              Analyzing files...
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
