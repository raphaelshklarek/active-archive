import React, { useEffect } from 'react';
import { useAudioStore } from './store/audioStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import ArchiveView from './components/ArchiveView';
import ShufflerView from './components/ShufflerView';
import './App.css';

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

  const [isGraphiteAccent, setIsGraphiteAccent] = React.useState(false);

  useEffect(() => {
    initialize();
    
    // Detect graphite accent color
    const checkAccentColor = async () => {
      if (window.require) {
        const { ipcRenderer } = window.require('electron');
        try {
          const { isGraphite } = await ipcRenderer.invoke('get-accent-color');
          setIsGraphiteAccent(isGraphite);
        } catch (error) {
          console.warn('Could not detect accent color:', error);
        }
      }
    };
    
    checkAccentColor();
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

  // Calculate displayed files based on selected playlist
  let displayedFiles = audioFiles;
  if (selectedTab === 'archive' && selectedPlaylist) {
    const playlist = playlists[selectedPlaylist];
    if (playlist) {
      displayedFiles = audioFiles.filter(f => playlist.fileIds.includes(f.id));
    }
  }

  const displayedCount = selectedTab === 'archive' ? displayedFiles.length : audioFiles.length;
  const totalDuration = (selectedTab === 'archive' ? displayedFiles : audioFiles).reduce((sum, file) => sum + file.duration, 0);
  const formatDuration = (seconds) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className={`app ${isGraphiteAccent ? 'graphite-accent' : ''}`}>
      <div className="titlebar">
        {/* Traffic Lights Bar */}
        <div className="titlebar-top">
          <div className="traffic-lights">
            <div className="traffic-light red"></div>
            <div className="traffic-light yellow"></div>
            <div className="traffic-light green"></div>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="titlebar-bottom">
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
        <span>{displayedCount} files</span>
        <span>•</span>
        <span>Total: {formatDuration(totalDuration)}</span>
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
