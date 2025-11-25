// main.js
// Electron main process for RolePlayAI Uploader

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const fs = require('fs').promises;
const { generateManifest } = require('./src/packagePrep');
const { detectDelta } = require('./src/deltaDetector');
const { UploadManager } = require('./src/uploadManager');
const { R2Uploader } = require('./src/r2Uploader');

let mainWindow;
let loginWindow;
let currentUploadManager = null; // Store current upload manager for pause/resume
let updateDownloaded = false; // Track if update was successfully downloaded

// Login credentials
const ADMIN_USERNAME = 'Admin';
const ADMIN_PASSWORD = 'Mostafa';

function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 480,
        height: 520,
        resizable: false,
        frame: true,
        autoHideMenuBar: true,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets', 'icon-white_s.ico'),
        show: false
    });

    loginWindow.loadFile('login.html');

    loginWindow.once('ready-to-show', () => {
        loginWindow.show();
    });

    loginWindow.on('closed', () => {
        loginWindow = null;
        // If login window is closed without successful login, quit the app
        if (!mainWindow) {
            app.quit();
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        icon: path.join(__dirname, 'assets', 'icon-white_s.ico'),
        show: false
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Close login window if it's still open
        if (loginWindow) {
            loginWindow.close();
        }
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Configure auto-updater
autoUpdater.logger = log;
log.transports.file.level = "info";

app.whenReady().then(() => {
    // Show login window first
    createLoginWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            // If no windows, show login again
            if (!mainWindow) {
                createLoginWindow();
            } else {
                createWindow();
            }
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Login handler
ipcMain.handle('login', async (event, credentials) => {
    const { username, password } = credentials;
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        // Login successful - create main window
        createWindow();
        
        // Check for updates after main window is ready
        setTimeout(() => {
            if (mainWindow) {
                autoUpdater.checkForUpdates();
            }
        }, 1000);
        
        return { success: true };
    } else {
        return { success: false, error: 'Invalid username or password' };
    }
});

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
    log.info('Checking for update...');
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { status: 'checking' });
    }
});

autoUpdater.on('update-available', (info) => {
    console.log('Update available.');
    log.info('Update available:', info);
    updateDownloaded = false; // Reset flag when new update is available
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { status: 'update-available', info });
    }
});

autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available.');
    log.info('Update not available. Current version is up to date.');
    updateDownloaded = false; // Reset flag
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { status: 'update-not-available' });
    }
});

autoUpdater.on('error', (err) => {
    console.log('Error in auto-updater. ' + err);
    log.error('Auto-updater error:', err);
    
    // Don't show error if update was already successfully downloaded
    if (!updateDownloaded && mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'error', 
            error: err.message || 'Unknown error occurred during update check'
        });
    } else if (updateDownloaded) {
        log.info('Error occurred after update was downloaded (likely during installation):', err.message);
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    console.log(log_message);
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'download-progress', 
            progress: {
                percent: progressObj.percent,
                transferred: progressObj.transferred,
                total: progressObj.total,
                bytesPerSecond: progressObj.bytesPerSecond
            }
        });
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded');
    log.info('Update downloaded successfully:', info);
    updateDownloaded = true; // Mark that update was successfully downloaded
    
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { status: 'update-downloaded', info });
        
        // Show dialog with error handling
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded',
            detail: 'A new version has been downloaded. The application will restart to apply the update.',
            buttons: ['Restart Now', 'Later']
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall();
            }
        }).catch((error) => {
            log.error('Error showing update dialog:', error);
        });
    }
});

// IPC handler for manual update check
ipcMain.handle('check-for-updates', async () => {
    try {
        await autoUpdater.checkForUpdates();
        return { success: true };
    } catch (error) {
        log.error('Error checking for updates:', error);
        return { success: false, error: error.message };
    }
});

// IPC handler for restart and install update
ipcMain.handle('restart-and-install', async () => {
    try {
        autoUpdater.quitAndInstall();
        return { success: true };
    } catch (error) {
        log.error('Error restarting and installing update:', error);
        return { success: false, error: error.message };
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

// Verify upload
ipcMain.handle('verify-upload', async (event, options) => {
    try {
        const { manifestPath, config } = options;
        const { R2Uploader } = require('./src/r2Uploader');
        const { parseManifest } = require('./src/manifestUtils');
        
        // Read manifest with lenient validation (URLs not required for local manifests)
        // URLs are added during upload, so local manifests don't have them yet
        const manifestData = await fs.readFile(manifestPath, 'utf-8');
        const parsed = parseManifest(manifestData, false); // false = don't require URLs for local manifests
        const manifest = parsed.manifest;
        const buildType = manifest.buildType || 'production';
        
        // Send progress updates to renderer
        const sendProgress = (data) => {
            mainWindow.webContents.send('progress-update', data);
        };
        
        // Create uploader and verify
        const uploader = new R2Uploader(config);
        const result = await uploader.verifyManifest(manifest, buildType, sendProgress);
        
        return { success: true, ...result };
    } catch (error) {
        console.error('Error verifying upload:', error);
        return { success: false, error: error.message };
    }
});

// List available versions from R2
ipcMain.handle('list-versions', async (event, options) => {
    try {
        const { config, buildType = 'production' } = options;
        const { R2Uploader } = require('./src/r2Uploader');
        
        const uploader = new R2Uploader(config);
        const result = await uploader.listVersions(buildType);
        
        return { 
            success: true, 
            versions: result.versions,
            currentVersion: result.currentVersion
        };
    } catch (error) {
        console.error('Error listing versions:', error);
        return { success: false, error: error.message };
    }
});

// Promote a version as the current/latest version
ipcMain.handle('promote-version', async (event, options) => {
    try {
        const { config, version, buildType = 'production', localManifestPath = null } = options;
        const { R2Uploader } = require('./src/r2Uploader');
        
        const sendProgress = (data) => {
            mainWindow.webContents.send('progress-update', data);
        };
        
        let localManifest = null;
        
        // If local manifest path is provided, read it
        if (localManifestPath) {
            try {
                const manifestData = await fs.readFile(localManifestPath, 'utf-8');
                localManifest = JSON.parse(manifestData);
            } catch (error) {
                throw new Error(`Failed to read local manifest: ${error.message}`);
            }
        }
        
        const uploader = new R2Uploader(config);
        const result = await uploader.promoteVersion(version, buildType, sendProgress, localManifest);
        
        return { success: true, ...result };
    } catch (error) {
        console.error('Error promoting version:', error);
        return { success: false, error: error.message };
    }
});

