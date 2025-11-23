// deltaDetector.js
// Delta comparison logic to detect changed files/chunks between manifests

const { parseManifest, getAllChunks } = require('./manifestUtils');

/**
 * Compare two manifests and detect changes
 * Returns: { changedFiles, newFiles, deletedFiles, changedChunks, newChunks }
 */
function detectDelta(oldManifest, newManifest) {
    // Parse manifests
    const oldParsed = parseManifest(oldManifest);
    const newParsed = parseManifest(newManifest);
    
    // Both must be chunk-based manifests
    if (oldParsed.type !== 'chunk-based' || newParsed.type !== 'chunk-based') {
        throw new Error('Both manifests must be chunk-based');
    }
    
    const old = oldParsed.manifest;
    const new_manifest = newParsed.manifest;
    
    // Create maps for quick lookup
    const oldFilesMap = new Map();
    old.files.forEach(file => {
        oldFilesMap.set(file.filename, file);
    });
    
    const newFilesMap = new Map();
    new_manifest.files.forEach(file => {
        newFilesMap.set(file.filename, file);
    });
    
    // Find new, deleted, and changed files
    const newFiles = [];
    const deletedFiles = [];
    const changedFiles = [];
    
    // Check for new and changed files
    for (const newFile of new_manifest.files) {
        const oldFile = oldFilesMap.get(newFile.filename);
        
        if (!oldFile) {
            // New file
            newFiles.push(newFile);
        } else {
            // Check if file changed
            if (hasFileChanged(oldFile, newFile)) {
                changedFiles.push(newFile);
            }
        }
    }
    
    // Check for deleted files
    for (const oldFile of old.files) {
        if (!newFilesMap.has(oldFile.filename)) {
            deletedFiles.push(oldFile);
        }
    }
    
    // Get all chunks from changed and new files
    const changedChunks = new Set();
    const newChunks = new Set();
    
    // Chunks from changed files
    changedFiles.forEach(file => {
        file.chunks.forEach(chunk => {
            changedChunks.add(chunk.hash);
        });
    });
    
    // Chunks from new files
    newFiles.forEach(file => {
        file.chunks.forEach(chunk => {
            newChunks.add(chunk.hash);
        });
    });
    
    // Get old chunks to check for deduplication
    const oldChunks = new Set();
    getAllChunks(old).forEach(chunk => {
        oldChunks.add(chunk.hash);
    });
    
    // Filter out chunks that already exist in old manifest (deduplication)
    const uniqueNewChunks = Array.from(newChunks).filter(hash => !oldChunks.has(hash));
    const uniqueChangedChunks = Array.from(changedChunks).filter(hash => !oldChunks.has(hash));
    
    // Combine all chunks that need to be uploaded
    const chunksToUpload = new Set([...uniqueNewChunks, ...uniqueChangedChunks]);
    
    // Get chunk details from new manifest
    const allNewChunks = getAllChunks(new_manifest);
    const chunksToUploadDetails = allNewChunks.filter(chunk => 
        chunksToUpload.has(chunk.hash)
    );
    
    return {
        changedFiles,
        newFiles,
        deletedFiles,
        changedChunks: uniqueChangedChunks,
        newChunks: uniqueNewChunks,
        chunksToUpload: Array.from(chunksToUpload),
        chunksToUploadDetails,
        stats: {
            totalFiles: new_manifest.files.length,
            newFilesCount: newFiles.length,
            changedFilesCount: changedFiles.length,
            deletedFilesCount: deletedFiles.length,
            chunksToUploadCount: chunksToUpload.size,
            totalChunksInNew: allNewChunks.length
        }
    };
}

/**
 * Check if a file has changed by comparing chunk hashes
 */
function hasFileChanged(oldFile, newFile) {
    // Different total size means file changed
    if (oldFile.totalSize !== newFile.totalSize) {
        return true;
    }
    
    // Different number of chunks means file changed
    if (oldFile.chunks.length !== newFile.chunks.length) {
        return true;
    }
    
    // Compare chunk hashes
    const oldHashes = oldFile.chunks.map(c => c.hash).join(',');
    const newHashes = newFile.chunks.map(c => c.hash).join(',');
    
    return oldHashes !== newHashes;
}

/**
 * Get all files that need to be uploaded (new + changed)
 */
function getFilesToUpload(delta) {
    return [...delta.newFiles, ...delta.changedFiles];
}

/**
 * Calculate total upload size
 */
function calculateUploadSize(delta) {
    const chunksSize = delta.chunksToUploadDetails.reduce((sum, chunk) => sum + chunk.size, 0);
    
    // Note: We don't need to upload full files, just chunks
    // But we need to upload manifest files
    return chunksSize;
}

module.exports = {
    detectDelta,
    hasFileChanged,
    getFilesToUpload,
    calculateUploadSize
};

