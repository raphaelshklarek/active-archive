// The app only runs inside Electron (nodeIntegration on), so Node modules are
// always available in the renderer.
const { ipcRenderer } = window.require('electron');

export { ipcRenderer };
export const fs = window.require('fs');
export const path = window.require('path');
