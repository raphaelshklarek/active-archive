const { app, BrowserWindow, ipcMain, dialog, shell, Menu, systemPreferences, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// Store for window bounds
let windowBounds = null;

// Disable security features causing macOS crashes
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');

// Get MIME type based on file extension
function getMimeType(filePath) {
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
}

// Check if file is AIFF
function isAiffFile(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext === 'aiff' || ext === 'aif';
}

// Convert AIFF to WAV for browser compatibility
function convertAiffToWav(aiffBuffer) {
  const dataView = new DataView(aiffBuffer);

  // Check if this is actually an AIFF file
  const formId = String.fromCharCode(
    dataView.getUint8(0),
    dataView.getUint8(1),
    dataView.getUint8(2),
    dataView.getUint8(3)
  );

  if (formId !== 'FORM') {
    throw new Error('Not a valid AIFF file');
  }

  // Parse AIFF chunks
  let numChannels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let audioDataOffset = 0;
  let audioDataSize = 0;

  let offset = 12;

  while (offset < dataView.byteLength) {
    const chunkId = String.fromCharCode(
      dataView.getUint8(offset),
      dataView.getUint8(offset + 1),
      dataView.getUint8(offset + 2),
      dataView.getUint8(offset + 3)
    );

    const chunkSize = dataView.getUint32(offset + 4, false);

    if (chunkId === 'COMM') {
      numChannels = dataView.getUint16(offset + 8, false);
      bitsPerSample = dataView.getUint16(offset + 14, false);
      sampleRate = readExtended(dataView, offset + 16);
    } else if (chunkId === 'SSND') {
      const ssndOffset = dataView.getUint32(offset + 8, false);
      audioDataOffset = offset + 16 + ssndOffset;
      audioDataSize = chunkSize - 8 - ssndOffset;
      break;
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset += 1;
  }

  if (!audioDataSize) {
    throw new Error('No audio data found in AIFF file');
  }

  // Extract and convert audio data from big-endian to little-endian
  const pcmData = new Uint8Array(audioDataSize);
  for (let i = 0; i < audioDataSize; i += 2) {
    if (bitsPerSample === 16) {
      pcmData[i] = dataView.getUint8(audioDataOffset + i + 1);
      pcmData[i + 1] = dataView.getUint8(audioDataOffset + i);
    } else {
      pcmData[i] = dataView.getUint8(audioDataOffset + i);
    }
  }

  // Create WAV buffer
  return createWavBuffer(pcmData, numChannels, sampleRate, bitsPerSample);
}

function readExtended(dataView, offset) {
  const exponent = ((dataView.getUint8(offset) & 0x7F) << 8) | dataView.getUint8(offset + 1);
  const mantissa = dataView.getUint32(offset + 2, false);

  if (exponent === 0 && mantissa === 0) {
    return 0;
  }

  const f = mantissa / Math.pow(2, 31);
  return f * Math.pow(2, exponent - 16383);
}

function createWavBuffer(pcmData, numChannels, sampleRate, bitsPerSample) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // RIFF chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
  const uint8View = new Uint8Array(buffer);
  uint8View.set(pcmData, 44);

  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

let mainWindow;

function createWindow() {
  // Use saved bounds or defaults
  const bounds = windowBounds || {
    width: 1200,
    height: 800,
    x: undefined,
    y: undefined
  };

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f5f5',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });

  // Load from Vite dev server in development
  const isDev = !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Save window bounds when resized or moved
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      windowBounds = mainWindow.getBounds();
    }
  };

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Load saved window bounds
  try {
    const userDataPath = app.getPath('userData');
    const boundsPath = path.join(userDataPath, 'window-bounds.json');
    const boundsData = await fs.readFile(boundsPath, 'utf8');
    windowBounds = JSON.parse(boundsData);
  } catch (error) {
    // No saved bounds, use defaults
  }

  createWindow();
});

app.on('window-all-closed', async () => {
  // Save window bounds before quitting
  if (windowBounds) {
    try {
      const userDataPath = app.getPath('userData');
      const boundsPath = path.join(userDataPath, 'window-bounds.json');
      await fs.writeFile(boundsPath, JSON.stringify(windowBounds));
    } catch (error) {
      console.error('Error saving window bounds:', error);
    }
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('dialog:openFilesOrFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aiff', 'flac', 'm4a', 'aac', 'ogg'] }
    ]
  });
  
  if (result.canceled) {
    return { files: [], folders: [] };
  }
  
  const fs = require('fs');
  const files = [];
  const folders = [];
  
  for (const path of result.filePaths) {
    const stats = fs.statSync(path);
    if (stats.isDirectory()) {
      folders.push(path);
    } else {
      files.push(path);
    }
  }
  
  return { files, folders };
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aiff', 'flac', 'm4a', 'aac', 'ogg'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths;
});

ipcMain.handle('fs:readDir', async (event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory()
    }));
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
});

ipcMain.handle('fs:stat', async (event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime,
      birthtime: stats.birthtime
    };
  } catch (error) {
    console.error('Error getting file stats:', error);
    return null;
  }
});

// New IPC handler to read file as buffer for analysis
ipcMain.handle('audio:readFileForAnalysis', async (event, filePath) => {
  try {
    const fsSync = require('fs');
    const fileBuffer = fsSync.readFileSync(filePath);

    let resultBuffer;
    let mimeType;

    if (isAiffFile(filePath)) {
      // Convert AIFF to WAV — slice to handle pooled Node.js Buffers
      const fileArrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      );
      const wavBuffer = convertAiffToWav(fileArrayBuffer);
      resultBuffer = Buffer.from(wavBuffer);
      mimeType = 'audio/wav';
    } else {
      resultBuffer = fileBuffer;
      mimeType = getMimeType(filePath);
    }

    // Return buffer and mime type
    return { buffer: resultBuffer, mimeType };
  } catch (error) {
    console.error('Error reading file for analysis:', error);
    return null;
  }
});

ipcMain.handle('shell:showInFolder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('show-context-menu', async (event, { fileId, fileName, filePath }) => {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Play',
        click: () => resolve('play')
      },
      {
        label: 'Add to Playlist',
        click: () => resolve('add-to-playlist')
      },
      {
        label: 'Show in Finder',
        click: () => resolve('show-in-finder')
      },
      { type: 'separator' },
      {
        label: 'Delete from Archive',
        click: () => resolve('delete')
      }
    ]);
    
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => resolve(null)
    });
  });
});

ipcMain.handle('get-accent-color', async () => {
  if (process.platform === 'darwin') {
    try {
      // Get the accent color as a hex string
      const accentColor = systemPreferences.getAccentColor();
      // Graphite is typically represented as a gray color (e.g., "8e8e93" or similar)
      // Check if it's grayscale by seeing if R, G, B are similar
      const r = parseInt(accentColor.substr(0, 2), 16);
      const g = parseInt(accentColor.substr(2, 2), 16);
      const b = parseInt(accentColor.substr(4, 2), 16);

      // If the color is grayscale (R, G, B are within 10 of each other), it's likely graphite
      const isGraphite = Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10;

      return { color: accentColor, isGraphite };
    } catch (error) {
      console.error('Error getting accent color:', error);
      return { color: null, isGraphite: false };
    }
  }
  return { color: null, isGraphite: false };
});

ipcMain.handle('clipboard:copyFiles', async (event, filePaths) => {
  try {
    // Copy file paths to clipboard so they can be pasted into DAWs like Ableton
    if (process.platform === 'darwin') {
      // macOS: Create a plist format for NSFilenamesPboardType
      const plistHeader = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<array>\n';
      const plistFooter = '</array>\n</plist>';
      const plistItems = filePaths.map(p => `  <string>${p}</string>`).join('\n');
      const plist = plistHeader + plistItems + '\n' + plistFooter;

      clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'));
    } else {
      // Fallback for other platforms
      clipboard.writeText(filePaths.join('\n'));
    }
    return { success: true };
  } catch (error) {
    console.error('Error copying files to clipboard:', error);
    return { success: false, error: error.message };
  }
});