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
        // TODO: Implement manifest generation
        // const result = await window.electronAPI.generateManifest(options);
        alert('Manifest generation will be implemented in the next phase');
    } catch (error) {
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

testR2Btn.addEventListener('click', async () => {
    const config = {
        bucket: document.getElementById('r2-bucket').value,
        endpoint: document.getElementById('r2-endpoint').value,
        accessKeyId: document.getElementById('r2-access-key').value,
        secretAccessKey: document.getElementById('r2-secret-key').value
    };
    
    testR2Btn.disabled = true;
    testR2Btn.textContent = 'Testing...';
    
    try {
        // TODO: Implement R2 connection test
        // const result = await window.electronAPI.testR2Connection(config);
        alert('R2 connection test will be implemented in the next phase');
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
    
    if (!newManifest) {
        alert('Please select a current version manifest');
        return;
    }
    
    const config = {
        bucket: document.getElementById('r2-bucket').value,
        endpoint: document.getElementById('r2-endpoint').value,
        accessKeyId: document.getElementById('r2-access-key').value,
        secretAccessKey: document.getElementById('r2-secret-key').value
    };
    
    startUploadBtn.disabled = true;
    uploadProgressContainer.classList.add('active');
    uploadProgressFill.style.width = '0%';
    uploadStatusText.textContent = 'Preparing upload...';
    uploadLog.innerHTML = '';
    
    addLogEntry('Starting upload process...', 'info');
    
    try {
        // TODO: Implement upload
        // const result = await window.electronAPI.uploadToR2({
        //     oldManifest,
        //     newManifest,
        //     mode: uploadMode,
        //     config
        // });
        alert('Upload functionality will be implemented in the next phase');
    } catch (error) {
        addLogEntry('Error: ' + error.message, 'error');
    } finally {
        startUploadBtn.disabled = false;
    }
});

function addLogEntry(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    uploadLog.appendChild(entry);
    uploadLog.scrollTop = uploadLog.scrollHeight;
}

// Progress listener
window.electronAPI.onProgress((data) => {
    if (data.percentage !== undefined) {
        progressFill.style.width = `${data.percentage}%`;
        statusText.textContent = data.message || `Progress: ${data.percentage.toFixed(1)}%`;
    }
});

