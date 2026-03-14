import Dexie from 'dexie';

// Initialize IndexedDB database
export const db = new Dexie('ActiveArchiveDB');

db.version(1).stores({
  audioFiles: 'id, name, duration, date, location',
  waveformCache: 'fileId, peaks, created',
  combinations: 'id, name, date, tracks',
  preferences: 'key, value'
});

// Version 2: Add playlists
db.version(2).stores({
  audioFiles: 'id, name, duration, date, location',
  waveformCache: 'fileId, peaks, created',
  combinations: 'id, name, date, tracks',
  playlists: 'id, name, fileIds, created',
  preferences: 'key, value'
});

// Version 3: Add isFavorite to audioFiles
db.version(3).stores({
  audioFiles: 'id, name, duration, date, location, isFavorite',
  waveformCache: 'fileId, peaks, created',
  combinations: 'id, name, date, tracks',
  playlists: 'id, name, fileIds, created',
  preferences: 'key, value'
});

// Helper functions
export const saveAudioFile = async (file) => {
  await db.audioFiles.put(file);
};

export const getAudioFiles = async () => {
  return await db.audioFiles.toArray();
};

export const deleteAudioFile = async (id) => {
  await db.audioFiles.delete(id);
  await db.waveformCache.where('fileId').equals(id).delete();
};

// Bump this version when the peak computation algorithm changes
// to auto-invalidate stale cached waveforms.
const WAVEFORM_CACHE_VERSION = 2;

export const saveWaveform = async (fileId, peaks) => {
  await db.waveformCache.put({
    fileId,
    peaks,
    version: WAVEFORM_CACHE_VERSION,
    created: Date.now()
  });
};

export const getWaveform = async (fileId) => {
  const cached = await db.waveformCache.get(fileId);
  if (cached && cached.version !== WAVEFORM_CACHE_VERSION) {
    // Stale cache entry — delete and return null to force recomputation
    await db.waveformCache.delete(fileId);
    return null;
  }
  return cached;
};

export const saveCombination = async (combination) => {
  await db.combinations.put(combination);
};

export const getCombinations = async () => {
  return await db.combinations.toArray();
};

export const deleteCombination = async (id) => {
  await db.combinations.delete(id);
};

export const savePreference = async (key, value) => {
  await db.preferences.put({ key, value });
};

export const getPreference = async (key) => {
  const pref = await db.preferences.get(key);
  return pref?.value;
};

export const savePlaylist = async (playlist) => {
  await db.playlists.put(playlist);
};

export const getPlaylists = async () => {
  return await db.playlists.toArray();
};

export const deletePlaylist = async (id) => {
  await db.playlists.delete(id);
};

// Migrate file paths after folder reorganisation
export const migrateFilePaths = async (transformFn) => {
  const files = await db.audioFiles.toArray();
  let migratedCount = 0;
  for (const file of files) {
    const newPath = transformFn(file.location);
    if (newPath !== file.location) {
      await db.audioFiles.update(file.id, { location: newPath });
      migratedCount++;
    }
  }
  if (migratedCount > 0) {
    console.log(`Migrated ${migratedCount} file paths`);
  }
  return migratedCount;
};

// Cleanup functions for waveform cache
export const cleanupWaveformCache = async () => {
  try {
    // Get all audio file IDs currently in the library
    const audioFiles = await db.audioFiles.toArray();
    const activeFileIds = new Set(audioFiles.map(f => f.id));

    // Get all cached waveforms
    const cachedWaveforms = await db.waveformCache.toArray();

    let orphanedCount = 0;

    // Delete only orphaned waveforms (files no longer in library)
    for (const waveform of cachedWaveforms) {
      if (!activeFileIds.has(waveform.fileId)) {
        // Orphaned waveform - file no longer exists in library
        await db.waveformCache.delete(waveform.fileId);
        orphanedCount++;
      }
    }

    if (orphanedCount > 0) {
      console.log(`Cleaned up ${orphanedCount} orphaned waveforms from cache`);
    }

    return { orphanedCount };
  } catch (error) {
    console.error('Error cleaning waveform cache:', error);
    return { orphanedCount: 0 };
  }
};
