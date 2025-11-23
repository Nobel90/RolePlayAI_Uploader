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
                addLogEntry(`Skipped: ${result.stats.skippedChunks} chunks (already exist)`, 'info');
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
            
            // Add log entry for upload progress
            if (data.message && uploadLog) {
                const logType = data.error ? 'error' : 'info';
                addLogEntry(data.message, logType);
            }
        }
    }
});

