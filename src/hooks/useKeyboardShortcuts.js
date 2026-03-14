import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';

export const useKeyboardShortcuts = () => {
  const {
    currentlyPlaying,
    togglePlayback,
    stopPlayback,
    selectedTab,
    toggleShufflerPlayback,
    stopShuffler,
    selectAllFiles,
    deleteFiles,
    selectedFiles
  } = useAudioStore();

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Space - Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (selectedTab === 'archive') {
          if (currentlyPlaying) {
            togglePlayback(currentlyPlaying);
          }
        } else {
          toggleShufflerPlayback();
        }
      }

      // Escape - Stop
      if (e.code === 'Escape') {
        if (selectedTab === 'archive') {
          stopPlayback();
        } else {
          stopShuffler();
        }
      }

      // Cmd/Ctrl + A - Select All
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA') {
        if (selectedTab === 'archive') {
          e.preventDefault();
          selectAllFiles();
        }
      }

      // Delete/Backspace - Delete selected files
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedTab === 'archive') {
        if (selectedFiles.size > 0) {
          e.preventDefault();
          if (confirm(`Delete ${selectedFiles.size} file(s)?`)) {
            deleteFiles(Array.from(selectedFiles));
          }
        }
      }

      // Cmd/Ctrl + F - Focus search (if you add this feature)
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyF') {
        e.preventDefault();
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
          searchInput.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentlyPlaying,
    selectedTab,
    selectedFiles,
    togglePlayback,
    stopPlayback,
    toggleShufflerPlayback,
    stopShuffler,
    selectAllFiles,
    deleteFiles
  ]);
};
