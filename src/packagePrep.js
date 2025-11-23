// packagePrep.js
// Package preparation logic for generating chunk-based manifests

const fs = require('fs').promises;
const path = require('path');
const { ChunkManager } = require('./chunkManager');
const { createChunkManifest } = require('./manifestUtils');

/**
 * Filter out non-essential files (same as launcher)
 */
function shouldIncludeFile(relativePath, filters = {}) {
    const fileName = path.basename(relativePath);
    const pathString = relativePath.toLowerCase();
    const fileExt = path.extname(fileName).toLowerCase();
    
    // Exclude Saved folders
    if (filters.excludeSaved) {
        if (pathString.includes('saved/') || pathString.includes('saved\\')) {
            return false;
        }
    }
    
    // Exclude .pdb files
    if (filters.excludePdb && fileExt === '.pdb') {
        return false;
    }
    
    // Exclude manifest files
    const isManifest = fileName.toLowerCase().startsWith('manifest_') && fileName.toLowerCase().endsWith('.txt');
    const isVersionJson = fileName.toLowerCase() === 'version.json';
    const isLauncher = fileName.toLowerCase() === 'roleplayai_launcher.exe';
    const isVrClassroomTxt = fileName.toLowerCase() === 'roleplayai.txt';
    
    return !(isManifest || isVersionJson || isLauncher || isVrClassroomTxt);
}

/**
 * Recursively get all files from directory
 */
async function getAllFiles(dir) {
    const files = [];
    
    async function walkDir(currentPath) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const relativePath = path.relative(dir, fullPath);
            
            if (entry.isDirectory()) {
                await walkDir(fullPath);
            } else {
                files.push({ fullPath, relativePath });
            }
        }
    }
    
    await walkDir(dir);
    return files;
}

/**
 * Generate chunk-based manifest from source directory
 */
async function generateManifest(options, onProgress = null) {
    const {
        sourceDir,
        outputDir,
        version,
        buildType = 'production', // Default to production
        chunkSizes = {
            min: 5 * 1024 * 1024,   // 5MB
            avg: 10 * 1024 * 1024,  // 10MB
            max: 20 * 1024 * 1024   // 20MB
        },
        filters = {
            excludePdb: true,
            excludeSaved: true
        }
    } = options;
    
    // Validate inputs
    if (!sourceDir || !outputDir || !version) {
        throw new Error('Missing required options: sourceDir, outputDir, version');
    }
    
    // Validate build type
    if (buildType !== 'production' && buildType !== 'staging') {
        throw new Error('Invalid buildType. Must be "production" or "staging"');
    }
    
    // Check if source directory exists
    try {
        await fs.access(sourceDir);
    } catch (error) {
        throw new Error(`Source directory not found: ${sourceDir}`);
    }
    
    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });
    
    // Create chunks directory
    const chunksDir = path.join(outputDir, 'chunks');
    await fs.mkdir(chunksDir, { recursive: true });
    
    // Initialize chunk manager
    const chunkManager = new ChunkManager({
        chunkCacheDir: chunksDir,
        fastCDCOptions: {
            minSize: chunkSizes.min,
            avgSize: chunkSizes.avg,
            maxSize: chunkSizes.max
        }
    });
    await chunkManager.initialize();
    
    // Get all files
    if (onProgress) {
        onProgress({ percentage: 0, message: 'Scanning files...' });
    }
    
    const allFiles = await getAllFiles(sourceDir);
    const filesToProcess = allFiles.filter(({ relativePath }) => 
        shouldIncludeFile(relativePath, filters)
    );
    
    if (filesToProcess.length === 0) {
        throw new Error('No files found to process');
    }
    
    if (onProgress) {
        onProgress({ percentage: 5, message: `Found ${filesToProcess.length} files to process` });
    }
    
    // Process each file
    const processedFiles = [];
    let totalChunks = 0;
    let totalSize = 0;
    const uniqueChunks = new Set();
    
    for (let i = 0; i < filesToProcess.length; i++) {
        const { fullPath, relativePath } = filesToProcess[i];
        
        try {
            const stats = await fs.stat(fullPath);
            const fileSize = stats.size;
            
            if (onProgress) {
                const percentage = 5 + ((i / filesToProcess.length) * 85);
                onProgress({ 
                    percentage, 
                    message: `Processing ${relativePath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)` 
                });
            }
            
            // Chunk the file
            const chunks = await chunkManager.fastCDC.chunkFile(fullPath);
            
            // Process chunks
            const fileChunks = [];
            let offset = 0;
            
            for (const chunk of chunks) {
                // Store chunk (deduplication happens automatically)
                if (!uniqueChunks.has(chunk.hash)) {
                    await chunkManager.storeChunk(chunk.hash, chunk.data);
                    uniqueChunks.add(chunk.hash);
                }
                
                // Create chunk entry for manifest
                // URL will be set later based on R2 bucket structure
                fileChunks.push({
                    hash: chunk.hash,
                    size: chunk.size,
                    offset: offset
                });
                
                offset += chunk.size;
            }
            
            processedFiles.push({
                filename: relativePath.replace(/\\/g, '/'),
                totalSize: fileSize,
                chunks: fileChunks
            });
            
            totalChunks += chunks.length;
            totalSize += fileSize;
            
        } catch (error) {
            console.error(`Error processing file ${relativePath}:`, error);
            // Continue with other files
        }
    }
    
    // Create manifest
    if (onProgress) {
        onProgress({ percentage: 90, message: 'Creating manifest...' });
    }
    
    const manifest = createChunkManifest(version, processedFiles);
    
    // Add build type to manifest
    manifest.buildType = buildType;
    
    // Save manifest with build type in filename
    const manifestPath = path.join(outputDir, `manifest_${buildType}_${version}.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    
    // Save version file
    const versionPath = path.join(outputDir, 'version.json');
    await fs.writeFile(versionPath, JSON.stringify({ version }, null, 2), 'utf-8');
    
    if (onProgress) {
        onProgress({ percentage: 100, message: 'Manifest generation complete!' });
    }
    
    return {
        success: true,
        manifestPath,
        versionPath,
        chunksDir,
        buildType,
        stats: {
            filesProcessed: processedFiles.length,
            totalChunks,
            uniqueChunks: uniqueChunks.size,
            totalSize,
            deduplicationRatio: totalChunks > 0 ? (uniqueChunks.size / totalChunks).toFixed(2) : 0
        }
    };
}

module.exports = {
    generateManifest,
    shouldIncludeFile,
    getAllFiles
};

