// main.js
// Electron main process for RolePlayAI Uploader

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn } = require('child_process');
const { generateManifest } = require('./src/packagePrep');
const { detectDelta } = require('./src/deltaDetector');
const { UploadManager } = require('./src/uploadManager');
const { R2Uploader } = require('./src/r2Uploader');

let mainWindow;
let loginWindow;
let currentUploadManager = null; // Store current upload manager for pause/resume
let updateDownloaded = false; // Track if update was successfully downloaded
let downloadedUpdatePath = null; // Store path to downloaded portable exe
let pendingUpdateUrl = null; // Store direct download URL from GitHub
let pendingUpdateVersion = null; // Store pending update version

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

// Configure auto-updater for GitHub releases ONLY (no YML files)
// electron-updater is configured to use GitHub API directly, not local YML files
try {
    // Configure auto-updater settings
    // DISABLE auto-download - we'll download manually using direct GitHub URL
    // This bypasses electron-updater's broken download mechanism that reads latest.yml
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    
    const mode = app.isPackaged ? 'packaged' : 'development';
    
    // GitHub feed configuration - ALWAYS set this (both dev and production)
    // This ensures electron-updater uses GitHub API directly, not local YML files
    const feedConfig = {
        provider: 'github',
        owner: 'Nobel90',
        repo: 'RolePlayAI_Uploader',
        private: false
    };
    
    // ALWAYS set feed URL explicitly - works for both dev and production
    // This is critical for portable builds which don't have embedded app-update.yml
    autoUpdater.setFeedURL(feedConfig);
    
    // In development mode, force dev update config to enable update checks
    if (!app.isPackaged) {
        autoUpdater.forceDevUpdateConfig = true;
        
        // Create a minimal dev-app-update.yml file to prevent write errors during download
        const devUpdateYmlPath = path.join(__dirname, 'dev-app-update.yml');
        try {
            if (!fsSync.existsSync(devUpdateYmlPath)) {
                const packageJson = require('./package.json');
                const minimalYml = `version: ${packageJson.version}
path: placeholder
sha512: placeholder
releaseDate: '${new Date().toISOString()}'
`;
                fsSync.writeFileSync(devUpdateYmlPath, minimalYml, 'utf-8');
                log.info('Created minimal dev-app-update.yml to prevent write errors');
            }
        } catch (error) {
            log.warn('Could not create dev-app-update.yml (non-critical):', error.message);
        }
        
        console.log('[Auto-Updater] Development mode: forceDevUpdateConfig = true');
    }
    
    log.info(`Auto-updater configured for ${mode} mode`);
    log.info(`Repository: ${feedConfig.owner}/${feedConfig.repo}`);
    console.log(`[Auto-Updater] Running in ${mode} mode - feed URL configured for GitHub`);
    
} catch (error) {
    log.error('Error configuring auto-updater:', error);
    console.error('[Auto-Updater] Configuration error:', error);
}

// Global unhandled rejection handler to catch YML file errors
// electron-updater may try to write dev-app-update.yml during download, causing unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    // Ignore YML file errors - we're using GitHub API only
    if (reason && reason.message && 
        (reason.message.includes('dev-app-update.yml') || reason.message.includes('app-update.yml')) &&
        reason.message.includes('ENOENT')) {
        log.info('Caught unhandled rejection for YML file (expected when using GitHub API only):', reason.message);
        console.log('[Auto-Updater] Ignoring unhandled YML file rejection - using GitHub API only');
        // Don't log as error - this is expected
        return;
    }
    // Log other unhandled rejections
    log.error('Unhandled promise rejection:', reason);
    console.error('Unhandled promise rejection:', reason);
});

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

// Helper function to send log message to renderer
function sendUpdateLog(message, status = 'info') {
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: status,
            logMessage: message 
        });
    }
    console.log(`[Update Log] ${message}`);
    log.info(`[Update Log] ${message}`);
}

// Login handler
ipcMain.handle('login', async (event, credentials) => {
    const { username, password } = credentials;
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        // Login successful - create main window
        createWindow();
        
        // Check for updates after main window is ready (works in both dev and packaged modes)
        setTimeout(() => {
            if (mainWindow) {
                const mode = app.isPackaged ? 'packaged' : 'development';
                const message = `Automatic update check initiated in ${mode} mode...`;
                console.log(`[Auto-Updater] ${message}`);
                log.info(`Checking for updates in ${mode} mode`);
                sendUpdateLog(message, 'info');
                // Handle promise to prevent unhandled rejections
                autoUpdater.checkForUpdates().catch((error) => {
                    // Ignore YML file errors - we're using GitHub API only
                    if (error.message && error.message.includes('dev-app-update.yml') && error.message.includes('ENOENT')) {
                        log.info('Ignoring dev-app-update.yml error - using GitHub API only');
                        // Don't log as error, just info
                        return;
                    }
                    // Errors are already handled by the error event listener
                    // This just prevents unhandled promise rejection warnings
                    log.debug('Update check promise rejected (handled by error listener):', error.message);
                });
            }
        }, 1000);
        
        return { success: true };
    } else {
        return { success: false, error: 'Invalid username or password' };
    }
});

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
    const mode = app.isPackaged ? 'packaged' : 'development';
    const message = `[EVENT] checking-for-update fired in ${mode} mode`;
    console.log(`[Auto-Updater] ${message}`);
    log.info(`[EVENT] checking-for-update fired in ${mode} mode`);
    sendUpdateLog(message, 'checking');
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'checking',
            logMessage: message 
        });
    }
});

autoUpdater.on('update-available', (info) => {
    const version = info?.version || 'unknown';
    const message = `[EVENT] update-available fired: v${version}`;
    console.log('[Auto-Updater] [EVENT] update-available fired:', info);
    log.info('[EVENT] update-available fired:', JSON.stringify(info, null, 2));
    
    // Store the direct download URL from GitHub API - this is the correct URL
    // We'll use this for manual download, bypassing electron-updater's broken download mechanism
    if (info.files && info.files.length > 0) {
        pendingUpdateUrl = info.files[0].url;
        pendingUpdateVersion = version;
        console.log(`[Auto-Updater] Stored direct download URL: ${pendingUpdateUrl}`);
        log.info(`Stored direct download URL: ${pendingUpdateUrl}`);
        sendUpdateLog(`Download URL: ${pendingUpdateUrl}`, 'info');
    }
    
    sendUpdateLog(message, 'update-available');
    updateDownloaded = false; // Reset flag when new update is available
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'update-available', 
            info,
            logMessage: message 
        });
    }
});

autoUpdater.on('update-not-available', (info) => {
    const message = '[EVENT] update-not-available fired - Current version is up to date.';
    console.log('[Auto-Updater] [EVENT] update-not-available fired');
    log.info('[EVENT] update-not-available fired:', JSON.stringify(info || {}, null, 2));
    sendUpdateLog(message, 'update-not-available');
    if (info) {
        sendUpdateLog(`Info: ${JSON.stringify(info, null, 2)}`, 'info');
    }
    updateDownloaded = false; // Reset flag
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'update-not-available',
            logMessage: message 
        });
    }
});

autoUpdater.on('error', (err) => {
    const mode = app.isPackaged ? 'packaged' : 'development';
    const errorMessage = err.message || 'Unknown error occurred during update check';
    console.error(`[Auto-Updater] [EVENT] error fired in ${mode} mode:`, err);
    console.error(`[Auto-Updater] Error stack:`, err.stack);
    log.error('[EVENT] Auto-updater error fired:', err);
    log.error('Error stack:', err.stack);
    
    // Ignore ENOENT errors for YML files - electron-updater tries to read local files first
    // but we're using GitHub API only, so these errors are expected and can be ignored
    if (err.message && err.message.includes('ENOENT') && 
        (err.message.includes('app-update.yml') || err.message.includes('dev-app-update.yml'))) {
        const message = '[EVENT] Ignoring YML file error - using GitHub API only';
        log.info(message);
        console.log('[Auto-Updater] Ignoring YML file error - using GitHub API only');
        sendUpdateLog(message, 'info');
        return; // Don't show this error to the user
    }
    
    // Don't show error if update was already successfully downloaded
    if (!updateDownloaded && mainWindow) {
        // Provide user-friendly error messages for common issues
        let userFriendlyMessage = errorMessage;
        
        if (err.statusCode === 404) {
            if (errorMessage.includes('releases.atom')) {
                userFriendlyMessage = 'Repository not found or has no releases. Please verify:\n' +
                    '1. Repository exists: https://github.com/Nobel90/RolePlayAI_Uploader\n' +
                    '2. Repository is public\n' +
                    '3. At least one release is published\n' +
                    '4. GH_TOKEN is set (if repository is private)';
            } else if (errorMessage.includes('releases/download') && errorMessage.includes('https://github.com')) {
                // This indicates a malformed URL - likely caused by latest.yml having a relative URL
                userFriendlyMessage = 'Download URL error: The latest.yml file on GitHub has an incorrect URL format.\n' +
                    'This version needs to be rebuilt to fix the latest.yml file.\n' +
                    'The update check found the version, but the download URL is malformed.';
                log.error('Malformed download URL detected - likely caused by latest.yml with relative URL:', errorMessage);
                console.error('[Auto-Updater] Malformed URL - latest.yml on GitHub likely has relative URL instead of absolute');
            } else {
                userFriendlyMessage = 'Repository not found (404). Check repository name and access.';
            }
        } else if (err.statusCode === 401 || err.statusCode === 403) {
            userFriendlyMessage = 'Authentication failed. Please check GH_TOKEN environment variable.';
        }
        
        sendUpdateLog(`[EVENT] error fired: ${errorMessage}`, 'error');
        sendUpdateLog(`User-friendly message: ${userFriendlyMessage}`, 'error');
        sendUpdateLog(`Error details: ${err.stack || 'No stack trace'}`, 'error');
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'error', 
            error: userFriendlyMessage,
            logMessage: `[EVENT] error fired: ${errorMessage}`
        });
    } else if (updateDownloaded) {
        const message = `Error occurred after update was downloaded: ${err.message}`;
        log.info(message);
        sendUpdateLog(message, 'warning');
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent || 0);
    const mbTransferred = (progressObj.transferred / (1024 * 1024)).toFixed(1);
    const mbTotal = (progressObj.total / (1024 * 1024)).toFixed(1);
    const log_message = `Downloading: ${percent}% (${mbTransferred}MB / ${mbTotal}MB) - Speed: ${(progressObj.bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
    console.log(log_message);
    log.info(log_message);
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'download-progress', 
            progress: {
                percent: progressObj.percent,
                transferred: progressObj.transferred,
                total: progressObj.total,
                bytesPerSecond: progressObj.bytesPerSecond
            },
            logMessage: log_message
        });
    }
});

autoUpdater.on('update-downloaded', (info) => {
    const message = 'Update downloaded successfully! Ready to install.';
    console.log('Update downloaded');
    log.info('Update downloaded successfully:', info);
    sendUpdateLog(message, 'update-downloaded');
    updateDownloaded = true; // Mark that update was successfully downloaded
    
    // For portable executables, get the downloaded file path
    // electron-updater stores it in the cache directory
    try {
        // Get the downloaded file path from electron-updater
        // For portable builds, the file is in the cache directory
        const os = require('os');
        const cacheDir = path.join(os.tmpdir(), 'electron-updater');
        
        if (fsSync.existsSync(cacheDir)) {
            const files = fsSync.readdirSync(cacheDir);
            const portableFile = files.find(f => f.endsWith('.exe') && f.includes('portable'));
            
            if (portableFile) {
                downloadedUpdatePath = path.join(cacheDir, portableFile);
                log.info('Downloaded portable exe path:', downloadedUpdatePath);
                sendUpdateLog(`Downloaded file found: ${portableFile}`, 'info');
            }
        }
        
        // Try alternative method - check if autoUpdater has the path
        if (!downloadedUpdatePath && autoUpdater.downloadedUpdateHelper) {
            try {
                downloadedUpdatePath = autoUpdater.downloadedUpdateHelper.getDownloadedFile();
                if (downloadedUpdatePath) {
                    log.info('Downloaded file path from helper:', downloadedUpdatePath);
                }
            } catch (e) {
                // Helper method might not be available
            }
        }
        
        // If still not found, try to get from info object
        if (!downloadedUpdatePath && info && info.path) {
            downloadedUpdatePath = info.path;
            log.info('Downloaded file path from info:', downloadedUpdatePath);
        }
    } catch (error) {
        log.error('Error finding downloaded file path:', error);
        sendUpdateLog(`Warning: Could not locate downloaded file automatically: ${error.message}`, 'warning');
    }
    
    if (mainWindow) {
        mainWindow.webContents.send('auto-updater-status', { 
            status: 'update-downloaded', 
            info,
            logMessage: message 
        });
        
        // Show dialog with error handling
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded',
            detail: 'A new version has been downloaded. Click "Download & Install" to update.',
            buttons: ['OK']
        }).catch((error) => {
            log.error('Error showing update dialog:', error);
            sendUpdateLog(`Error showing update dialog: ${error.message}`, 'error');
        });
    }
});

// IPC handler for manual update check
ipcMain.handle('check-for-updates', async () => {
    const mode = app.isPackaged ? 'packaged' : 'development';
    const message = `Manual update check requested in ${mode} mode`;
    console.log(`[Auto-Updater] ${message}`);
    log.info(`Manual update check requested in ${mode} mode`);
    sendUpdateLog(message, 'info');
    
    try {
        sendUpdateLog('Calling autoUpdater.checkForUpdates()...', 'info');
        console.log('[Auto-Updater] About to call checkForUpdates()...');
        log.info('About to call checkForUpdates()...');
        
        // CheckForUpdates returns a Promise<UpdateCheckResult>
        // Wrap in try-catch to handle YML file errors gracefully
        let result;
        try {
            result = await autoUpdater.checkForUpdates().catch((error) => {
                // Ignore YML file errors - we're using GitHub API only
                if (error && error.message && 
                    (error.message.includes('dev-app-update.yml') || error.message.includes('app-update.yml')) &&
                    error.message.includes('ENOENT')) {
                    log.info('Ignoring YML file error in checkForUpdates - using GitHub API only');
                    sendUpdateLog('Ignoring YML file error - using GitHub API only', 'info');
                    // Return undefined - the update-available event should still fire
                    return undefined;
                }
                // Re-throw other errors
                throw error;
            });
        } catch (checkError) {
            // Ignore YML file errors - we're using GitHub API only
            if (checkError && checkError.message && 
                (checkError.message.includes('dev-app-update.yml') || checkError.message.includes('app-update.yml')) &&
                checkError.message.includes('ENOENT')) {
                log.info('Ignoring YML file error - download will continue via GitHub API');
                sendUpdateLog('Ignoring YML file error - using GitHub API only', 'info');
                // Return success - the update-available event should still fire
                return { success: true };
            }
            // Re-throw other errors
            throw checkError;
        }
        
        console.log('[Auto-Updater] checkForUpdates() returned:', result);
        log.info('checkForUpdates() returned:', JSON.stringify(result, null, 2));
        
        if (result) {
            sendUpdateLog(`Update check result received. Update info: ${JSON.stringify(result.updateInfo || 'none')}`, 'info');
            if (result.updateInfo) {
                sendUpdateLog(`Update available: v${result.updateInfo.version}`, 'success');
            } else {
                sendUpdateLog('No update info in result (may be checking...)', 'info');
            }
        } else {
            sendUpdateLog('checkForUpdates() returned null/undefined', 'warning');
        }
        
        const successMessage = 'Update check initiated successfully';
        console.log(`[Auto-Updater] ${successMessage}`);
        sendUpdateLog(successMessage, 'success');
        sendUpdateLog('Waiting for auto-updater events (checking-for-update, update-available, etc.)...', 'info');
        return { success: true };
    } catch (error) {
        log.error('Error checking for updates:', error);
        console.error('[Auto-Updater] Error during update check:', error);
        console.error('[Auto-Updater] Error stack:', error.stack);
        
        // Ignore ENOENT errors for YML files - we're using GitHub API only
        if (error.message && error.message.includes('ENOENT') && 
            (error.message.includes('app-update.yml') || error.message.includes('dev-app-update.yml'))) {
            const ignoreMessage = 'Ignoring YML file error - using GitHub API only';
            log.info('Ignoring YML file error in check-for-updates handler');
            console.log('[Auto-Updater] Ignoring YML file error - using GitHub API only');
            sendUpdateLog(ignoreMessage, 'info');
            // Return success since this is expected when using GitHub API only
            return { success: true };
        }
        
        const errorMessage = `Error during update check: ${error.message || 'Unknown error'}`;
        sendUpdateLog(errorMessage, 'error');
        sendUpdateLog(`Error details: ${error.stack || 'No stack trace'}`, 'error');
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

// IPC handler for download and install update (portable executable)
// This uses DIRECT download from GitHub API, bypassing electron-updater's broken download mechanism
ipcMain.handle('download-and-install-update', async () => {
    const https = require('https');
    const http = require('http');
    const os = require('os');
    
    try {
        sendUpdateLog('Starting direct download from GitHub...', 'info');
        
        // GitHub repository info
        const owner = 'Nobel90';
        const repo = 'RolePlayAI_Uploader';
        const ghToken = process.env.GH_TOKEN;
        
        // First, get the latest release info from GitHub API to find the actual asset URL
        sendUpdateLog('Fetching release info from GitHub API...', 'info');
        
        const releaseInfo = await new Promise((resolve, reject) => {
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
            
            // For public repos, don't use token (avoids bad credential errors)
            const headers = {
                'User-Agent': 'Role-Play-AI-Uploader',
                'Accept': 'application/vnd.github.v3+json'
            };
            
            // Only use token if explicitly needed (private repo)
            // For public repos, anonymous access works fine
            
            https.get(apiUrl, { headers }, (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`GitHub API error: ${response.statusCode} - ${data}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Failed to parse GitHub API response'));
                    }
                });
            }).on('error', reject);
        });
        
        // Find the portable exe asset
        const portableAsset = releaseInfo.assets.find(a => 
            a.name.includes('portable') && a.name.endsWith('.exe')
        );
        
        if (!portableAsset) {
            sendUpdateLog('No portable exe found in release assets', 'error');
            sendUpdateLog(`Available assets: ${releaseInfo.assets.map(a => a.name).join(', ')}`, 'info');
            return { success: false, error: 'No portable exe found in the latest release.' };
        }
        
        const downloadUrl = portableAsset.browser_download_url;
        const fileName = portableAsset.name;
        pendingUpdateVersion = releaseInfo.tag_name;
        
        sendUpdateLog(`Found: ${fileName} (${(portableAsset.size / (1024 * 1024)).toFixed(1)}MB)`, 'info');
        sendUpdateLog(`Downloading from: ${downloadUrl}`, 'info');
        log.info('Direct download URL:', downloadUrl);
        
        // Create download path
        const downloadPath = path.join(os.tmpdir(), fileName);
        sendUpdateLog(`Saving to: ${downloadPath}`, 'info');
        
        // Download the file directly using Node.js
        await new Promise((resolve, reject) => {
            const downloadFile = (url, redirectCount = 0) => {
                if (redirectCount > 10) {
                    reject(new Error('Too many redirects'));
                    return;
                }
                
                const protocol = url.startsWith('https') ? https : http;
                
                const headers = {
                    'User-Agent': 'Role-Play-AI-Uploader',
                    'Accept': 'application/octet-stream'
                };
                
                // For public repos, no auth needed for downloads
                
                const request = protocol.get(url, { headers }, (response) => {
                    // Handle redirects (GitHub often redirects to CDN)
                    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                        sendUpdateLog(`Redirecting to CDN...`, 'info');
                        downloadFile(response.headers.location, redirectCount + 1);
                        return;
                    }
                    
                    if (response.statusCode !== 200) {
                        reject(new Error(`Download failed with status ${response.statusCode}`));
                        return;
                    }
                    
                    const totalSize = parseInt(response.headers['content-length'], 10) || portableAsset.size;
                    let downloadedSize = 0;
                    let lastProgressUpdate = 0;
                    
                    const file = fsSync.createWriteStream(downloadPath);
                    
                    response.on('data', (chunk) => {
                        downloadedSize += chunk.length;
                        
                        // Send progress update every 500ms
                        const now = Date.now();
                        if (now - lastProgressUpdate > 500) {
                            lastProgressUpdate = now;
                            const percent = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
                            const mbDownloaded = (downloadedSize / (1024 * 1024)).toFixed(1);
                            const mbTotal = (totalSize / (1024 * 1024)).toFixed(1);
                            
                            sendUpdateLog(`Downloading: ${percent}% (${mbDownloaded}MB / ${mbTotal}MB)`, 'info');
                            
                            if (mainWindow) {
                                mainWindow.webContents.send('auto-updater-status', {
                                    status: 'download-progress',
                                    progress: {
                                        percent: percent,
                                        transferred: downloadedSize,
                                        total: totalSize
                                    }
                                });
                            }
                        }
                    });
                    
                    response.pipe(file);
                    
                    file.on('finish', () => {
                        file.close();
                        sendUpdateLog('Download complete!', 'success');
                        resolve();
                    });
                    
                    file.on('error', (err) => {
                        fsSync.unlink(downloadPath, () => {}); // Delete failed file
                        reject(err);
                    });
                });
                
                request.on('error', (err) => {
                    reject(err);
                });
                
                request.setTimeout(300000, () => { // 5 minute timeout
                    request.destroy();
                    reject(new Error('Download timeout'));
                });
            };
            
            downloadFile(downloadUrl);
        });
        
        // Verify the file exists
        if (!fsSync.existsSync(downloadPath)) {
            return { success: false, error: 'Downloaded file not found after download.' };
        }
        
        const fileSize = fsSync.statSync(downloadPath).size;
        sendUpdateLog(`Downloaded ${(fileSize / (1024 * 1024)).toFixed(1)}MB`, 'success');
        
        // Mark as downloaded
        updateDownloaded = true;
        downloadedUpdatePath = downloadPath;
        
        sendUpdateLog(`Launching new version: ${fileName}`, 'info');
        log.info('Launching new portable exe:', downloadPath);
        
        // Launch the new portable exe using Node.js spawn (not batch/CMD)
        const newProcess = spawn(downloadPath, [], {
            detached: true,
            stdio: 'ignore'
        });
        
        // Unref to allow the parent process to exit
        newProcess.unref();
        
        sendUpdateLog('New version launched. Closing current app...', 'info');
        log.info('New version launched successfully. Closing current app.');
        
        // Give the new process a moment to start, then close this app
        setTimeout(() => {
            app.quit();
        }, 1500);
        
        return { success: true };
    } catch (error) {
        log.error('Error in download-and-install-update:', error);
        sendUpdateLog(`Error: ${error.message}`, 'error');
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

