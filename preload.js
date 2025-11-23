// preload.js
// Expose Electron APIs to renderer process

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // File dialogs
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    selectFile: (options) => ipcRenderer.invoke('select-file', options),
    saveFile: (options) => ipcRenderer.invoke('save-file', options),
    
    // File operations
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
    fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
    getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
    
    // Package preparation (will be implemented)
    generateManifest: (options) => ipcRenderer.invoke('generate-manifest', options),
    
    // Upload management (will be implemented)
    detectDelta: (oldManifestPath, newManifestPath) => ipcRenderer.invoke('detect-delta', oldManifestPath, newManifestPath),
    uploadToR2: (options) => ipcRenderer.invoke('upload-to-r2', options),
    testR2Connection: (config) => ipcRenderer.invoke('test-r2-connection', config),
    pauseUpload: () => ipcRenderer.invoke('pause-upload'),
    resumeUpload: () => ipcRenderer.invoke('resume-upload'),
    
    // Progress events
    onProgress: (callback) => {
        ipcRenderer.on('progress-update', (event, data) => callback(data));
    },
    removeProgressListener: () => {
        ipcRenderer.removeAllListeners('progress-update');
    },
    
    // Configuration management
    getConfig: () => ipcRenderer.invoke('get-config'),
    setBuild: (build) => ipcRenderer.invoke('set-build', build),
    getR2Config: (build) => ipcRenderer.invoke('get-r2-config', build),
    setR2Config: (build, config) => ipcRenderer.invoke('set-r2-config', build, config)
});

