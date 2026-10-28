const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, clipboard, ClipboardItem } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs').promises;
const fsSync = require('fs');

// Store for window bounds
let windowBounds = null;
let boundsSaveTimer = null;

function getBoundsPath() {
  return path.join(app.getPath('userData'), 'window-bounds.json');
}

function writeBoundsSync() {
  if (!windowBounds) return;
  try {
    fsSync.writeFileSync(getBoundsPath(), JSON.stringify(windowBounds));
  } catch (error) {
    console.error('Error saving window bounds:', error);
  }
}

// Folder the Add dialog last opened in. Since Electron 43 dialogs default to
// Downloads instead of remembering the last location, so track it ourselves.
let lastDialogDir = null;

function getDialogStatePath() {
  return path.join(app.getPath('userData'), 'dialog-state.json');
}

function rememberDialogDir(filePaths) {
  if (filePaths.length === 0) return;
  lastDialogDir = path.dirname(filePaths[0]);
  fs.writeFile(getDialogStatePath(), JSON.stringify({ lastDialogDir })).catch(() => {});
}

let mainWindow;

// Matches the body background in App.css, so the window never flashes the
// wrong colour while loading or resizing.
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f5';

nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground());
});

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
    // Content runs under the title bar; the traffic lights are centred in the
    // app's 52px unified toolbar (see .titlebar-row in App.css).
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 19 },
    backgroundColor: windowBackground(),
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

  // Track bounds on resize/move; debounce-flush to disk so an abrupt exit
  // (crash, force-quit) still leaves a recent snapshot behind.
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    windowBounds = mainWindow.getBounds();
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(writeBoundsSync, 400);
  };

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      windowBounds = mainWindow.getBounds();
    }
    writeBoundsSync();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Load saved window bounds
  try {
    const boundsData = await fs.readFile(getBoundsPath(), 'utf8');
    windowBounds = JSON.parse(boundsData);
  } catch (error) {
    // No saved bounds, use defaults
  }
  try {
    ({ lastDialogDir } = JSON.parse(await fs.readFile(getDialogStatePath(), 'utf8')));
  } catch (error) {
    // Never opened the Add dialog yet
  }

  createWindow();
});

// Synchronous final flush — `before-quit` fires for Cmd+Q on macOS where
// `window-all-closed` doesn't, and runs before windows are torn down.
app.on('before-quit', writeBoundsSync);

app.on('window-all-closed', () => {
  writeBoundsSync();
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
    defaultPath: lastDialogDir || undefined,
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aiff', 'flac', 'm4a', 'aac', 'ogg'] }
    ]
  });

  if (result.canceled) {
    return { files: [], folders: [] };
  }
  rememberDialogDir(result.filePaths);

  const files = [];
  const folders = [];

  for (const filePath of result.filePaths) {
    if (fsSync.statSync(filePath).isDirectory()) {
      folders.push(filePath);
    } else {
      files.push(filePath);
    }
  }

  return { files, folders };
});

ipcMain.handle('dialog:locateFile', async (event, { fileName, originalPath }) => {
  const options = {
    title: fileName ? `Locate "${fileName}"` : 'Locate File',
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aiff', 'flac', 'm4a', 'aac', 'ogg'] }
    ]
  };
  if (originalPath) {
    options.defaultPath = path.dirname(originalPath);
  }
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result.filePaths[0] || null;
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

ipcMain.handle('shell:showInFolder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Persistent on-disk cache for transcoded playback files (e.g. >48 kHz WAVs
// downsampled to 48 kHz so Chromium's <audio> element can stream them). Lives
// under userData so it survives restarts and is created on first use.
ipcMain.handle('playback:getCacheDir', async () => {
  const dir = path.join(app.getPath('userData'), 'playback-cache');
  await fs.mkdir(dir, { recursive: true });
  return dir;
});

ipcMain.handle('show-context-menu', async (event, { isMissing }) => {
  return new Promise((resolve) => {
    const template = [
      {
        label: 'Play',
        click: () => resolve('play'),
        enabled: !isMissing
      },
      {
        label: 'Add to Playlist',
        click: () => resolve('add-to-playlist')
      },
      {
        label: 'Show in Finder',
        click: () => resolve('show-in-finder'),
        enabled: !isMissing
      },
      { type: 'separator' },
      {
        label: 'Locate…',
        click: () => resolve('locate')
      },
      {
        label: 'Delete from Archive',
        click: () => resolve('delete')
      }
    ];
    const menu = Menu.buildFromTemplate(template);

    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => resolve(null)
    });
  });
});

// Put real file references on the clipboard (NSFilenamesPboardType on macOS,
// CF_HDROP on Windows) so they paste into DAWs like Ableton as files.
ipcMain.handle('clipboard:copyFiles', async (event, filePaths) => {
  try {
    const uriList = filePaths.map(p => pathToFileURL(p).href).join('\r\n');
    await clipboard.write([new ClipboardItem({ 'text/uri-list': uriList })]);
    return { success: true };
  } catch (error) {
    console.error('Error copying files to clipboard:', error);
    return { success: false, error: error.message };
  }
});
