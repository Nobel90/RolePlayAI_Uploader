// main.js
// Electron main process for RolePlayAI Uploader

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { generateManifest } = require('./src/packagePrep');
const { detectDelta } = require('./src/deltaDetector');
const { UploadManager } = require('./src/uploadManager');
const { R2Uploader } = require('./src/r2Uploader');

let mainWindow;
let currentUploadManager = null; // Store current upload manager for pause/resume

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile('index.html');

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('select-file', async (event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: options.filters || [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('save-file', async (event, options = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        filters: options.filters || [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        defaultPath: options.defaultPath
    });
    
    if (!result.canceled && result.filePath) {
        return result.filePath;
    }
    return null;
});

// File operations
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('write-file', async (event, filePath, data) => {
    try {
        await fs.writeFile(filePath, data, 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('file-exists', async (event, filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
});

ipcMain.handle('get-file-stats', async (event, filePath) => {
    try {
        const stats = await fs.stat(filePath);
        return {
            exists: true,
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile()
        };
    } catch {
        return { exists: false };
    }
});

// Package preparation
ipcMain.handle('generate-manifest', async (event, options) => {
    try {
        // Send progress updates to renderer
        const sendProgress = (data) => {
            mainWindow.webContents.send('progress-update', data);
        };
        
        const result = await generateManifest(options, sendProgress);
        return { success: true, ...result };
    } catch (error) {
        console.error('Error generating manifest:', error);
        return { success: false, error: error.message };
    }
});

// Delta detection
ipcMain.handle('detect-delta', async (event, oldManifestPath, newManifestPath) => {
    try {
        const oldManifestData = await fs.readFile(oldManifestPath, 'utf-8');
        const newManifestData = await fs.readFile(newManifestPath, 'utf-8');
        
        const delta = detectDelta(oldManifestData, newManifestData);
        return { success: true, delta };
    } catch (error) {
        console.error('Error detecting delta:', error);
        return { success: false, error: error.message };
    }
});

// R2 connection test
ipcMain.handle('test-r2-connection', async (event, config) => {
    try {
        const uploader = new R2Uploader(config);
        const result = await uploader.testConnection();
        return result;
    } catch (error) {
        console.error('Error testing R2 connection:', error);
        return { success: false, error: error.message };
    }
});

// Upload to R2
ipcMain.handle('upload-to-r2', async (event, options) => {
    try {
        const { config, ...uploadOptions } = options;
        currentUploadManager = new UploadManager(config);
        
        // Send progress updates to renderer
        const sendProgress = (data) => {
            mainWindow.webContents.send('progress-update', data);
        };
        
        // buildType is already in uploadOptions from renderer
        const result = await currentUploadManager.upload(uploadOptions, sendProgress);
        currentUploadManager = null; // Clear reference when done
        return { success: true, ...result };
    } catch (error) {
        console.error('Error uploading to R2:', error);
        currentUploadManager = null; // Clear reference on error
        return { success: false, error: error.message };
    }
});

// Pause upload
ipcMain.handle('pause-upload', async () => {
    try {
        if (currentUploadManager) {
            currentUploadManager.pause();
            return { success: true, message: 'Upload paused' };
        }
        return { success: false, message: 'No active upload to pause' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Resume upload
ipcMain.handle('resume-upload', async () => {
    try {
        if (currentUploadManager) {
            currentUploadManager.resume();
            return { success: true, message: 'Upload resumed' };
        }
        return { success: false, message: 'No active upload to resume' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

