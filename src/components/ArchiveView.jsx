import React, { useState, useRef, useEffect } from 'react';
import { FixedSizeList as List } from 'react-window';
import { useAudioStore } from '../store/audioStore';
import WaveformPlayer from './WaveformPlayer';
import * as db from '../database';

const { ipcRenderer } = window.require('electron');

const ArchiveView = () => {
  const {
    audioFiles,
    currentlyPlaying,
    searchText,
    setSearchText,
    selectedFiles,
    toggleFileSelection,
    selectAllFiles,
    clearSelection,
    selectFiles,
    addFilesToSelection,
    addAudioFiles,
    addFolder,
    deleteFiles,
    togglePlayback,
    sortColumn,
    sortOrder,
    setSortColumn,
    isRandomPlaybackActive,
    toggleRandomPlayback,
    masterVolume,
    setMasterVolume,
    playlists,
    selectedPlaylist,
    isPlaylistPaneOpen,
    togglePlaylistPane,
    createPlaylist,
    addToPlaylist,
    selectPlaylist,
    deletePlaylist,
    toggleFavorite
  } = useAudioStore();

  const [showNewPlaylistDialog, setShowNewPlaylistDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showAddToPlaylistMenu, setShowAddToPlaylistMenu] = useState(false);
  const [contextMenuFile, setContextMenuFile] = useState(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [dragOverPlaylist, setDragOverPlaylist] = useState(null);
  const [lastClickedIndex, setLastClickedIndex] = useState(null);
  const [listHeight, setListHeight] = useState(600); // Default height
  const listContainerRef = useRef(null);
  const listRef = useRef(null);
  const headerRef = useRef(null);

  // Column widths state
  const [columnWidths, setColumnWidths] = useState({
    favorite: 4, // percentages
    name: 36,
    duration: 15,
    date: 20,
    location: 25
  });
  
  const [isResizing, setIsResizing] = useState(false);
  const resizingColumn = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const justFinishedResizing = useRef(false);
  
  // Sidebar resizing state
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarStartX = useRef(0);
  const sidebarStartWidth = useRef(0);

  const currentFile = audioFiles.find(f => f.id === currentlyPlaying);

  // Load saved column widths and sidebar width from database
  useEffect(() => {
    const loadSavedDimensions = async () => {
      const savedColumnWidths = await db.getPreference('columnWidths');
      const savedSidebarWidth = await db.getPreference('sidebarWidth');

      if (savedColumnWidths) {
        setColumnWidths(savedColumnWidths);
      }
      if (savedSidebarWidth) {
        setSidebarWidth(savedSidebarWidth);
      }
    };

    loadSavedDimensions();
  }, []);

  // Filter files based on selected playlist
  let displayFiles = audioFiles;
  if (selectedPlaylist) {
    const playlist = playlists[selectedPlaylist];
    if (playlist) {
      displayFiles = audioFiles.filter(f => playlist.fileIds.includes(f.id));
    }
  }

  // Then apply search filter
  const filteredFiles = displayFiles.filter(file => {
    if (!searchText) return true;
    return (
      file.name.toLowerCase().includes(searchText.toLowerCase()) ||
      file.location.toLowerCase().includes(searchText.toLowerCase())
    );
  });

  const handleAdd = async () => {
    const result = await ipcRenderer.invoke('dialog:openFilesOrFolder');
    if (result.files.length > 0) {
      await addAudioFiles(result.files);
    }
    if (result.folders.length > 0) {
      for (const folder of result.folders) {
        await addFolder(folder);
      }
    }
  };

  const handleDelete = () => {
    if (selectedFiles.size === 0) return;
    
    if (confirm(`Delete ${selectedFiles.size} file(s) from the archive?`)) {
      deleteFiles(Array.from(selectedFiles));
    }
  };

  const handleShowInFinder = (file) => {
    ipcRenderer.invoke('shell:showInFolder', file.location);
  };

  const handleCopyFile = async (file) => {
    await ipcRenderer.invoke('clipboard:copyFiles', [file.location]);
  };

  const handleDeleteFile = (file) => {
    if (confirm(`Delete "${file.name}" from the archive?`)) {
      deleteFiles([file.id]);
    }
  };

  const handleContextMenu = async (e, file) => {
    e.preventDefault();
    
    // Build context menu options based on selection
    const isFileSelected = selectedFiles.has(file.id);
    const hasMultipleSelected = selectedFiles.size > 1;
    
    const action = await ipcRenderer.invoke('show-context-menu', {
      fileId: file.id,
      fileName: file.name,
      filePath: file.location
    });
    
    if (action === 'play') {
      togglePlayback(file.id);
    } else if (action === 'add-to-playlist') {
      // If file is selected and we have multiple selections, use all selected
      if (isFileSelected && hasMultipleSelected) {
        setContextMenuPosition({ x: e.clientX, y: e.clientY });
        setShowAddToPlaylistMenu(true);
      } else {
        setContextMenuFile(file);
        setContextMenuPosition({ x: e.clientX, y: e.clientY });
      }
    } else if (action === 'show-in-finder') {
      handleShowInFinder(file);
    } else if (action === 'delete') {
      // If file is selected and we have multiple selections, delete all selected
      if (isFileSelected && hasMultipleSelected) {
        if (confirm(`Delete ${selectedFiles.size} file(s) from the archive?`)) {
          deleteFiles(Array.from(selectedFiles));
        }
      } else {
        handleDeleteFile(file);
      }
    }
  };

  const handleKeyDown = (e) => {
    // Prevent keyboard shortcuts when typing in search input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    
    if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      selectAllFiles();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      handleDelete();
    }
  };

  const handleCreatePlaylist = async () => {
    if (newPlaylistName.trim()) {
      const fileIdsToAdd = selectedFiles.size > 0 ? Array.from(selectedFiles) : [];
      await createPlaylist(newPlaylistName.trim(), fileIdsToAdd);
      setNewPlaylistName('');
      setShowNewPlaylistDialog(false);
    }
  };

  const handleAddToPlaylist = async (playlistId) => {
    let fileIds = [];
    
    if (contextMenuFile) {
      // Adding from context menu
      fileIds = [contextMenuFile.id];
      setContextMenuFile(null);
    } else if (selectedFiles.size > 0) {
      // Adding from selection
      fileIds = Array.from(selectedFiles);
    }
    
    if (fileIds.length > 0) {
      await addToPlaylist(playlistId, fileIds);
      setShowAddToPlaylistMenu(false);
    }
  };

  const handleDragStart = (e, fileId) => {
    e.dataTransfer.effectAllowed = 'copy';
    
    // If dragging a selected file, drag all selected files
    if (selectedFiles.has(fileId)) {
      e.dataTransfer.setData('fileIds', JSON.stringify(Array.from(selectedFiles)));
    } else {
      e.dataTransfer.setData('fileIds', JSON.stringify([fileId]));
    }
  };

  const handleDragOver = (e, playlistId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverPlaylist(playlistId);
  };

  const handleDragLeave = () => {
    setDragOverPlaylist(null);
  };

  const handleDrop = async (e, playlistId) => {
    e.preventDefault();
    setDragOverPlaylist(null);
    const fileIds = JSON.parse(e.dataTransfer.getData('fileIds'));
    if (fileIds && fileIds.length > 0) {
      await addToPlaylist(playlistId, fileIds);
    }
  };

  // Column resize handlers
  const handleColumnResizeStart = (e, column) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizingColumn.current = column;
    startX.current = e.clientX;
    startWidth.current = columnWidths[column];
  };

  const handleColumnResize = (e) => {
    if (!isResizing || !headerRef.current) return;

    const headerWidth = headerRef.current.offsetWidth;
    const deltaX = e.clientX - startX.current;
    const deltaPercent = (deltaX / headerWidth) * 100;
    const newWidth = Math.max(10, startWidth.current + deltaPercent);

    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn.current]: newWidth
    }));
  };

  const handleColumnResizeEnd = () => {
    if (isResizing) {
      justFinishedResizing.current = true;
      setTimeout(() => {
        justFinishedResizing.current = false;
      }, 100);

      // Save column widths to database
      db.savePreference('columnWidths', columnWidths);
    }
    setIsResizing(false);
    resizingColumn.current = null;
  };

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
    
    const deltaX = e.clientX - sidebarStartX.current;
    const newWidth = Math.max(180, Math.min(400, sidebarStartWidth.current + deltaX));
    setSidebarWidth(newWidth);
  };

  const handleSidebarResizeEnd = () => {
    if (isResizingSidebar) {
      // Save sidebar width to database
      db.savePreference('sidebarWidth', sidebarWidth);
    }
    setIsResizingSidebar(false);
  };

  // Measure list container height
  React.useEffect(() => {
    const updateListHeight = () => {
      if (listContainerRef.current) {
        const height = listContainerRef.current.clientHeight;
        setListHeight(height);
      }
    };

    updateListHeight();

    // Use ResizeObserver to handle resizing
    const resizeObserver = new ResizeObserver(updateListHeight);
    if (listContainerRef.current) {
      resizeObserver.observe(listContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Add global mouse handlers
  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleColumnResize);
      document.addEventListener('mouseup', handleColumnResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleColumnResize);
        document.removeEventListener('mouseup', handleColumnResizeEnd);
      };
    }
  }, [isResizing]);

  React.useEffect(() => {
    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleSidebarResize);
      document.addEventListener('mouseup', handleSidebarResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleSidebarResize);
        document.removeEventListener('mouseup', handleSidebarResizeEnd);
      };
    }
  }, [isResizingSidebar]);

  const handleHeaderClick = (column) => {
    // Don't sort if we just finished resizing
    if (justFinishedResizing.current) {
      return;
    }
    setSortColumn(column);
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatPath = (path) => {
    // Remove the filename to show only the folder path
    const parts = path.split('/');
    const folderParts = parts.slice(0, -1); // Remove last part (filename)

    // Remove the first level (e.g., '' and 'Volumes' or 'Users')
    // Path starts with '/', so parts[0] is '', parts[1] is 'Volumes' or 'Users', etc.
    const pathWithoutFirstLevel = folderParts.length > 3
      ? folderParts.slice(3)
      : folderParts.slice(-1);

    return pathWithoutFirstLevel.join('/');
  };

  return (
    <div className="archive-view" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Playlist Sidebar */}
      {isPlaylistPaneOpen && (
        <div className="playlists-sidebar" style={{ width: `${sidebarWidth}px` }}>
          <div 
            className="sidebar-resize-handle"
            onMouseDown={handleSidebarResizeStart}
          />
          <div className="playlists-header">
            <span>Playlists</span>
            <button
              onClick={() => setShowNewPlaylistDialog(true)}
              title="New Playlist"
            >
              +
            </button>
          </div>
          <div className="playlists-list">
            {/* All Files - special item */}
            <div
              className={`playlist-item ${!selectedPlaylist ? 'active' : ''}`}
              onClick={() => selectPlaylist(null)}
            >
              <div className="playlist-name">All Files</div>
            </div>
            
            {Object.keys(playlists).length === 0 ? (
              <div className="empty-playlists">
                No playlists yet
              </div>
            ) : (
              Object.entries(playlists)
                .sort(([idA, a], [idB, b]) => {
                  if (idA === '__favorites__') return -1;
                  if (idB === '__favorites__') return 1;
                  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                })
                .map(([id, playlist]) => (
                <div
                  key={id}
                  className={`playlist-item ${selectedPlaylist === id ? 'active' : ''} ${dragOverPlaylist === id ? 'drag-over' : ''}`}
                  onClick={() => selectPlaylist(id)}
                  onDragOver={(e) => handleDragOver(e, id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, id)}
                >
                  <div className="playlist-name">{playlist.name}</div>
                  {!playlist.isSystem && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete playlist "${playlist.name}"?`)) {
                          deletePlaylist(id);
                        }
                      }}
                      className="playlist-delete"
                      title="Delete"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Archive Content */}
      <div className="archive-main">
        {currentFile && (
          <div className="player-section">
            <div className="player-info">
              <div className="player-info-header">
                <span
                  className={`player-favorite ${currentFile.isFavorite ? 'favorite-filled' : 'favorite-empty'}`}
                  onClick={() => toggleFavorite(currentFile.id)}
                  style={{ cursor: 'pointer', fontSize: '18px' }}
                  title={currentFile.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {currentFile.isFavorite ? '★' : '☆'}
                </span>
                <div className="file-name-frame">
                  <h3>{currentFile.name}</h3>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="show-in-finder-button"
                    onClick={() => handleCopyFile(currentFile)}
                    title="Copy audio file to clipboard"
                  >
                    Copy
                  </button>
                  <button
                    className="show-in-finder-button"
                    onClick={() => handleShowInFinder(currentFile)}
                    title="Show in Finder"
                  >
                    Show
                  </button>
                </div>
              </div>
              <span className="player-date">{formatDate(currentFile.date)}</span>
            </div>
            <WaveformPlayer file={currentFile} />
          </div>
        )}

        <div className="toolbar">
          <button 
            className={`toolbar-button ${isPlaylistPaneOpen ? 'active' : ''}`}
            onClick={() => togglePlaylistPane()} 
            title={isPlaylistPaneOpen ? "Hide Playlists" : "Show Playlists"}
          >
            <svg viewBox="0 0 24 24" style={{ width: '14px', height: '14px' }}>
              <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" fill="currentColor"/>
            </svg>
          </button>
          <button 
            className="toolbar-button" 
            onClick={handleAdd} 
            title="Add Files or Folders"
          >
            Add
          </button>
          <button 
            className={`toolbar-button ${isRandomPlaybackActive ? 'active' : ''}`}
            onClick={toggleRandomPlayback}
            title="Random Playback"
          >
            Random
          </button>
          {selectedFiles.size > 0 && (
            <>
              <button
                className="toolbar-button"
                onClick={() => setShowAddToPlaylistMenu(!showAddToPlaylistMenu)}
                title="Add to Playlist"
              >
                + Playlist
              </button>
              {showAddToPlaylistMenu && (
                <div style={{
                  position: 'absolute',
                  top: '50px',
                  left: '180px',
                  background: '#fff',
                  border: '1px solid rgba(0,0,0,0.15)',
                  borderRadius: '4px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  zIndex: 100,
                  minWidth: '150px'
                }}>
                  {Object.entries(playlists).map(([id, playlist]) => (
                    <div
                      key={id}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        borderBottom: '1px solid rgba(0,0,0,0.05)'
                      }}
                      onClick={() => handleAddToPlaylist(id)}
                      onMouseEnter={(e) => e.target.style.background = 'rgba(0,0,0,0.05)'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      {playlist.name}
                    </div>
                  ))}
                  {Object.keys(playlists).length === 0 && (
                    <div style={{ padding: '8px 12px', fontSize: '12px', opacity: 0.6 }}>
                      No playlists
                    </div>
                  )}
                </div>
              )}
            </>
          )}
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
          <input
            type="search"
            className="search-input"
            placeholder="Search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

                <div className="file-table-container">
          <div className="file-table-header" ref={headerRef}>
            <div style={{ display: 'flex', width: '100%' }}>
              <div
                className="file-table-header-cell favorite-header"
                style={{ width: `${columnWidths.favorite}%`, textAlign: 'center' }}
              >
                ★
              </div>
              <div
                className="file-table-header-cell"
                style={{ width: `${columnWidths.name}%` }}
                onClick={() => handleHeaderClick('name')}
              >
                NAME {sortColumn === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                <div
                  className="column-resize-handle"
                  onMouseDown={(e) => handleColumnResizeStart(e, 'name')}
                />
              </div>
              <div
                className="file-table-header-cell"
                style={{ width: `${columnWidths.duration}%` }}
                onClick={() => handleHeaderClick('duration')}
              >
                DURATION {sortColumn === 'duration' && (sortOrder === 'asc' ? '↑' : '↓')}
                <div
                  className="column-resize-handle"
                  onMouseDown={(e) => handleColumnResizeStart(e, 'duration')}
                />
              </div>
              <div
                className="file-table-header-cell"
                style={{ width: `${columnWidths.date}%` }}
                onClick={() => handleHeaderClick('date')}
              >
                DATE {sortColumn === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
                <div
                  className="column-resize-handle"
                  onMouseDown={(e) => handleColumnResizeStart(e, 'date')}
                />
              </div>
              <div
                className="file-table-header-cell"
                style={{ width: `${columnWidths.location}%` }}
                onClick={() => handleHeaderClick('location')}
              >
                LOCATION {sortColumn === 'location' && (sortOrder === 'asc' ? '↑' : '↓')}
                <div
                  className="column-resize-handle"
                  onMouseDown={(e) => handleColumnResizeStart(e, 'location')}
                />
              </div>
              <div style={{ width: '15px', flexShrink: 0 }}></div> {/* Scrollbar spacer */}
            </div>
          </div>
          <div className="file-table-body" ref={listContainerRef}>
            {filteredFiles.length === 0 ? (
              <div className="empty-list">No files to display</div>
            ) : (
              <List
                height={listHeight}
                itemCount={filteredFiles.length}
                itemSize={28}
                width="100%"
                outerRef={listRef}
              >
                {({ index, style }) => {
                  const file = filteredFiles[index];

                  const handleCellMouseDown = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  };

                  const handleCellMouseUp = (e) => {
                    e.stopPropagation();
                    if (e.detail === 2) {
                      togglePlayback(file.id);
                    } else if (e.detail === 1) {
                      if (e.shiftKey && lastClickedIndex !== null) {
                        const start = Math.min(lastClickedIndex, index);
                        const end = Math.max(lastClickedIndex, index);
                        const rangeIds = filteredFiles.slice(start, end + 1).map(f => f.id);
                        addFilesToSelection(rangeIds);
                      } else if (e.metaKey || e.ctrlKey) {
                        toggleFileSelection(file.id);
                        setLastClickedIndex(index);
                      } else {
                        selectFiles([file.id]);
                        setLastClickedIndex(index);
                      }
                    }
                  };

                  return (
                    <div
                      key={file.id}
                      style={{
                        ...style,
                        display: 'flex',
                        width: '100%',
                        boxSizing: 'border-box'
                      }}
                      draggable="true"
                      onDragStart={(e) => handleDragStart(e, file.id)}
                      className={`file-table-row ${index % 2 === 0 ? 'even' : ''} ${selectedFiles.has(file.id) ? 'selected' : ''} ${currentlyPlaying === file.id ? 'playing' : ''}`}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                    >
                      <div
                        className="file-table-cell file-favorite"
                        style={{ width: `${columnWidths.favorite}%`, flexShrink: 0, textAlign: 'center', cursor: 'pointer' }}
                        draggable="false"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          toggleFavorite(file.id);
                        }}
                      >
                        <span className={file.isFavorite ? 'favorite-filled' : 'favorite-empty'}>
                          {file.isFavorite ? '★' : '☆'}
                        </span>
                      </div>
                      <div
                        className="file-table-cell file-name"
                        style={{ width: `${columnWidths.name}%`, flexShrink: 0, cursor: 'pointer', pointerEvents: 'auto' }}
                        draggable="false"
                        onMouseDown={handleCellMouseDown}
                        onMouseUp={handleCellMouseUp}
                      >
                        {file.name}
                      </div>
                      <div
                        className="file-table-cell file-duration"
                        style={{ width: `${columnWidths.duration}%`, flexShrink: 0, cursor: 'pointer' }}
                        draggable="false"
                        onMouseDown={handleCellMouseDown}
                        onMouseUp={handleCellMouseUp}
                      >
                        {formatDuration(file.duration)}
                      </div>
                      <div
                        className="file-table-cell file-date"
                        style={{ width: `${columnWidths.date}%`, flexShrink: 0, cursor: 'pointer' }}
                        draggable="false"
                        onMouseDown={handleCellMouseDown}
                        onMouseUp={handleCellMouseUp}
                      >
                        {formatDate(file.date)}
                      </div>
                      <div
                        className="file-table-cell file-location"
                        style={{ width: `${columnWidths.location}%`, flexShrink: 0, cursor: 'pointer' }}
                        draggable="false"
                        onMouseDown={handleCellMouseDown}
                        onMouseUp={handleCellMouseUp}
                      >
                        {formatPath(file.location)}
                      </div>
                    </div>
                  );
                }}
              </List>
            )}
          </div>
        </div>
      </div>

      {/* New Playlist Dialog */}
      {showNewPlaylistDialog && (
        <div className="modal-overlay" onClick={() => setShowNewPlaylistDialog(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Playlist</h3>
            <input
              type="text"
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              placeholder="Playlist name..."
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreatePlaylist();
                if (e.key === 'Escape') setShowNewPlaylistDialog(false);
              }}
            />
            <div className="modal-buttons">
              <button onClick={handleCreatePlaylist} disabled={!newPlaylistName.trim()}>
                Create
              </button>
              <button onClick={() => setShowNewPlaylistDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu Playlist Selector */}
      {contextMenuFile && (
        <>
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99
            }}
            onClick={() => setContextMenuFile(null)}
          />
          <div style={{
            position: 'fixed',
            top: contextMenuPosition.y,
            left: contextMenuPosition.x,
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 100,
            minWidth: '150px'
          }}>
            {Object.entries(playlists).map(([id, playlist]) => (
              <div
                key={id}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  borderBottom: '1px solid rgba(0,0,0,0.05)'
                }}
                onClick={() => handleAddToPlaylist(id)}
                onMouseEnter={(e) => e.target.style.background = 'rgba(0,0,0,0.05)'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                {playlist.name}
              </div>
            ))}
            {Object.keys(playlists).length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: '12px', opacity: 0.6 }}>
                No playlists
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ArchiveView;
