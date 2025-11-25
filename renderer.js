// renderer.js
// UI logic for RolePlayAI Uploader

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(tabName).classList.add('active');
    });
});

// Tab 1: Package Preparation
const browseSourceBtn = document.getElementById('browse-source');
const browseOutputBtn = document.getElementById('browse-output');
const generateManifestBtn = document.getElementById('generate-manifest');
const sourceDirInput = document.getElementById('source-dir');
const outputDirInput = document.getElementById('output-dir');
const versionInput = document.getElementById('version');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const statusText = document.getElementById('status-text');

browseSourceBtn.addEventListener('click', async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
        sourceDirInput.value = path;
    }
});

browseOutputBtn.addEventListener('click', async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
        outputDirInput.value = path;
    }
});

generateManifestBtn.addEventListener('click', async () => {
    const sourceDir = sourceDirInput.value;
    const outputDir = outputDirInput.value;
    const version = versionInput.value;
    const buildType = document.getElementById('build-type-prep').value;
    
    if (!sourceDir || !outputDir || !version) {
        alert('Please fill in all required fields');
        return;
    }
    
    const chunkMin = parseInt(document.getElementById('chunk-min').value) * 1024 * 1024;
    const chunkAvg = parseInt(document.getElementById('chunk-avg').value) * 1024 * 1024;
    const chunkMax = parseInt(document.getElementById('chunk-max').value) * 1024 * 1024;
    
    const options = {
        sourceDir,
        outputDir,
        version,
        buildType,
        chunkSizes: {
            min: chunkMin,
            avg: chunkAvg,
            max: chunkMax
        },
        filters: {
            excludePdb: document.getElementById('filter-pdb').checked,
            excludeSaved: document.getElementById('filter-saved').checked
        }
    };
    
    generateManifestBtn.disabled = true;
    progressContainer.classList.add('active');
    progressFill.style.width = '0%';
    statusText.textContent = 'Starting manifest generation...';
    
    try {
        const result = await window.electronAPI.generateManifest(options);
        
        if (result.success) {
            statusText.textContent = `Manifest generated successfully! Files: ${result.stats.filesProcessed}, Chunks: ${result.stats.totalChunks}, Unique: ${result.stats.uniqueChunks}`;
            alert(`Manifest generated successfully!\n\nFiles processed: ${result.stats.filesProcessed}\nTotal chunks: ${result.stats.totalChunks}\nUnique chunks: ${result.stats.uniqueChunks}\nDeduplication ratio: ${result.stats.deduplicationRatio}\n\nManifest saved to: ${result.manifestPath}`);
        } else {
            throw new Error(result.error || 'Failed to generate manifest');
        }
    } catch (error) {
        statusText.textContent = 'Error: ' + error.message;
        alert('Error: ' + error.message);
    } finally {
        generateManifestBtn.disabled = false;
    }
});

// Tab 2: Upload Management
const browseOldManifestBtn = document.getElementById('browse-old-manifest');
const browseNewManifestBtn = document.getElementById('browse-new-manifest');
const testR2Btn = document.getElementById('test-r2');
const startUploadBtn = document.getElementById('start-upload');
const pauseUploadBtn = document.getElementById('pause-upload');
const resumeUploadBtn = document.getElementById('resume-upload');
const verifyUploadBtn = document.getElementById('verify-upload');
const oldManifestInput = document.getElementById('old-manifest');
const newManifestInput = document.getElementById('new-manifest');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadStatusText = document.getElementById('upload-status-text');
const uploadLog = document.getElementById('upload-log');

browseOldManifestBtn.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFile({
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (path) {
        oldManifestInput.value = path;
    }
});

browseNewManifestBtn.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFile({
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (path) {
        newManifestInput.value = path;
    }
});

// Note: Bucket name is used as-is. Build type separation is handled via path structure in R2.
// Production files go to: production/[version]/...
// Staging files go to: staging/[version]/...

testR2Btn.addEventListener('click', async () => {
    const config = {
        bucket: document.getElementById('r2-bucket').value,
        endpoint: document.getElementById('r2-endpoint').value,
        accessKeyId: document.getElementById('r2-access-key').value,
        secretAccessKey: document.getElementById('r2-secret-key').value
    };
    
    if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
        alert('Please fill in all R2 configuration fields');
        return;
    }
    
    testR2Btn.disabled = true;
    testR2Btn.textContent = 'Testing...';
    
    try {
        const result = await window.electronAPI.testR2Connection(config);
        
        if (result.success) {
            alert('R2 connection successful!');
        } else {
            alert('R2 connection failed: ' + (result.message || result.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        testR2Btn.disabled = false;
        testR2Btn.textContent = 'Test Connection';
    }
});

startUploadBtn.addEventListener('click', async () => {
    const oldManifest = oldManifestInput.value;
    const newManifest = newManifestInput.value;
    const uploadMode = document.getElementById('upload-mode').value;
    const buildType = document.getElementById('build-type-upload').value;
    
    if (!newManifest) {
        alert('Please select a current version manifest');
        return;
    }
    
    // Get version and buildType from manifest
    let version;
    let manifestBuildType;
    try {
        const manifestResult = await window.electronAPI.readFile(newManifest);
        if (!manifestResult.success) {
            throw new Error('Failed to read manifest: ' + manifestResult.error);
        }
        const manifest = JSON.parse(manifestResult.data);
        version = manifest.version;
        manifestBuildType = manifest.buildType;
        
        if (!version) {
            throw new Error('Manifest missing version field');
        }
        
        // Use manifest's buildType if present, otherwise use selected buildType
        const finalBuildType = manifestBuildType || buildType;
        
        // Warn if mismatch
        if (manifestBuildType && manifestBuildType !== buildType) {
            if (!confirm(`Manifest buildType (${manifestBuildType}) doesn't match selected buildType (${buildType}). Continue with manifest's buildType?`)) {
                return;
            }
        }
        
        // Use the bucket name as-is (don't auto-append suffixes)
        // Build type separation is handled via path structure in R2
        const finalBucket = document.getElementById('r2-bucket').value;
        
        const config = {
            bucket: finalBucket,
            endpoint: document.getElementById('r2-endpoint').value,
            accessKeyId: document.getElementById('r2-access-key').value,
            secretAccessKey: document.getElementById('r2-secret-key').value
        };
        
        if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
            alert('Please fill in all R2 configuration fields');
            return;
        }
        
        // Get chunks directory (should be in same directory as manifest)
        const manifestDir = newManifest.substring(0, newManifest.lastIndexOf('\\') || newManifest.lastIndexOf('/'));
        const chunksDir = manifestDir + (manifestDir.includes('\\') ? '\\chunks' : '/chunks');
        
        startUploadBtn.disabled = true;
        pauseUploadBtn.style.display = 'inline-block';
        resumeUploadBtn.style.display = 'none';
        uploadProgressContainer.classList.add('active');
        uploadProgressFill.style.width = '0%';
        uploadStatusText.textContent = 'Preparing upload...';
        uploadLog.innerHTML = '';
        
        addLogEntry('Starting upload process...', 'info');
        addLogEntry(`Build Type: ${finalBuildType}`, 'info');
        addLogEntry(`Bucket: ${finalBucket}`, 'info');
        addLogEntry(`Upload mode: ${uploadMode}`, 'info');
        addLogEntry(`Version: ${version}`, 'info');
        
        try {
            const result = await window.electronAPI.uploadToR2({
                oldManifestPath: oldManifest || null,
                newManifestPath: newManifest,
                mode: uploadMode,
                chunksDir: chunksDir,
                version: version,
                buildType: finalBuildType,
                config: config
            });
            
            if (result.success) {
                addLogEntry('Upload completed successfully!', 'success');
                addLogEntry(`Uploaded: ${result.stats.uploadedChunks} chunks`, 'success');
                if (result.stats.skippedChunks > 0) {
                    addLogEntry(`Skipped: ${result.stats.skippedChunks} chunks (already exist)`, 'info');
                    // Show details of skipped chunks
                    if (result.stats.skippedChunksDetails && result.stats.skippedChunksDetails.length > 0) {
                        result.stats.skippedChunksDetails.forEach((chunk, index) => {
                            if (index < 10) { // Show first 10 for brevity
                                addLogEntry(`  - ${chunk.hash.substring(0, 16)}... (${chunk.reason})`, 'info');
                            }
                        });
                        if (result.stats.skippedChunksDetails.length > 10) {
                            addLogEntry(`  ... and ${result.stats.skippedChunksDetails.length - 10} more`, 'info');
                        }
                    }
                }
                if (result.stats.failedChunks > 0) {
                    addLogEntry(`Failed: ${result.stats.failedChunks} chunks`, 'error');
                }
                uploadStatusText.textContent = 'Upload complete!';
                pauseUploadBtn.style.display = 'none';
                resumeUploadBtn.style.display = 'none';
                alert(`Upload completed!\n\nUploaded: ${result.stats.uploadedChunks} chunks\nSkipped: ${result.stats.skippedChunks} chunks\nFailed: ${result.stats.failedChunks} chunks`);
            } else {
                throw new Error(result.error || 'Upload failed');
            }
        } catch (error) {
            addLogEntry('Error: ' + error.message, 'error');
            uploadStatusText.textContent = 'Upload failed: ' + error.message;
            pauseUploadBtn.style.display = 'none';
            resumeUploadBtn.style.display = 'none';
            alert('Upload failed: ' + error.message);
        } finally {
            startUploadBtn.disabled = false;
        }
    } catch (error) {
        alert('Error reading manifest: ' + error.message);
        return;
    }
});

// Pause upload button
pauseUploadBtn.addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.pauseUpload();
        if (result.success) {
            pauseUploadBtn.style.display = 'none';
            resumeUploadBtn.style.display = 'inline-block';
            addLogEntry('Upload paused', 'info');
            uploadStatusText.textContent = 'Upload paused...';
        } else {
            alert('Failed to pause upload: ' + (result.message || result.error));
        }
    } catch (error) {
        alert('Error pausing upload: ' + error.message);
    }
});

// Resume upload button
resumeUploadBtn.addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.resumeUpload();
        if (result.success) {
            pauseUploadBtn.style.display = 'inline-block';
            resumeUploadBtn.style.display = 'none';
            addLogEntry('Upload resumed', 'info');
            uploadStatusText.textContent = 'Upload resumed...';
        } else {
            alert('Failed to resume upload: ' + (result.message || result.error));
        }
    } catch (error) {
        alert('Error resuming upload: ' + error.message);
    }
});

// Verify upload button
verifyUploadBtn.addEventListener('click', async () => {
    const newManifest = newManifestInput.value;
    
    if (!newManifest) {
        alert('Please select a manifest file to verify');
        return;
    }
    
    const config = {
        bucket: document.getElementById('r2-bucket').value,
        endpoint: document.getElementById('r2-endpoint').value,
        accessKeyId: document.getElementById('r2-access-key').value,
        secretAccessKey: document.getElementById('r2-secret-key').value
    };
    
    if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
        alert('Please fill in all R2 configuration fields');
        return;
    }
    
    verifyUploadBtn.disabled = true;
    verifyUploadBtn.textContent = 'Verifying...';
    uploadLog.innerHTML = '';
    uploadProgressContainer.classList.add('active');
    uploadProgressFill.style.width = '0%';
    uploadStatusText.textContent = 'Starting verification...';
    
    addLogEntry('Starting verification...', 'info');
    
    try {
        const result = await window.electronAPI.verifyUpload({
            manifestPath: newManifest,
            config: config
        });
        
        if (result.success) {
            addLogEntry('Verification complete!', 'success');
            addLogEntry(`Total chunks: ${result.totalChunks}`, 'info');
            addLogEntry(`Existing: ${result.existingChunks.length} chunks (${(result.existingSize / 1024 / 1024).toFixed(2)} MB)`, 
                result.allChunksExist ? 'success' : 'info');
            
            if (result.missingChunks.length > 0) {
                addLogEntry(`Missing: ${result.missingChunks.length} chunks (${(result.missingSize / 1024 / 1024).toFixed(2)} MB)`, 'error');
                addLogEntry('Missing chunk hashes:', 'error');
                result.missingChunks.slice(0, 20).forEach(chunk => {
                    addLogEntry(`  - ${chunk.hash.substring(0, 16)}... (${(chunk.size / 1024).toFixed(2)} KB)`, 'error');
                });
                if (result.missingChunks.length > 20) {
                    addLogEntry(`  ... and ${result.missingChunks.length - 20} more missing chunks`, 'error');
                }
            } else {
                addLogEntry('✓ All chunks verified and exist in R2!', 'success');
            }
        } else {
            throw new Error(result.error || 'Verification failed');
        }
    } catch (error) {
        addLogEntry('Error: ' + error.message, 'error');
        uploadStatusText.textContent = 'Verification failed: ' + error.message;
        alert('Verification failed: ' + error.message);
    } finally {
        verifyUploadBtn.disabled = false;
        verifyUploadBtn.textContent = 'Verify Upload';
        // Keep progress container visible to show final results
        // It will be hidden when starting a new upload or verification
    }
});

function addLogEntry(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    uploadLog.appendChild(entry);
    uploadLog.scrollTop = uploadLog.scrollHeight;
}

// Progress listener for manifest generation
window.electronAPI.onProgress((data) => {
    if (data.percentage !== undefined) {
        // Update manifest generation progress
        if (progressContainer.classList.contains('active')) {
            progressFill.style.width = `${data.percentage}%`;
            statusText.textContent = data.message || `Progress: ${data.percentage.toFixed(1)}%`;
        }
        
        // Update upload progress
        if (uploadProgressContainer.classList.contains('active')) {
            uploadProgressFill.style.width = `${data.percentage}%`;
            let statusMessage = data.message || `Progress: ${data.percentage.toFixed(1)}%`;
            
            // Check if paused (message contains "Paused")
            if (data.message && data.message.includes('Paused')) {
                statusMessage = data.message;
            }
            
            uploadStatusText.textContent = statusMessage;
            
            // Add log entry for upload/verify progress
            if (data.message && uploadLog) {
                let logType = data.error ? 'error' : 'info';
                
                // Color code verification messages
                if (data.chunkStatus === 'exists') {
                    logType = 'success';
                } else if (data.chunkStatus === 'missing') {
                    logType = 'error';
                } else if (data.message.includes('Verification complete') || data.message.includes('✓')) {
                    logType = 'success';
                }
                
                // Only log detailed chunk status every 10 chunks or on status changes to avoid spam
                const shouldLog = !data.chunkStatus || 
                                 (data.currentChunk && data.currentChunk % 10 === 0) ||
                                 data.chunkStatus === 'missing' ||
                                 data.message.includes('complete') ||
                                 data.message.includes('Starting');
                
                if (shouldLog) {
                    addLogEntry(data.message, logType);
                }
            }
        }
        
        // Update version management progress
        if (data.percentage !== undefined) {
            const versionProgressContainer = document.getElementById('version-progress-container');
            const versionProgressFill = document.getElementById('version-progress-fill');
            const versionStatusText = document.getElementById('version-status-text');
            
            if (versionProgressContainer && versionProgressFill && versionStatusText) {
                versionProgressFill.style.width = `${data.percentage}%`;
                versionStatusText.textContent = data.message || `Progress: ${data.percentage.toFixed(1)}%`;
                
                // Add log entry for version management
                const versionLog = document.getElementById('version-log');
                if (data.message && versionLog) {
                    let logType = data.error ? 'error' : 'info';
                    if (data.message.includes('successfully') || data.message.includes('✓')) {
                        logType = 'success';
                    } else if (data.message.includes('Error') || data.message.includes('✗')) {
                        logType = 'error';
                    }
                    addLogEntry(data.message, logType, versionLog);
                }
            }
        }
    }
});

// Tab 3: Version Management
const fetchVersionsBtn = document.getElementById('fetch-versions');
const promoteVersionBtn = document.getElementById('promote-version');
const browseLocalManifestVersionBtn = document.getElementById('browse-local-manifest-version');
const versionSelect = document.getElementById('version-select');
const localManifestVersionInput = document.getElementById('local-manifest-version');
const versionProgressContainer = document.getElementById('version-progress-container');
const versionProgressFill = document.getElementById('version-progress-fill');
const versionStatusText = document.getElementById('version-status-text');
const versionLog = document.getElementById('version-log');

// Helper function to add log entries
function addLogEntry(message, type = 'info', logContainer = null) {
    if (!logContainer) return;
    
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Fetch versions from R2
fetchVersionsBtn.addEventListener('click', async () => {
    const buildType = document.getElementById('build-type-version').value;
    const config = {
        bucket: document.getElementById('r2-bucket-version').value,
        endpoint: document.getElementById('r2-endpoint-version').value,
        accessKeyId: document.getElementById('r2-access-key-version').value,
        secretAccessKey: document.getElementById('r2-secret-key-version').value
    };
    
    if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
        alert('Please fill in all R2 configuration fields');
        return;
    }
    
    fetchVersionsBtn.disabled = true;
    versionSelect.disabled = true;
    versionStatusText.textContent = 'Fetching versions from R2...';
    versionSelect.innerHTML = '<option value="">Loading...</option>';
    
    try {
        const result = await window.electronAPI.listVersions({ config, buildType });
        
        if (result.success && result.versions && result.versions.length > 0) {
            versionSelect.innerHTML = '<option value="">Select a version...</option>';
            result.versions.forEach(version => {
                const option = document.createElement('option');
                option.value = version;
                // Mark current version with indicator
                if (result.currentVersion && version === result.currentVersion) {
                    option.textContent = `${version} (Current)`;
                    option.style.fontWeight = 'bold';
                } else {
                    option.textContent = version;
                }
                versionSelect.appendChild(option);
            });
            versionSelect.disabled = false;
            promoteVersionBtn.disabled = false;
            
            // Show status with current version info
            let statusMessage = `Found ${result.versions.length} version(s)`;
            if (result.currentVersion) {
                statusMessage += ` | Current: ${result.currentVersion}`;
            }
            versionStatusText.textContent = statusMessage;
            
            let logMessage = `Successfully fetched ${result.versions.length} version(s)`;
            if (result.currentVersion) {
                logMessage += ` (Current version: ${result.currentVersion})`;
            }
            addLogEntry(logMessage, 'success', versionLog);
        } else {
            versionSelect.innerHTML = '<option value="">No versions found</option>';
            let statusMessage = 'No versions found in R2';
            if (result.currentVersion) {
                statusMessage += ` | Current: ${result.currentVersion}`;
            }
            versionStatusText.textContent = statusMessage;
            addLogEntry('No versions found in R2 for the selected build type', 'warning', versionLog);
        }
    } catch (error) {
        console.error('Error fetching versions:', error);
        versionSelect.innerHTML = '<option value="">Error fetching versions</option>';
        versionStatusText.textContent = `Error: ${error.message || 'Failed to fetch versions'}`;
        addLogEntry(`Error fetching versions: ${error.message || 'Unknown error'}`, 'error', versionLog);
        alert(`Error fetching versions: ${error.message || 'Unknown error'}`);
    } finally {
        fetchVersionsBtn.disabled = false;
    }
});

// Browse local manifest file
browseLocalManifestVersionBtn.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFile({
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (path) {
        localManifestVersionInput.value = path;
    }
});

// Promote version
promoteVersionBtn.addEventListener('click', async () => {
    const buildType = document.getElementById('build-type-version').value;
    const selectedVersion = versionSelect.value;
    const localManifestPath = localManifestVersionInput.value;
    
    if (!selectedVersion && !localManifestPath) {
        alert('Please select a version from the dropdown or provide a local manifest file');
        return;
    }
    
    const config = {
        bucket: document.getElementById('r2-bucket-version').value,
        endpoint: document.getElementById('r2-endpoint-version').value,
        accessKeyId: document.getElementById('r2-access-key-version').value,
        secretAccessKey: document.getElementById('r2-secret-key-version').value
    };
    
    if (!config.bucket || !config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
        alert('Please fill in all R2 configuration fields');
        return;
    }
    
    // Determine version to promote and whether to use local manifest
    let versionToPromote = selectedVersion;
    let localManifestPathToUse = null;
    
    if (localManifestPath) {
        // If local manifest is provided, read it and extract version
        try {
            const manifestData = await window.electronAPI.readFile(localManifestPath);
            const manifest = JSON.parse(manifestData);
            const manifestVersion = manifest.version;
            
            if (!manifestVersion) {
                alert('Local manifest file does not contain a version field');
                return;
            }
            
            // If version is also selected, verify they match
            if (selectedVersion && selectedVersion !== manifestVersion) {
                const useLocal = confirm(
                    `Local manifest version (${manifestVersion}) differs from selected version (${selectedVersion}). ` +
                    `Use local manifest version?`
                );
                if (!useLocal) {
                    return;
                }
            }
            
            versionToPromote = manifestVersion;
            localManifestPathToUse = localManifestPath;
            addLogEntry(`Using local manifest file. Version: ${versionToPromote}`, 'info', versionLog);
        } catch (error) {
            alert(`Error reading local manifest: ${error.message}`);
            return;
        }
    }
    
    if (!versionToPromote) {
        alert('Please select a version from the dropdown or provide a local manifest file');
        return;
    }
    
    promoteVersionBtn.disabled = true;
    versionProgressContainer.classList.add('active');
    versionProgressFill.style.width = '0%';
    versionStatusText.textContent = 'Starting version promotion...';
    versionLog.innerHTML = '';
    addLogEntry(`Starting promotion of version ${versionToPromote} (${buildType})...`, 'info', versionLog);
    
    try {
        const result = await window.electronAPI.promoteVersion({
            config,
            version: versionToPromote,
            buildType,
            localManifestPath: localManifestPathToUse
        });
        
        if (result.success) {
            versionStatusText.textContent = result.message || `Version ${versionToPromote} successfully promoted!`;
            addLogEntry(result.message || `Version ${versionToPromote} successfully promoted!`, 'success', versionLog);
            alert(`Success! ${result.message || `Version ${versionToPromote} has been promoted as the latest ${buildType} version.`}`);
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (error) {
        console.error('Error promoting version:', error);
        versionStatusText.textContent = `Error: ${error.message || 'Failed to promote version'}`;
        addLogEntry(`Error: ${error.message || 'Failed to promote version'}`, 'error', versionLog);
        alert(`Error promoting version: ${error.message || 'Unknown error'}`);
    } finally {
        promoteVersionBtn.disabled = false;
    }
});

// Auto-updater functionality
const checkUpdatesBtn = document.getElementById('check-updates-btn');
const downloadInstallBtn = document.getElementById('download-install-btn');
const updateStatus = document.getElementById('update-status');
const updateIcon = document.getElementById('update-icon');
const updateText = document.getElementById('update-text');
const installIcon = document.getElementById('install-icon');
const installText = document.getElementById('install-text');
const updateLogContainer = document.getElementById('update-log-container');
const updateLogContent = document.getElementById('update-log-content');
const toggleUpdateLogBtn = document.getElementById('toggle-update-log');

let updateDownloaded = false;
let updateLogExpanded = true;
let updateAvailable = false;

// Update log functions
function addUpdateLog(message, type = 'info') {
    if (!updateLogContent) return;
    
    const time = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
    
    updateLogContent.appendChild(logEntry);
    updateLogContent.scrollTop = updateLogContent.scrollHeight;
    
    // Show log container if hidden
    if (updateLogContainer && updateLogContainer.style.display === 'none') {
        updateLogContainer.style.display = 'flex';
    }
}

function clearUpdateLog() {
    if (updateLogContent) {
        updateLogContent.innerHTML = '';
    }
}

// Toggle log container
if (toggleUpdateLogBtn) {
    toggleUpdateLogBtn.addEventListener('click', () => {
        updateLogExpanded = !updateLogExpanded;
        const content = updateLogContent;
        if (content) {
            if (updateLogExpanded) {
                content.style.display = 'block';
                toggleUpdateLogBtn.textContent = '−';
            } else {
                content.style.display = 'none';
                toggleUpdateLogBtn.textContent = '+';
            }
        }
    });
}

// Handle manual update check
checkUpdatesBtn.addEventListener('click', async () => {
    console.log('[Update] Manual update check button clicked');
    addUpdateLog('Manual update check initiated...', 'info');
    
    checkUpdatesBtn.disabled = true;
    updateText.textContent = 'Checking...';
    updateIcon.textContent = '⏳';
    updateStatus.style.display = 'none';
    
    try {
        addUpdateLog('Calling checkForUpdates IPC handler...', 'info');
        const result = await window.electronAPI.checkForUpdates();
        
        if (!result.success) {
            addUpdateLog(`Update check failed: ${result.error || 'Unknown error'}`, 'error');
            showUpdateStatus('error', `Error: ${result.error || 'Failed to check for updates'}`);
            checkUpdatesBtn.disabled = false;
            updateText.textContent = 'Check Updates';
            updateIcon.textContent = '🔄';
        } else {
            addUpdateLog('Update check initiated successfully. Waiting for response...', 'success');
        }
        // Status will be updated via auto-updater events
    } catch (error) {
        console.error('Error checking for updates:', error);
        addUpdateLog(`Exception during update check: ${error.message || 'Unknown error'}`, 'error');
        
        // Ignore ENOENT errors for YML files - we're using GitHub API only
        if (error.message && error.message.includes('app-update.yml') && error.message.includes('ENOENT')) {
            addUpdateLog('Ignoring YML file error (using GitHub API only)', 'info');
            // Silently ignore - we're using GitHub API directly
            checkUpdatesBtn.disabled = false;
            updateText.textContent = 'Check Updates';
            updateIcon.textContent = '🔄';
            return;
        }
        
        showUpdateStatus('error', `Error: ${error.message || 'Failed to check for updates'}`);
        checkUpdatesBtn.disabled = false;
        updateText.textContent = 'Check Updates';
        updateIcon.textContent = '🔄';
    }
});

// Listen for auto-updater status events
window.electronAPI.onAutoUpdaterStatus((data) => {
    const { status, info, progress, error, logMessage } = data;
    
    // Add log message if provided
    if (logMessage) {
        const logType = status === 'error' ? 'error' : (status === 'update-available' ? 'success' : 'info');
        addUpdateLog(logMessage, logType);
    }
    
    switch (status) {
        case 'checking':
            addUpdateLog('Checking for updates...', 'info');
            updateStatus.style.display = 'block';
            updateStatus.className = 'update-status checking';
            updateStatus.textContent = 'Checking for updates...';
            updateIcon.textContent = '⏳';
            updateText.textContent = 'Checking...';
            break;
            
        case 'update-available':
            updateAvailable = true;
            const version = info?.version || 'new version';
            addUpdateLog(`Update available: v${version}`, 'success');
            updateStatus.style.display = 'block';
            updateStatus.className = 'update-status available';
            updateStatus.textContent = `Update available: v${version}`;
            updateIcon.textContent = '⬇️';
            updateText.textContent = 'Update Available';
            checkUpdatesBtn.disabled = false;
            // Show download & install button
            if (downloadInstallBtn) {
                downloadInstallBtn.style.display = 'block';
                installText.textContent = 'Download & Install';
                installIcon.textContent = '⬇️';
            }
            break;
            
        case 'update-not-available':
            updateAvailable = false;
            addUpdateLog('No updates available. Current version is up to date.', 'info');
            updateStatus.style.display = 'block';
            updateStatus.className = 'update-status up-to-date';
            updateStatus.textContent = 'You are up to date!';
            updateIcon.textContent = '✅';
            updateText.textContent = 'Check Updates';
            checkUpdatesBtn.disabled = false;
            // Hide download & install button
            if (downloadInstallBtn) {
                downloadInstallBtn.style.display = 'none';
            }
            break;
            
        case 'download-progress':
            if (progress) {
                const percent = Math.round(progress.percent || 0);
                const mbTransferred = (progress.transferred / (1024 * 1024)).toFixed(1);
                const mbTotal = (progress.total / (1024 * 1024)).toFixed(1);
                addUpdateLog(`Downloading: ${percent}% (${mbTransferred}MB / ${mbTotal}MB)`, 'info');
                updateStatus.style.display = 'block';
                updateStatus.className = 'update-status downloading';
                updateStatus.textContent = `Downloading: ${percent}% (${mbTransferred}MB / ${mbTotal}MB)`;
                updateIcon.textContent = '⬇️';
                updateText.textContent = 'Downloading...';
                // Show download & install button during download (disabled)
                if (downloadInstallBtn && updateAvailable) {
                    downloadInstallBtn.style.display = 'block';
                    downloadInstallBtn.disabled = true;
                    installText.textContent = `Downloading... ${percent}%`;
                    installIcon.textContent = '⏳';
                }
            }
            break;
            
        case 'update-downloaded':
            updateDownloaded = true;
            addUpdateLog('Update downloaded successfully! Ready to install.', 'success');
            updateStatus.style.display = 'block';
            updateStatus.className = 'update-status downloaded';
            updateStatus.textContent = 'Update downloaded! Ready to install.';
            updateIcon.textContent = '✅';
            updateText.textContent = 'Check Updates';
            checkUpdatesBtn.disabled = false;
            
            // Update download & install button to show ready state
            if (downloadInstallBtn) {
                downloadInstallBtn.style.display = 'block';
                downloadInstallBtn.disabled = false;
                installText.textContent = 'Install & Restart';
                installIcon.textContent = '🚀';
            }
            break;
            
        case 'error':
            if (!updateDownloaded) {
                // Ignore ENOENT errors for YML files - we're using GitHub API only
                if (error && error.includes('app-update.yml') && error.includes('ENOENT')) {
                    addUpdateLog('Ignoring YML file error (using GitHub API only)', 'info');
                    // Silently ignore this error - we're using GitHub API directly
                    console.log('Ignoring YML file error in renderer');
                    checkUpdatesBtn.disabled = false;
                    updateText.textContent = 'Check Updates';
                    updateIcon.textContent = '🔄';
                    // Don't show the error status
                    return;
                }
                
                addUpdateLog(`Update error: ${error || 'Unknown error'}`, 'error');
                updateStatus.style.display = 'block';
                updateStatus.className = 'update-status error';
                updateStatus.textContent = error || 'Update check failed';
                updateIcon.textContent = '❌';
                updateText.textContent = 'Check Updates';
                checkUpdatesBtn.disabled = false;
            }
            break;
    }
});

function showUpdateStatus(type, message) {
    updateStatus.style.display = 'block';
    updateStatus.className = `update-status ${type}`;
    updateStatus.textContent = message;
}

// Handle download & install button click
if (downloadInstallBtn) {
    downloadInstallBtn.addEventListener('click', async () => {
        console.log('[Update] Download & Install button clicked');
        addUpdateLog('Download & Install button clicked...', 'info');
        
        downloadInstallBtn.disabled = true;
        installText.textContent = 'Processing...';
        installIcon.textContent = '⏳';
        
        try {
            const result = await window.electronAPI.downloadAndInstallUpdate();
            
            if (!result.success) {
                addUpdateLog(`Download & Install failed: ${result.error || 'Unknown error'}`, 'error');
                showUpdateStatus('error', `Error: ${result.error || 'Failed to download and install'}`);
                downloadInstallBtn.disabled = false;
                installText.textContent = updateDownloaded ? 'Install & Restart' : 'Download & Install';
                installIcon.textContent = updateDownloaded ? '🚀' : '⬇️';
            } else {
                addUpdateLog('Download & Install initiated successfully. App will close and restart...', 'success');
                // App will close automatically, so we don't need to re-enable the button
            }
        } catch (error) {
            console.error('Error in download and install:', error);
            addUpdateLog(`Exception during download & install: ${error.message || 'Unknown error'}`, 'error');
            showUpdateStatus('error', `Error: ${error.message || 'Failed to download and install'}`);
            downloadInstallBtn.disabled = false;
            installText.textContent = updateDownloaded ? 'Install & Restart' : 'Download & Install';
            installIcon.textContent = updateDownloaded ? '🚀' : '⬇️';
        }
    });
}

