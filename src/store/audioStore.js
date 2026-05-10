import { create } from 'zustand';
import * as db from '../database';
import { DEFAULT_COLOR_PALETTE } from '../database';

// Use built-in crypto for UUID generation
const uuidv4 = () => crypto.randomUUID();

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.require;

// Safely get Electron modules
const ipcRenderer = isElectron ? window.require('electron').ipcRenderer : null;
const path = isElectron ? window.require('path') : null;
const fs = isElectron ? window.require('fs').promises : null;

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.aiff', '.flac', '.m4a', '.aac', '.ogg'];

// Recursively walk a folder and return all audio file paths.
const walkAudioFolder = async (folderPath) => {
  if (!isElectron) return [];
  const filePaths = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await ipcRenderer.invoke('fs:readDir', dir);
    } catch (err) {
      console.warn(`Cannot read directory ${dir}:`, err.message);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        await walk(entry.path);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          filePaths.push(entry.path);
        }
      }
    }
  };
  await walk(folderPath);
  return filePaths;
};

export const useAudioStore = create((set, get) => ({
  // State
  audioFiles: [],
  currentlyPlaying: null,
  playbackProgress: 0,
  isPlaying: false,
  isPaused: false,
  selectedTab: 'archive',
  selectedFiles: new Set(),
  searchText: '',
  sortColumn: 'name',
  sortOrder: 'asc',
  masterVolume: 1.0,
  isAnalyzingFiles: false,
  
  // Shuffler state
  shufflerTracks: [],
  isShufflerPlaying: false,
  isShufflerPaused: false,
  combinations: {},
  activeCombinationId: null,
  shufflerResetTimestamp: 0,
  
  // Random playback
  isRandomPlaybackActive: false,
  playedFiles: new Set(),
  
  // Playlists
  playlists: {},
  selectedPlaylist: null,
  isPlaylistPaneOpen: false,

  // Library rescan
  importedFolders: [],
  isScanning: false,

  // Color / brightness tagging (Rod Modell-style)
  colorPalette: DEFAULT_COLOR_PALETTE,
  colorFilter: new Set(),                                    // active color ids; empty = no filter
  brightnessFilter: { min: 1, max: 10, includeUnrated: true },

  // Initialize - load from database
  initialize: async () => {
    // Migrate any broken file paths caused by folder reorganisation.
    if (isElectron) {
      const fsSync = window.require('fs');
      const pathModule = window.require('path');
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

      const allFiles = await db.getAudioFiles();
      for (const file of allFiles) {
        if (fsSync.existsSync(file.location)) continue;

        let fixed = null;

        // Case 1: /Mood Recordings/DD Month YYYY/file → /Mood Recordings/YYYY/DD Month YYYY/file
        const case1 = file.location.replace(
          /\/Mood Recordings\/(\d{2} [A-Za-z]+ (\d{4}))\//,
          '/Mood Recordings/$2/$1/'
        );
        if (case1 !== file.location && fsSync.existsSync(case1)) {
          fixed = case1;
        }

        // Case 2: file stored directly in /Mood Recordings/YYYYMMDD... → /Mood Recordings/YYYY/MM MonthName YYYY/filename
        if (!fixed) {
          const match = file.location.match(/\/Mood Recordings\/(\d{4})(\d{2})\d{2}[ _]/);
          if (match) {
            const year = match[1];
            const monthNum = match[2];
            const monthName = MONTHS[parseInt(monthNum, 10) - 1];
            const fileName = pathModule.basename(file.location);
            const dir = pathModule.dirname(file.location);
            const candidate = `${dir}/${year}/${monthNum} ${monthName} ${year}/${fileName}`;
            if (fsSync.existsSync(candidate)) {
              fixed = candidate;
            }
          }
        }

        if (fixed) {
          await db.saveAudioFile({ ...file, location: fixed });
          console.log(`Migrated: ${file.location} → ${fixed}`);
        }
      }
    }

    const files = await db.getAudioFiles();
    const combinationsArray = await db.getCombinations();
    const playlistsArray = await db.getPlaylists();
    const importedFolders = await db.getImportedFolders();
    const sortColumn = await db.getPreference('sortColumn') || 'name';
    const sortOrder = await db.getPreference('sortOrder') || 'asc';
    const masterVolume = await db.getPreference('masterVolume') || 1.0;
    const isPlaylistPaneOpen = await db.getPreference('isPlaylistPaneOpen') || false;
    const savedPalette = await db.getPreference('colorPalette');
    const colorPalette = Array.isArray(savedPalette) && savedPalette.length > 0
      ? savedPalette
      : DEFAULT_COLOR_PALETTE;
    if (!savedPalette) {
      await db.savePreference('colorPalette', colorPalette);
    }

    // Clean up old and orphaned waveform cache (runs in background)
    db.cleanupWaveformCache().catch(err => {
      console.error('Waveform cache cleanup failed:', err);
    });

    // Convert combinations array to object keyed by id
    const combinations = {};
    combinationsArray.forEach(combo => {
      combinations[combo.id] = combo;
    });

    // Convert playlists array to object keyed by id
    const playlists = {};
    playlistsArray.forEach(playlist => {
      playlists[playlist.id] = playlist;
    });

    set({
      audioFiles: files,
      combinations,
      playlists,
      importedFolders,
      sortColumn,
      sortOrder,
      masterVolume: parseFloat(masterVolume),
      isPlaylistPaneOpen: Boolean(isPlaylistPaneOpen),
      colorPalette
    });

    // Apply the saved sorting immediately
    get().sortFiles();

    // Update Favorites playlist
    await get().updateFavoritesPlaylist();

    // Kick off background rescan of all imported folders.
    if (isElectron && importedFolders.length > 0) {
      get().rescanAllFolders().catch(err => {
        console.error('Background rescan failed:', err);
      });
    }
  },

  // Add audio files
  addAudioFiles: async (filePaths) => {
    if (!isElectron) {
      console.warn('File system access only available in Electron');
      return;
    }

    const { audioFiles } = get();
    const newFiles = [];

    // Step 1: Add all files immediately to UI without duration analysis
    for (const filePath of filePaths) {
      // Check if already exists
      if (audioFiles.some(f => f.location === filePath)) {
        continue;
      }

      const stats = await ipcRenderer.invoke('fs:stat', filePath);
      const fileName = path.basename(filePath, path.extname(filePath));

      const file = {
        id: uuidv4(),
        name: fileName,
        location: filePath,
        duration: 0, // Start with 0, analyze later
        date: stats.birthtime,
        size: stats.size,
        tags: [],
        isFavorite: false
      };

      await db.saveAudioFile(file);
      newFiles.push(file);
    }

    // Add to UI immediately
    set({ audioFiles: [...audioFiles, ...newFiles] });
    get().sortFiles();

    // Step 2: Analyze durations in background
    if (newFiles.length > 0) {
      set({ isAnalyzingFiles: true });

      let successCount = 0;
      let failCount = 0;

      // Analyze each file in background using blob URLs (same as double-click)
      for (const file of newFiles) {
        try {
          // Read file buffer from main process
          const result = await ipcRenderer.invoke('audio:readFileForAnalysis', file.location);

          if (result && result.buffer) {
            // Create blob URL (same approach as WaveformPlayer)
            const uint8Array = new Uint8Array(result.buffer);
            const blob = new Blob([uint8Array], { type: result.mimeType });
            const blobUrl = URL.createObjectURL(blob);

            // Get duration using Audio element
            const duration = await new Promise((resolve) => {
              const audio = new Audio();
              audio.addEventListener('loadedmetadata', () => {
                resolve(audio.duration);
                URL.revokeObjectURL(blobUrl); // Clean up
              });
              audio.addEventListener('error', () => {
                resolve(0);
                URL.revokeObjectURL(blobUrl); // Clean up
              });
              audio.src = blobUrl;
            });

            if (duration && duration > 0) {
              // Update file with duration
              const updatedFile = {
                ...file,
                duration: duration
              };

              await db.saveAudioFile(updatedFile);

              // Update state immediately as each file is analyzed
              set(state => ({
                audioFiles: state.audioFiles.map(f =>
                  f.id === file.id ? updatedFile : f
                )
              }));

              successCount++;
            } else {
              failCount++;
            }
          } else {
            failCount++;
          }
        } catch (error) {
          console.warn(`Background analysis failed for ${file.name} - will analyze on first play`);
          failCount++;
        }
      }

      console.log(`Background analysis complete: ${successCount} analyzed, ${failCount} will be analyzed on first play`);
      set({ isAnalyzingFiles: false });
    }
  },

  // Add folder recursively
  addFolder: async (folderPath) => {
    if (!isElectron) {
      console.warn('Folder access only available in Electron');
      return;
    }

    const filePaths = await walkAudioFolder(folderPath);
    await get().addAudioFiles(filePaths);

    const record = {
      path: folderPath,
      dateAdded: new Date().toISOString(),
      lastScanned: new Date().toISOString()
    };
    await db.saveImportedFolder(record);
    set(state => ({
      importedFolders: [
        ...state.importedFolders.filter(f => f.path !== folderPath),
        record
      ]
    }));
  },

  // Rescan a single imported folder: detect new, moved, and missing files.
  rescanFolder: async (folderPath) => {
    if (!isElectron) return;

    set({ isScanning: true });
    try {
      const diskPaths = await walkAudioFolder(folderPath);
      const diskSet = new Set(diskPaths);

      const { audioFiles } = get();
      const normalisedFolder = folderPath.endsWith('/') ? folderPath : folderPath + '/';
      const knownInFolder = audioFiles.filter(f =>
        f.location === folderPath || f.location.startsWith(normalisedFolder)
      );
      const knownPathSet = new Set(knownInFolder.map(f => f.location));

      // Buckets of unmatched entries on each side.
      const missingKnown = knownInFolder.filter(f => !diskSet.has(f.location));
      const unknownDisk = diskPaths.filter(p => !knownPathSet.has(p));

      // Also consider library files currently flagged missing (any folder),
      // so a file moved from folder A into folder B is reunited on B's rescan.
      const globallyMissing = audioFiles.filter(f =>
        f.isMissing &&
        !missingKnown.some(m => m.id === f.id) &&
        !knownPathSet.has(f.location)
      );
      const matchCandidates = [...missingKnown, ...globallyMissing];

      // Move detection: match missing entries to unknown disk files by basename + size.
      const diskStats = await Promise.all(
        unknownDisk.map(async p => {
          try {
            const stats = await ipcRenderer.invoke('fs:stat', p);
            return { path: p, size: stats.size, base: path.basename(p) };
          } catch {
            return null;
          }
        })
      );
      const availableDisk = diskStats.filter(Boolean);

      const updates = [];            // files whose location changed or isMissing flipped
      const consumedDiskPaths = new Set();

      for (const known of matchCandidates) {
        const knownBase = path.basename(known.location);
        // Prefer basename + size match when a recorded size exists (new files
        // import with size); fall back to basename-only for legacy entries.
        const candidate = availableDisk.find(c =>
          !consumedDiskPaths.has(c.path) &&
          c.base === knownBase &&
          (known.size == null || c.size === known.size)
        );
        if (!candidate) continue;
        consumedDiskPaths.add(candidate.path);
        const updated = { ...known, location: candidate.path, size: candidate.size, isMissing: false };
        await db.saveAudioFile(updated);
        updates.push(updated);
      }

      // Remaining missing: flag isMissing.
      for (const known of missingKnown) {
        if (updates.some(u => u.id === known.id)) continue;
        if (known.isMissing) continue;
        const flagged = { ...known, isMissing: true };
        await db.saveAudioFile(flagged);
        updates.push(flagged);
      }

      // Any previously-missing entries that are now present should be un-flagged.
      for (const known of knownInFolder) {
        if (known.isMissing && diskSet.has(known.location)) {
          const cleared = { ...known, isMissing: false };
          await db.saveAudioFile(cleared);
          updates.push(cleared);
        }
      }

      // Apply updates to state in one pass.
      if (updates.length > 0) {
        const byId = new Map(updates.map(u => [u.id, u]));
        set(state => ({
          audioFiles: state.audioFiles.map(f => byId.get(f.id) || f)
        }));
      }

      // New files: anything on disk not consumed by a move and not already in DB.
      const newPaths = unknownDisk.filter(p => !consumedDiskPaths.has(p));
      if (newPaths.length > 0) {
        await get().addAudioFiles(newPaths);
      }

      const relocatedCount = consumedDiskPaths.size;
      const nowMissingCount = updates.filter(u => u.isMissing).length;
      console.log(
        `Rescan ${folderPath}: +${newPaths.length} new, ~${relocatedCount} relocated, ${nowMissingCount} missing`
      );

      // Update folder's lastScanned.
      const updatedFolder = {
        ...(get().importedFolders.find(f => f.path === folderPath) || { path: folderPath, dateAdded: new Date().toISOString() }),
        lastScanned: new Date().toISOString()
      };
      await db.saveImportedFolder(updatedFolder);
      set(state => ({
        importedFolders: state.importedFolders.map(f =>
          f.path === folderPath ? updatedFolder : f
        )
      }));
    } finally {
      set({ isScanning: false });
    }
  },

  rescanAllFolders: async () => {
    if (!isElectron) return;
    const folders = get().importedFolders;
    for (const folder of folders) {
      try {
        await get().rescanFolder(folder.path);
      } catch (err) {
        console.error(`Rescan failed for ${folder.path}:`, err);
      }
    }
  },

  removeImportedFolder: async (folderPath) => {
    await db.deleteImportedFolder(folderPath);
    set(state => ({
      importedFolders: state.importedFolders.filter(f => f.path !== folderPath)
    }));
  },

  // Manually re-link a library entry to a new path on disk.
  relocateFile: async (fileId, newPath) => {
    if (!isElectron) return;
    const { audioFiles } = get();
    const file = audioFiles.find(f => f.id === fileId);
    if (!file) return;

    let size = file.size;
    try {
      const stats = await ipcRenderer.invoke('fs:stat', newPath);
      size = stats.size;
    } catch (err) {
      console.warn('Could not stat relocated file:', err);
    }

    const updated = { ...file, location: newPath, size, isMissing: false };
    await db.saveAudioFile(updated);
    set(state => ({
      audioFiles: state.audioFiles.map(f => f.id === fileId ? updated : f)
    }));
  },

  // Delete files
  deleteFiles: async (fileIds) => {
    const { audioFiles, currentlyPlaying, playlists } = get();

    // Stop if currently playing
    if (fileIds.includes(currentlyPlaying)) {
      get().stopPlayback();
    }

    // Delete from database
    for (const id of fileIds) {
      await db.deleteAudioFile(id);
    }

    // Update playlists - remove deleted files from all playlists
    const updatedPlaylists = {};
    for (const [playlistId, playlist] of Object.entries(playlists)) {
      const updatedFileIds = playlist.fileIds.filter(id => !fileIds.includes(id));
      updatedPlaylists[playlistId] = {
        ...playlist,
        fileIds: updatedFileIds
      };
      await db.savePlaylist(updatedPlaylists[playlistId]);
    }

    // Update state
    set({
      audioFiles: audioFiles.filter(f => !fileIds.includes(f.id)),
      selectedFiles: new Set(),
      playlists: updatedPlaylists
    });
  },

  // Toggle favorite
  toggleFavorite: async (fileId) => {
    const { audioFiles, playlists } = get();
    const file = audioFiles.find(f => f.id === fileId);

    if (!file) return;

    // Toggle the favorite status
    const updatedFile = {
      ...file,
      isFavorite: !file.isFavorite
    };

    // Save to database
    await db.saveAudioFile(updatedFile);

    // Update state
    const updatedFiles = audioFiles.map(f => f.id === fileId ? updatedFile : f);
    set({ audioFiles: updatedFiles });

    // Update Favorites playlist
    await get().updateFavoritesPlaylist();
  },

  // Update Favorites playlist based on favorite files
  updateFavoritesPlaylist: async () => {
    const { audioFiles, playlists } = get();

    // Find all favorite files
    const favoriteFileIds = audioFiles.filter(f => f.isFavorite).map(f => f.id);

    // Find or create Favorites playlist
    let favoritesPlaylist = Object.values(playlists).find(p => p.name === '★ Favorites');

    if (!favoritesPlaylist) {
      // Create new Favorites playlist
      favoritesPlaylist = {
        id: '__favorites__',
        name: '★ Favorites',
        fileIds: favoriteFileIds,
        created: new Date().toISOString(),
        isSystem: true // Mark as system playlist
      };
    } else {
      // Update existing Favorites playlist
      favoritesPlaylist = {
        ...favoritesPlaylist,
        fileIds: favoriteFileIds
      };
    }

    await db.savePlaylist(favoritesPlaylist);

    set({
      playlists: {
        ...playlists,
        [favoritesPlaylist.id]: favoritesPlaylist
      }
    });
  },

  // Sorting
  sortFiles: () => {
    const { audioFiles, sortColumn, sortOrder } = get();
    
    const sorted = [...audioFiles].sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];
      
      if (sortColumn === 'date') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    set({ audioFiles: sorted });
  },

  setSortColumn: (column) => {
    const { sortColumn, sortOrder } = get();
    
    if (column === sortColumn) {
      // Toggle order
      const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      set({ sortOrder: newOrder });
      db.savePreference('sortOrder', newOrder);
    } else {
      set({ sortColumn: column, sortOrder: 'asc' });
      db.savePreference('sortColumn', column);
      db.savePreference('sortOrder', 'asc');
    }
    
    get().sortFiles();
  },

  // Playback controls
  togglePlayback: (fileId) => {
    const { currentlyPlaying, isPaused } = get();
    
    if (currentlyPlaying === fileId) {
      set({ isPaused: !isPaused });
    } else {
      set({
        currentlyPlaying: fileId,
        isPlaying: true,
        isPaused: false,
        playbackProgress: 0
      });
    }
  },

  stopPlayback: () => {
    set({
      currentlyPlaying: null,
      isPlaying: false,
      isPaused: false,
      playbackProgress: 0,
      isRandomPlaybackActive: false
    });
  },

  setPlaybackProgress: (progress) => {
    set({ playbackProgress: progress });
  },

  // Random playback
  toggleRandomPlayback: () => {
    const { isRandomPlaybackActive } = get();
    
    if (isRandomPlaybackActive) {
      // If already active, skip to next random track
      get().playRandomFile();
    } else {
      // If not active, activate and start playing
      set({ isRandomPlaybackActive: true, playedFiles: new Set() });
      get().playRandomFile();
    }
  },

  playRandomFile: () => {
    const { audioFiles, playedFiles, selectedPlaylist, playlists, searchText, colorFilter, brightnessFilter } = get();

    // Determine the pool of files to play from
    let filePool = audioFiles;

    // Apply playlist filter
    if (selectedPlaylist && playlists[selectedPlaylist]) {
      const playlist = playlists[selectedPlaylist];
      filePool = audioFiles.filter(f => playlist.fileIds.includes(f.id));
    }

    // Apply active search filter — keep random consistent with what's visible
    if (searchText) {
      const search = searchText.toLowerCase();
      filePool = filePool.filter(f =>
        f.name.toLowerCase().includes(search) ||
        f.location.toLowerCase().includes(search)
      );
    }

    // Apply color/brightness filter — keep random consistent with the rail
    if (colorFilter && colorFilter.size > 0) {
      filePool = filePool.filter(f => f.color && colorFilter.has(f.color));
    }
    if (brightnessFilter) {
      const { min, max, includeUnrated } = brightnessFilter;
      const isFullRange = min === 1 && max === 10;
      if (!isFullRange || !includeUnrated) {
        filePool = filePool.filter(f => {
          if (f.brightness == null) return includeUnrated;
          return f.brightness >= min && f.brightness <= max;
        });
      }
    }

    // Filter unplayed files from the pool
    let candidates = filePool.filter(f => !playedFiles.has(f.id));

    // Reset if all played
    if (candidates.length === 0) {
      set({ playedFiles: new Set() });
      candidates = filePool;
    }

    if (candidates.length === 0) return;

    // Pick random
    const randomFile = candidates[Math.floor(Math.random() * candidates.length)];

    // Mark as played
    const newPlayedFiles = new Set(playedFiles);
    newPlayedFiles.add(randomFile.id);

    set({
      currentlyPlaying: randomFile.id,
      isPlaying: true,
      isPaused: false,
      playbackProgress: 0,
      playedFiles: newPlayedFiles
    });
  },

  // Shuffler
  createRandomTracks: (count = 3) => {
    const { audioFiles } = get();
    
    if (audioFiles.length === 0) {
      console.warn('No audio files available');
      return;
    }

    const shuffled = [...audioFiles].sort(() => Math.random() - 0.5);
    const tracks = shuffled.slice(0, Math.min(count, audioFiles.length)).map(file => ({
      id: uuidv4(),
      fileId: file.id,
      volume: 1.0,
      isMuted: false,
      isSoloed: false,
      isPaused: false
    }));

    set({ shufflerTracks: tracks, activeCombinationId: null });
  },

  toggleShufflerPlayback: () => {
    const { isShufflerPlaying, isShufflerPaused } = get();
    
    if (isShufflerPlaying) {
      set({ isShufflerPaused: !isShufflerPaused });
    } else {
      set({ isShufflerPlaying: true, isShufflerPaused: false });
    }
  },

  stopShuffler: () => {
    set({ 
      isShufflerPlaying: false, 
      isShufflerPaused: false,
      shufflerResetTimestamp: Date.now()
    });
  },

  updateTrack: (trackId, updates) => {
    const { shufflerTracks } = get();
    
    set({
      shufflerTracks: shufflerTracks.map(t =>
        t.id === trackId ? { ...t, ...updates } : t
      )
    });
  },

  removeTrack: (trackId) => {
    const { shufflerTracks } = get();
    set({ shufflerTracks: shufflerTracks.filter(t => t.id !== trackId), activeCombinationId: null });
  },

  reshuffleTrack: (trackId) => {
    const { shufflerTracks, audioFiles } = get();

    if (audioFiles.length === 0) {
      console.warn('No audio files available');
      return;
    }

    // Find the track to reshuffle
    const trackIndex = shufflerTracks.findIndex(t => t.id === trackId);
    if (trackIndex === -1) return;

    const currentTrack = shufflerTracks[trackIndex];

    // Get list of file IDs currently in use
    const usedFileIds = shufflerTracks.map(t => t.fileId);

    // Try to find an unused file
    let availableFiles = audioFiles.filter(f => !usedFileIds.includes(f.id));

    // If all files are in use, allow reusing (but try to pick a different one)
    if (availableFiles.length === 0) {
      availableFiles = audioFiles.filter(f => f.id !== currentTrack.fileId);
    }

    // If still no options (only one file in library), just use any file
    if (availableFiles.length === 0) {
      availableFiles = audioFiles;
    }

    // Pick random file
    const newFile = availableFiles[Math.floor(Math.random() * availableFiles.length)];

    // Update track with new file, keeping all other settings
    const updatedTracks = [...shufflerTracks];
    updatedTracks[trackIndex] = {
      ...currentTrack,
      fileId: newFile.id
    };

    set({ shufflerTracks: updatedTracks, activeCombinationId: null });
  },

  // Combinations
  saveCombination: async (name) => {
    const { shufflerTracks, combinations } = get();
    
    // Check for duplicate names and auto-number if needed
    let finalName = name;
    const existingNames = Object.values(combinations).map(c => c.name);
    
    if (existingNames.includes(name)) {
      let counter = 2;
      while (existingNames.includes(`${name} ${counter}`)) {
        counter++;
      }
      finalName = `${name} ${counter}`;
    }
    
    const combination = {
      id: uuidv4(),
      name: finalName,
      tracks: shufflerTracks.map(t => ({
        fileId: t.fileId,
        volume: t.volume,
        isMuted: t.isMuted,
        isSoloed: t.isSoloed,
        isPaused: t.isPaused
      })),
      date: new Date().toISOString()
    };

    await db.saveCombination(combination);
    
    // Store combinations as an object keyed by id for easy lookup
    set({ 
      combinations: { 
        ...combinations, 
        [combination.id]: combination 
      } 
    });
    
    return finalName; // Return the final name so UI can show it if needed
  },

  loadCombination: (id) => {
    const { combinations, audioFiles } = get();
    const combo = combinations[id];
    
    if (!combo) return;

    // Support both old format (trackIds) and new format (tracks)
    let tracks;
    
    if (combo.tracks) {
      // New format with full state
      tracks = combo.tracks
        .map(savedTrack => {
          const file = audioFiles.find(f => f.id === savedTrack.fileId);
          if (!file) return null;
          
          return {
            id: uuidv4(),
            fileId: file.id,
            volume: savedTrack.volume ?? 1.0,
            isMuted: savedTrack.isMuted ?? false,
            isSoloed: savedTrack.isSoloed ?? false,
            isPaused: savedTrack.isPaused ?? false
          };
        })
        .filter(Boolean);
    } else {
      // Old format with just trackIds - use defaults
      tracks = combo.trackIds
        .map(fileId => audioFiles.find(f => f.id === fileId))
        .filter(Boolean)
        .map(file => ({
          id: uuidv4(),
          fileId: file.id,
          volume: 1.0,
          isMuted: false,
          isSoloed: false,
          isPaused: false
        }));
    }

    set({ shufflerTracks: tracks, activeCombinationId: id });
  },

  deleteCombination: async (id) => {
    const { combinations } = get();
    await db.deleteCombination(id);

    const newCombinations = { ...combinations };
    delete newCombinations[id];

    const updates = { combinations: newCombinations };
    if (get().activeCombinationId === id) updates.activeCombinationId = null;
    set(updates);
  },

  renameCombination: async (id, newName) => {
    const { combinations } = get();
    const combo = combinations[id];
    if (!combo || !newName.trim()) return;

    const updated = { ...combo, name: newName.trim() };
    await db.saveCombination(updated);

    set({
      combinations: {
        ...combinations,
        [id]: updated
      }
    });
  },

  duplicateCombination: async (id) => {
    const { combinations } = get();
    const combo = combinations[id];
    if (!combo) return;

    // Generate a unique copy name
    const existingNames = Object.values(combinations).map(c => c.name);
    let copyName = `${combo.name} (copy)`;
    let counter = 2;
    while (existingNames.includes(copyName)) {
      copyName = `${combo.name} (copy ${counter})`;
      counter++;
    }

    const duplicate = {
      id: uuidv4(),
      name: copyName,
      tracks: [...combo.tracks],
      date: new Date().toISOString()
    };

    await db.saveCombination(duplicate);

    set({
      combinations: {
        ...combinations,
        [duplicate.id]: duplicate
      }
    });
  },

  // UI state
  setSelectedTab: (tab) => set({ selectedTab: tab }),
  setSearchText: (text) => {
    const updates = { searchText: text };
    if (get().isRandomPlaybackActive) {
      updates.playedFiles = new Set();
    }
    set(updates);
  },
  toggleFileSelection: (fileId) => {
    const { selectedFiles } = get();
    const newSelection = new Set(selectedFiles);
    
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId);
    } else {
      newSelection.add(fileId);
    }
    
    set({ selectedFiles: newSelection });
  },
  selectAllFiles: () => {
    const { audioFiles } = get();
    set({ selectedFiles: new Set(audioFiles.map(f => f.id)) });
  },
  clearSelection: () => set({ selectedFiles: new Set() }),
  selectFiles: (fileIds) => {
    set({ selectedFiles: new Set(fileIds) });
  },
  addFilesToSelection: (fileIds) => {
    const { selectedFiles } = get();
    const newSelection = new Set(selectedFiles);
    fileIds.forEach(id => newSelection.add(id));
    set({ selectedFiles: newSelection });
  },

  // Master volume
  setMasterVolume: (volume) => {
    set({ masterVolume: volume });
    db.savePreference('masterVolume', volume);
  },
  
  // Playlists
  togglePlaylistPane: () => {
    const { isPlaylistPaneOpen } = get();
    const newState = !isPlaylistPaneOpen;
    set({ isPlaylistPaneOpen: newState });
    db.savePreference('isPlaylistPaneOpen', newState);
  },
  
  createPlaylist: async (name, fileIds = []) => {
    const { playlists } = get();
    
    const playlist = {
      id: uuidv4(),
      name: name,
      fileIds: fileIds,
      created: new Date().toISOString()
    };
    
    await db.savePlaylist(playlist);
    
    set({
      playlists: {
        ...playlists,
        [playlist.id]: playlist
      }
    });
    
    return playlist.id;
  },
  
  addToPlaylist: async (playlistId, fileIds) => {
    const { playlists } = get();
    const playlist = playlists[playlistId];
    
    if (!playlist) return;
    
    const updatedPlaylist = {
      ...playlist,
      fileIds: [...new Set([...playlist.fileIds, ...fileIds])]
    };
    
    await db.savePlaylist(updatedPlaylist);
    
    set({
      playlists: {
        ...playlists,
        [playlistId]: updatedPlaylist
      }
    });
  },
  
  removeFromPlaylist: async (playlistId, fileIds) => {
    const { playlists } = get();
    const playlist = playlists[playlistId];
    
    if (!playlist) return;
    
    const updatedPlaylist = {
      ...playlist,
      fileIds: playlist.fileIds.filter(id => !fileIds.includes(id))
    };
    
    await db.savePlaylist(updatedPlaylist);
    
    set({
      playlists: {
        ...playlists,
        [playlistId]: updatedPlaylist
      }
    });
  },
  
  selectPlaylist: (playlistId) => {
    // Reset played files when switching playlists to start fresh with random playback
    set({
      selectedPlaylist: playlistId,
      playedFiles: new Set()
    });
  },
  
  // --- Color / brightness tagging ---

  setFileColor: async (fileId, colorId) => {
    const { audioFiles } = get();
    const file = audioFiles.find(f => f.id === fileId);
    if (!file) return;
    const updated = { ...file, color: colorId || null };
    await db.saveAudioFile(updated);
    set(state => ({
      audioFiles: state.audioFiles.map(f => f.id === fileId ? updated : f)
    }));
  },

  setFileBrightness: async (fileId, brightness) => {
    const { audioFiles } = get();
    const file = audioFiles.find(f => f.id === fileId);
    if (!file) return;
    const value = brightness == null ? null : Math.max(1, Math.min(10, parseInt(brightness, 10)));
    const updated = { ...file, brightness: value };
    await db.saveAudioFile(updated);
    set(state => ({
      audioFiles: state.audioFiles.map(f => f.id === fileId ? updated : f)
    }));
  },

  bulkSetColor: async (fileIds, colorId) => {
    const { audioFiles } = get();
    const ids = new Set(fileIds);
    const updates = [];
    for (const file of audioFiles) {
      if (!ids.has(file.id)) continue;
      const next = { ...file, color: colorId || null };
      await db.saveAudioFile(next);
      updates.push(next);
    }
    const byId = new Map(updates.map(u => [u.id, u]));
    set(state => ({
      audioFiles: state.audioFiles.map(f => byId.get(f.id) || f)
    }));
  },

  bulkSetBrightness: async (fileIds, brightness) => {
    const { audioFiles } = get();
    const ids = new Set(fileIds);
    const value = brightness == null ? null : Math.max(1, Math.min(10, parseInt(brightness, 10)));
    const updates = [];
    for (const file of audioFiles) {
      if (!ids.has(file.id)) continue;
      const next = { ...file, brightness: value };
      await db.saveAudioFile(next);
      updates.push(next);
    }
    const byId = new Map(updates.map(u => [u.id, u]));
    set(state => ({
      audioFiles: state.audioFiles.map(f => byId.get(f.id) || f)
    }));
  },

  // Filter state
  toggleColorFilter: (colorId) => {
    const { colorFilter, isRandomPlaybackActive } = get();
    const next = new Set(colorFilter);
    if (next.has(colorId)) next.delete(colorId); else next.add(colorId);
    const updates = { colorFilter: next };
    if (isRandomPlaybackActive) updates.playedFiles = new Set();
    set(updates);
  },

  setBrightnessFilter: (patch) => {
    const { brightnessFilter, isRandomPlaybackActive } = get();
    const next = { ...brightnessFilter, ...patch };
    if (next.min > next.max) next.min = next.max;
    const updates = { brightnessFilter: next };
    if (isRandomPlaybackActive) updates.playedFiles = new Set();
    set(updates);
  },

  clearColorBrightnessFilter: () => {
    set({ colorFilter: new Set(), brightnessFilter: { min: 1, max: 10, includeUnrated: true } });
  },

  // Palette CRUD
  savePalette: async (palette) => {
    await db.savePreference('colorPalette', palette);
    set({ colorPalette: palette });
  },

  addPaletteColor: async ({ name, hex }) => {
    const { colorPalette } = get();
    const baseId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'color';
    let id = baseId;
    let i = 2;
    while (colorPalette.some(c => c.id === id)) { id = `${baseId}-${i++}`; }
    const next = [...colorPalette, { id, name: name.trim(), hex }];
    await get().savePalette(next);
    return id;
  },

  updatePaletteColor: async (id, patch) => {
    const { colorPalette } = get();
    const next = colorPalette.map(c => c.id === id ? { ...c, ...patch } : c);
    await get().savePalette(next);
  },

  removePaletteColor: async (id) => {
    const { colorPalette, audioFiles } = get();
    const next = colorPalette.filter(c => c.id !== id);
    await get().savePalette(next);
    // Clear this colour from any tagged files so the UI doesn't show a phantom swatch.
    const affected = audioFiles.filter(f => f.color === id);
    if (affected.length > 0) {
      await get().bulkSetColor(affected.map(f => f.id), null);
    }
    // Drop from active filter if present.
    const { colorFilter } = get();
    if (colorFilter.has(id)) {
      const nextFilter = new Set(colorFilter);
      nextFilter.delete(id);
      set({ colorFilter: nextFilter });
    }
  },

  deletePlaylist: async (playlistId) => {
    const { playlists, selectedPlaylist } = get();

    // Prevent deleting the system Favorites playlist
    const playlist = playlists[playlistId];
    if (playlist && playlist.isSystem) {
      console.warn('Cannot delete system playlist');
      return;
    }

    await db.deletePlaylist(playlistId);

    const newPlaylists = { ...playlists };
    delete newPlaylists[playlistId];

    set({
      playlists: newPlaylists,
      selectedPlaylist: selectedPlaylist === playlistId ? null : selectedPlaylist
    });
  }
}));