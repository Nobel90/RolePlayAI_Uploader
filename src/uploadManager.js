// uploadManager.js
// Upload orchestration logic

const fs = require('fs').promises;
const path = require('path');
const { R2Uploader } = require('./r2Uploader');
const { detectDelta } = require('./deltaDetector');
const { parseManifest } = require('./manifestUtils');

/**
 * Derive bucket name from base bucket name and build type
 * If bucket name ends with base name (e.g., "vrcentre-roleplay-ai-bucket"), append -prod or -staging
 * Otherwise, use bucket name as-is
 */
function deriveBucketName(baseBucketName, buildType) {
    const baseName = 'vrcentre-roleplay-ai-bucket';
    
    // If bucket name is exactly the base name, append build type suffix
    if (baseBucketName === baseName) {
        return `${baseBucketName}-${buildType === 'production' ? 'prod' : 'staging'}`;
    }
    
    // If bucket already has -prod or -staging suffix, use as-is
    if (baseBucketName.endsWith('-prod') || baseBucketName.endsWith('-staging')) {
        return baseBucketName;
    }
    
    // Otherwise, append build type suffix
    return `${baseBucketName}-${buildType === 'production' ? 'prod' : 'staging'}`;
}

/**
 * Upload manager class
 */
class UploadManager {
    constructor(r2Config) {
        this.uploader = new R2Uploader(r2Config);
        this.isPaused = false;
        this.pauseResumePromise = null;
        this.pauseResolve = null;
    }
    
    /**
     * Pause the upload
     */
    pause() {
        this.isPaused = true;
        // Create a promise that will be resolved when resume is called
        this.pauseResumePromise = new Promise((resolve) => {
            this.pauseResolve = resolve;
        });
    }
    
    /**
     * Resume the upload
     */
    resume() {
        this.isPaused = false;
        if (this.pauseResolve) {
            this.pauseResolve();
            this.pauseResolve = null;
            this.pauseResumePromise = null;
        }
    }
    
    /**
     * Wait if paused
     */
    async waitIfPaused() {
        if (this.isPaused && this.pauseResumePromise) {
            await this.pauseResumePromise;
        }
    }
    
    /**
     * Upload chunks and manifest to R2
     */
    async upload(options, onProgress = null) {
        const {
            newManifestPath,
            oldManifestPath = null,
            mode = 'delta', // 'delta' or 'full'
            chunksDir,
            version,
            buildType: providedBuildType = 'production'
        } = options;
        
        // Read new manifest
        const newManifestData = await fs.readFile(newManifestPath, 'utf-8');
        const newManifest = JSON.parse(newManifestData);
        
        // Determine buildType: use manifest's buildType if present, otherwise use provided
        let buildType = newManifest.buildType || providedBuildType;
        
        // Warn if mismatch
        if (newManifest.buildType && newManifest.buildType !== providedBuildType) {
            console.warn(`Warning: Manifest buildType (${newManifest.buildType}) doesn't match provided buildType (${providedBuildType}). Using manifest buildType.`);
        }
        
        // Ensure buildType is set in manifest
        if (!newManifest.buildType) {
            newManifest.buildType = buildType;
        }
        
        let chunksToUpload = [];
        let filesToUpload = [];
        
        if (mode === 'delta' && oldManifestPath) {
            // Delta upload: only upload changed chunks
            if (onProgress) {
                onProgress({ percentage: 0, message: 'Detecting changes...' });
            }
            
            const oldManifestData = await fs.readFile(oldManifestPath, 'utf-8');
            const oldManifest = JSON.parse(oldManifestData);
            
            // Verify build types match for delta comparison
            if (oldManifest.buildType && oldManifest.buildType !== buildType) {
                throw new Error(`Cannot compare manifests: old manifest is ${oldManifest.buildType} but new manifest is ${buildType}. Delta comparison only works within the same build type.`);
            }
            
            const delta = detectDelta(oldManifestData, newManifestData);
            
            chunksToUpload = delta.chunksToUploadDetails;
            filesToUpload = [...delta.newFiles, ...delta.changedFiles];
            
            if (onProgress) {
                onProgress({ 
                    percentage: 5, 
                    message: `Found ${chunksToUpload.length} chunks to upload (${delta.stats.newFilesCount} new, ${delta.stats.changedFilesCount} changed files)` 
                });
            }
        } else {
            // Full upload: upload all chunks
            if (onProgress) {
                onProgress({ percentage: 0, message: 'Preparing full upload...' });
            }
            
            const { getAllChunks } = require('./manifestUtils');
            chunksToUpload = getAllChunks(newManifest);
            filesToUpload = newManifest.files;
            
            if (onProgress) {
                onProgress({ 
                    percentage: 5, 
                    message: `Uploading all ${chunksToUpload.length} chunks` 
                });
            }
        }
        
        // Upload chunks
        const totalChunks = chunksToUpload.length;
        let uploadedChunks = 0;
        let skippedChunks = 0;
        let skippedChunksDetails = [];
        let failedChunks = 0;
        
        for (let i = 0; i < chunksToUpload.length; i++) {
            // Check if paused before processing each chunk
            await this.waitIfPaused();
            
            // Check again after waiting (in case it was paused)
            if (this.isPaused) {
                await this.waitIfPaused();
            }
            
            const chunk = chunksToUpload[i];
            const hashPrefix = chunk.hash.substring(0, 2);
            const chunkPath = path.join(chunksDir, hashPrefix, chunk.hash);
            
            try {
                // Check if chunk file exists
                try {
                    await fs.access(chunkPath);
                } catch {
                    throw new Error(`Chunk file not found: ${chunkPath}`);
                }
                
                const result = await this.uploader.uploadChunk(
                    chunk.hash,
                    chunkPath,
                    version,
                    buildType,
                    (progress) => {
                        if (progress.skipped) {
                            skippedChunks++;
                            if (progress.chunkHash) {
                                skippedChunksDetails.push({
                                    hash: progress.chunkHash,
                                    reason: progress.reason || 'already_exists',
                                    key: progress.key
                                });
                            }
                        }
                    }
                );
                
                if (!result.skipped) {
                    uploadedChunks++;
                }
                
                if (onProgress) {
                    const percentage = 5 + ((i + 1) / totalChunks) * 80;
                    const statusMessage = this.isPaused ? ' (Paused)' : '';
                    onProgress({ 
                        percentage, 
                        message: `Uploading chunks: ${i + 1}/${totalChunks} (${uploadedChunks} uploaded, ${skippedChunks} skipped)${statusMessage}` 
                    });
                }
            } catch (error) {
                const errorMessage = error.message || error.toString();
                console.error(`Failed to upload chunk ${chunk.hash}:`, error);
                console.error(`Bucket: ${this.uploader.config.bucket}, Key: ${buildType}/${version}/chunks/${chunk.hash.substring(0, 2)}/${chunk.hash}`);
                failedChunks++;
                
                if (onProgress) {
                    onProgress({ 
                        percentage: 5 + ((i + 1) / totalChunks) * 80, 
                        message: `Error uploading chunk ${chunk.hash.substring(0, 8)}...: ${errorMessage}`,
                        error: true
                    });
                }
            }
        }
        
        // Upload manifest (manifest URLs will be updated by uploadManifest)
        if (onProgress) {
            onProgress({ percentage: 85, message: 'Uploading manifest...' });
        }
        
        await this.uploader.uploadManifest(newManifestPath, version, buildType, onProgress);
        
        // Upload version file
        if (onProgress) {
            onProgress({ percentage: 90, message: 'Uploading version file...' });
        }
        
        const versionPath = path.join(path.dirname(newManifestPath), 'version.json');
        if (await fs.access(versionPath).then(() => true).catch(() => false)) {
            await this.uploader.uploadVersion(versionPath, version, buildType, onProgress);
        }
        
        if (onProgress) {
            onProgress({ percentage: 100, message: 'Upload complete!' });
        }
        
        return {
            success: true,
            stats: {
                totalChunks,
                uploadedChunks,
                skippedChunks,
                skippedChunksDetails,
                failedChunks,
                filesProcessed: filesToUpload.length
            }
        };
    }
}

module.exports = { UploadManager, deriveBucketName };

