import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAudioStore } from '../store/audioStore';
import TrackCard from './TrackCard';

const isElectron = typeof window !== 'undefined' && window.require;
const ipcRenderer = isElectron ? window.require('electron').ipcRenderer : null;

const ShufflerView = () => {
  const {
    shufflerTracks,
    audioFiles,
    combinations,
    activeCombinationId,
    createRandomTracks,
    saveCombination,
    loadCombination,
    deleteCombination,
    renameCombination,
    duplicateCombination,
    masterVolume,
    setMasterVolume
  } = useAudioStore();

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [combinationName, setCombinationName] = useState('');
  const [comboSortColumn, setComboSortColumn] = useState('date');
  const [comboSortOrder, setComboSortOrder] = useState('desc');

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  const renameInputRef = useRef(null);

  // Sidebar resizing state
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarStartX = useRef(0);
  const sidebarStartWidth = useRef(0);

  const handleSave = () => {
    if (combinationName.trim()) {
      saveCombination(combinationName.trim());
      setCombinationName('');
      setShowSaveDialog(false);
    }
  };

  const handleCopyAllTracks = async () => {
    if (!ipcRenderer || shufflerTracks.length === 0) return;

    // Get file paths for all tracks
    const filePaths = shufflerTracks
      .map(track => {
        const file = audioFiles.find(f => f.id === track.fileId);
        return file ? file.location : null;
      })
      .filter(Boolean);

    if (filePaths.length > 0) {
      await ipcRenderer.invoke('clipboard:copyFiles', filePaths);
    }
  };

  // Context menu handlers
  const handleContextMenu = (e, id) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id });
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRename = (id) => {
    const combo = combinations[id];
    if (!combo) return;
    setRenamingId(id);
    setRenamingValue(combo.name);
    setContextMenu(null);
  };

  const handleRenameSubmit = (id) => {
    if (renamingValue.trim()) {
      renameCombination(id, renamingValue.trim());
    }
    setRenamingId(null);
    setRenamingValue('');
  };

  const handleDuplicate = (id) => {
    duplicateCombination(id);
    setContextMenu(null);
  };

  const handleDelete = (id) => {
    deleteCombination(id);
    setContextMenu(null);
  };

  // Close context menu on click outside
  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu();
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [contextMenu, closeContextMenu]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Sidebar resize handlers
  const handleSidebarResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingSidebar(true);
    sidebarStartX.current = e.clientX;
    sidebarStartWidth.current = sidebarWidth;
  };

  const handleSidebarResize = (e) => {
    if (!isResizingSidebar) return;

    const deltaX = sidebarStartX.current - e.clientX; // Reversed for right sidebar
    const newWidth = Math.max(240, Math.min(500, sidebarStartWidth.current + deltaX));
    setSidebarWidth(newWidth);
  };

  const handleSidebarResizeEnd = () => {
    setIsResizingSidebar(false);
  };

  // Add global mouse handlers
  useEffect(() => {
    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleSidebarResize);
      document.addEventListener('mouseup', handleSidebarResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleSidebarResize);
        document.removeEventListener('mouseup', handleSidebarResizeEnd);
      };
    }
  }, [isResizingSidebar]);

  return (
    <div className="shuffler-view">
      <div className="shuffler-main">
        <div className="shuffler-toolbar">
          <button
            className="toolbar-button"
            onClick={() => createRandomTracks(3)}
            title="Generate Random Tracks"
          >
            Generate
          </button>
          <button
            className="toolbar-button"
            onClick={() => setShowSaveDialog(true)}
            disabled={shufflerTracks.length === 0}
            title="Save Combination"
          >
            Save Combination
          </button>
          <button
            className="toolbar-button"
            onClick={handleCopyAllTracks}
            disabled={shufflerTracks.length === 0}
            title="Copy all tracks to clipboard"
          >
            Copy All
          </button>
          <div className="toolbar-spacer"></div>
          <div className="master-volume-container">
            <span className="master-volume-label">Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={masterVolume}
              onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
              className="master-volume-slider"
            />
          </div>
        </div>

        <div className="tracks-container">
          {shufflerTracks.length === 0 ? (
            <div className="empty-state">
              <p>No tracks loaded</p>
              <button onClick={() => createRandomTracks(3)}>
                Generate Random Tracks
              </button>
            </div>
          ) : (
            shufflerTracks.map(track => (
              <TrackCard key={track.id} track={track} />
            ))
          )}
        </div>
      </div>

      {/* Combinations Sidebar */}
      <div className="combinations-sidebar" style={{ width: `${sidebarWidth}px` }}>
        <div
          className="sidebar-resize-handle-left"
          onMouseDown={handleSidebarResizeStart}
        />
        <div className="sidebar-header">Saved Combinations</div>
        <div className="combinations-column-header">
          <span
            className={`combinations-col-label ${comboSortColumn === 'name' ? 'active' : ''}`}
            onClick={() => {
              if (comboSortColumn === 'name') {
                setComboSortOrder(o => o === 'asc' ? 'desc' : 'asc');
              } else {
                setComboSortColumn('name');
                setComboSortOrder('asc');
              }
            }}
          >
            Name {comboSortColumn === 'name' ? (comboSortOrder === 'asc' ? '▲' : '▼') : ''}
          </span>
          <span
            className={`combinations-col-label ${comboSortColumn === 'date' ? 'active' : ''}`}
            onClick={() => {
              if (comboSortColumn === 'date') {
                setComboSortOrder(o => o === 'asc' ? 'desc' : 'asc');
              } else {
                setComboSortColumn('date');
                setComboSortOrder('desc');
              }
            }}
          >
            Date Created {comboSortColumn === 'date' ? (comboSortOrder === 'asc' ? '▲' : '▼') : ''}
          </span>
        </div>
        <div className="combinations-list">
          {Object.keys(combinations).length === 0 ? (
            <div className="empty-combinations">
              No saved combinations
            </div>
          ) : (
            Object.entries(combinations)
              .sort(([, a], [, b]) => {
                if (comboSortColumn === 'name') {
                  const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                  return comboSortOrder === 'asc' ? cmp : -cmp;
                } else {
                  const cmp = new Date(a.date) - new Date(b.date);
                  return comboSortOrder === 'asc' ? cmp : -cmp;
                }
              })
              .map(([id, combo]) => (
              <div
                key={id}
                className={`combination-item ${activeCombinationId === id ? 'combination-item-active' : ''}`}
                onClick={() => { if (renamingId !== id) loadCombination(id); }}
                onContextMenu={(e) => handleContextMenu(e, id)}
              >
                {renamingId === id ? (
                  <input
                    ref={renameInputRef}
                    className="combination-rename-input"
                    value={renamingValue}
                    onChange={(e) => setRenamingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSubmit(id);
                      if (e.key === 'Escape') { setRenamingId(null); setRenamingValue(''); }
                    }}
                    onBlur={() => handleRenameSubmit(id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="combination-name" style={{ paddingLeft: 0 }}>
                    {combo.name}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={() => handleRename(contextMenu.id)}>
            Rename
          </div>
          <div className="context-menu-item" onClick={() => handleDuplicate(contextMenu.id)}>
            Duplicate
          </div>
          <div className="context-menu-separator" />
          <div className="context-menu-item context-menu-item-danger" onClick={() => handleDelete(contextMenu.id)}>
            Delete
          </div>
        </div>
      )}

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Save Combination</h3>
            <input
              type="text"
              value={combinationName}
              onChange={e => setCombinationName(e.target.value)}
              placeholder="Enter name..."
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
            />
            <div className="modal-buttons">
              <button onClick={handleSave} disabled={!combinationName.trim()}>
                Save
              </button>
              <button onClick={() => setShowSaveDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShufflerView;
