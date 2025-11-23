// manifestUtils.js
// Utilities for handling both file-based and chunk-based manifests

/**
 * Detect manifest type
 */
function detectManifestType(manifest) {
    if (manifest.manifestType === 'chunk-based') {
        return 'chunk-based';
    }
    
    // Check if it has chunk structure
    if (manifest.files && manifest.files.length > 0) {
        const firstFile = manifest.files[0];
        if (firstFile.chunks && Array.isArray(firstFile.chunks)) {
            return 'chunk-based';
        }
    }
    
    // Default to file-based
    return 'file-based';
}

/**
 * Validate chunk-based manifest structure
 */
function validateChunkManifest(manifest) {
    if (!manifest.version) {
        throw new Error('Manifest missing version');
    }
    
    if (!manifest.files || !Array.isArray(manifest.files)) {
        throw new Error('Manifest missing files array');
    }
    
    for (const file of manifest.files) {
        if (!file.filename) {
            throw new Error('File missing filename');
        }
        
        if (!file.chunks || !Array.isArray(file.chunks)) {
            throw new Error(`File ${file.filename} missing chunks array`);
        }
        
        for (const chunk of file.chunks) {
            if (!chunk.hash) {
                throw new Error(`Chunk missing hash in file ${file.filename}`);
            }
            if (typeof chunk.size !== 'number') {
                throw new Error(`Chunk missing size in file ${file.filename}`);
            }
            if (typeof chunk.offset !== 'number') {
                throw new Error(`Chunk missing offset in file ${file.filename}`);
            }
            if (!chunk.url) {
                throw new Error(`Chunk missing url in file ${file.filename}`);
            }
        }
        
        // Verify total size matches sum of chunks
        const calculatedSize = file.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        if (file.totalSize && file.totalSize !== calculatedSize) {
            console.warn(`File ${file.filename}: totalSize (${file.totalSize}) doesn't match sum of chunks (${calculatedSize})`);
        }
    }
    
    return true;
}

/**
 * Validate file-based manifest structure
 */
function validateFileManifest(manifest) {
    if (!manifest.version) {
        throw new Error('Manifest missing version');
    }
    
    if (!manifest.files || !Array.isArray(manifest.files)) {
        throw new Error('Manifest missing files array');
    }
    
    for (const file of manifest.files) {
        if (!file.path) {
            throw new Error('File missing path');
        }
        if (!file.url) {
            throw new Error(`File ${file.path} missing url`);
        }
    }
    
    return true;
}

/**
 * Parse and validate manifest
 */
function parseManifest(manifestData) {
    let manifest;
    
    if (typeof manifestData === 'string') {
        manifest = JSON.parse(manifestData);
    } else {
        manifest = manifestData;
    }
    
    const type = detectManifestType(manifest);
    
    if (type === 'chunk-based') {
        validateChunkManifest(manifest);
    } else {
        validateFileManifest(manifest);
    }
    
    return {
        type,
        manifest
    };
}

/**
 * Get all chunks from a chunk-based manifest
 */
function getAllChunks(manifest) {
    const chunks = [];
    
    for (const file of manifest.files) {
        for (const chunk of file.chunks) {
            chunks.push({
                ...chunk,
                file: file.filename
            });
        }
    }
    
    return chunks;
}

/**
 * Get chunks for a specific file
 */
function getFileChunks(manifest, filename) {
    const file = manifest.files.find(f => f.filename === filename);
    if (!file) {
        return null;
    }
    
    return file.chunks || [];
}

/**
 * Calculate total download size for missing chunks
 */
function calculateDownloadSize(missingChunks) {
    return missingChunks.reduce((sum, chunk) => sum + chunk.size, 0);
}

/**
 * Create a chunk-based manifest from file chunks
 */
function createChunkManifest(version, files) {
    return {
        version,
        manifestType: 'chunk-based',
        files: files.map(file => ({
            filename: file.filename,
            totalSize: file.totalSize || file.chunks.reduce((sum, chunk) => sum + chunk.size, 0),
            chunks: file.chunks.map(chunk => ({
                hash: chunk.hash,
                size: chunk.size,
                offset: chunk.offset,
                url: chunk.url
            }))
        }))
    };
}

module.exports = {
    detectManifestType,
    validateChunkManifest,
    validateFileManifest,
    parseManifest,
    getAllChunks,
    getFileChunks,
    calculateDownloadSize,
    createChunkManifest
};

