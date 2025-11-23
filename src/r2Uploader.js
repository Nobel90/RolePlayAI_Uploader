// r2Uploader.js
// R2 upload client using AWS SDK for Cloudflare R2

const { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;
const path = require('path');

/**
 * R2 Uploader class
 */
class R2Uploader {
    constructor(config) {
        this.config = {
            bucket: config.bucket,
            endpoint: config.endpoint,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            region: 'auto' // R2 uses 'auto' as region
        };
        
        this.client = new S3Client({
            region: this.config.region,
            endpoint: this.config.endpoint,
            forcePathStyle: true, // Required for R2 - use path-style addressing
            credentials: {
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey
            }
        });
    }
    
    /**
     * Test R2 connection and verify bucket access
     */
    async testConnection() {
        try {
            // First, try to list objects (limited to 1) - tests read permission
            const listCommand = new ListObjectsV2Command({
                Bucket: this.config.bucket,
                MaxKeys: 1
            });
            
            await this.client.send(listCommand);
            
            // Try to upload a small test object to verify write permission
            try {
                const testKey = '__test_write_permission__';
                const testCommand = new PutObjectCommand({
                    Bucket: this.config.bucket,
                    Key: testKey,
                    Body: Buffer.from('test')
                });
                
                await this.client.send(testCommand);
                
                // Clean up test object
                try {
                    const deleteCommand = new DeleteObjectCommand({
                        Bucket: this.config.bucket,
                        Key: testKey
                    });
                    await this.client.send(deleteCommand);
                } catch (deleteError) {
                    // Ignore cleanup errors
                    console.warn('Could not delete test object:', deleteError);
                }
                
                return { 
                    success: true, 
                    message: `Connection successful! Bucket "${this.config.bucket}" is accessible with read and write permissions.` 
                };
            } catch (writeError) {
                if (writeError.$metadata?.httpStatusCode === 403) {
                    return {
                        success: false,
                        message: `Bucket "${this.config.bucket}" exists but write access is denied (403). Please verify your credentials have write permissions.`,
                        error: 'WritePermissionDenied',
                        httpStatusCode: 403
                    };
                }
                throw writeError;
            }
        } catch (error) {
            let detailedMessage = error.message || 'Connection failed';
            
            if (error.$metadata?.httpStatusCode === 403) {
                detailedMessage = 
                    `Access denied (403) for bucket "${this.config.bucket}". ` +
                    `Please verify:\n` +
                    `1. Bucket name is correct: "${this.config.bucket}"\n` +
                    `2. Access Key ID and Secret Access Key are correct\n` +
                    `3. The credentials have read/write permissions for this bucket\n` +
                    `4. The bucket exists in your R2 account\n` +
                    `5. The endpoint URL is correct: "${this.config.endpoint}"`;
            } else if (error.$metadata?.httpStatusCode === 404) {
                detailedMessage = 
                    `Bucket not found (404): "${this.config.bucket}". ` +
                    `Please verify:\n` +
                    `1. The bucket name is correct\n` +
                    `2. The bucket exists in your R2 account\n` +
                    `3. You're using the correct R2 endpoint`;
            }
            
            return { 
                success: false, 
                message: detailedMessage,
                error: error.name || 'UnknownError',
                httpStatusCode: error.$metadata?.httpStatusCode
            };
        }
    }
    
    /**
     * Check if object exists in R2
     */
    async objectExists(key) {
        try {
            const command = new HeadObjectCommand({
                Bucket: this.config.bucket,
                Key: key
            });
            
            await this.client.send(command);
            return true;
        } catch (error) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw error;
        }
    }
    
    /**
     * Upload a file to R2
     */
    async uploadFile(localPath, r2Key, onProgress = null) {
        try {
            const fileData = await fs.readFile(localPath);
            
            // Log configuration for debugging (without sensitive data)
            console.log(`[R2Uploader] Uploading to bucket: ${this.config.bucket}, key: ${r2Key}, size: ${fileData.length} bytes`);
            console.log(`[R2Uploader] Endpoint: ${this.config.endpoint}`);
            console.log(`[R2Uploader] Using path-style addressing: true`);
            
            const command = new PutObjectCommand({
                Bucket: this.config.bucket,
                Key: r2Key,
                Body: fileData
            });
            
            await this.client.send(command);
            
            if (onProgress) {
                onProgress({
                    key: r2Key,
                    size: fileData.length,
                    uploaded: true
                });
            }
            
            return {
                success: true,
                key: r2Key,
                size: fileData.length
            };
        } catch (error) {
            // Log full error details for debugging
            console.error(`[R2Uploader] Upload failed for key: ${r2Key}`);
            console.error(`[R2Uploader] Bucket: ${this.config.bucket}`);
            console.error(`[R2Uploader] Endpoint: ${this.config.endpoint}`);
            console.error(`[R2Uploader] Error details:`, {
                name: error.name,
                message: error.message,
                httpStatusCode: error.$metadata?.httpStatusCode,
                requestId: error.$metadata?.requestId,
                cfId: error.$metadata?.cfId
            });
            
            // Provide better error messages for common issues
            if (error.$metadata?.httpStatusCode === 403) {
                const errorDetails = [
                    `Access denied (403) uploading to bucket "${this.config.bucket}"`,
                    ``,
                    `Key: ${r2Key}`,
                    `Endpoint: ${this.config.endpoint}`,
                    ``,
                    `Please verify:`,
                    `1. Bucket name is correct: ${this.config.bucket}`,
                    `2. Access Key ID and Secret Access Key are correct`,
                    `3. The credentials have write permissions for this bucket`,
                    `4. The bucket exists in your R2 account`,
                    `5. The R2 API token has "Object Write" permission`,
                    ``,
                    `Original error: ${error.message}`
                ].join('\n');
                throw new Error(errorDetails);
            } else if (error.$metadata?.httpStatusCode === 404) {
                throw new Error(
                    `Bucket not found (404): "${this.config.bucket}". ` +
                    `Please verify the bucket name is correct and exists in your R2 account.`
                );
            }
            throw error;
        }
    }
    
    /**
     * Upload buffer to R2
     */
    async uploadBuffer(buffer, r2Key, onProgress = null) {
        try {
            const command = new PutObjectCommand({
                Bucket: this.config.bucket,
                Key: r2Key,
                Body: buffer
            });
            
            await this.client.send(command);
            
            if (onProgress) {
                onProgress({
                    key: r2Key,
                    size: buffer.length,
                    uploaded: true
                });
            }
            
            return {
                success: true,
                key: r2Key,
                size: buffer.length
            };
        } catch (error) {
            // Provide better error messages for common issues
            if (error.$metadata?.httpStatusCode === 403) {
                throw new Error(
                    `Access denied (403) uploading to bucket "${this.config.bucket}". ` +
                    `Please verify:\n` +
                    `1. Bucket name is correct: ${this.config.bucket}\n` +
                    `2. Access Key ID and Secret Access Key are correct\n` +
                    `3. The credentials have write permissions for this bucket\n` +
                    `4. The bucket exists in your R2 account\n` +
                    `Original error: ${error.message}`
                );
            } else if (error.$metadata?.httpStatusCode === 404) {
                throw new Error(
                    `Bucket not found (404): "${this.config.bucket}". ` +
                    `Please verify the bucket name is correct and exists in your R2 account.`
                );
            }
            throw error;
        }
    }
    
    /**
     * Upload chunk to R2
     * Chunks are stored as: [buildType]/[version]/chunks/[hash-prefix]/[hash]
     */
    async uploadChunk(chunkHash, chunkPath, version, buildType = 'production', onProgress = null) {
        const hashPrefix = chunkHash.substring(0, 2);
        const r2Key = `${buildType}/${version}/chunks/${hashPrefix}/${chunkHash}`;
        
        // Check if chunk already exists
        const exists = await this.objectExists(r2Key);
        if (exists) {
            if (onProgress) {
                onProgress({
                    key: r2Key,
                    skipped: true,
                    message: `Chunk ${chunkHash.substring(0, 8)}... already exists in R2 (deduplication)`,
                    chunkHash: chunkHash,
                    reason: 'already_exists'
                });
            }
            console.log(`[R2Uploader] Skipped chunk ${chunkHash.substring(0, 16)}... - already exists at ${r2Key}`);
            return { success: true, key: r2Key, skipped: true, reason: 'already_exists', chunkHash };
        }
        
        return await this.uploadFile(chunkPath, r2Key, onProgress);
    }
    
    /**
     * Upload manifest to R2
     * Manifests are stored as:
     * - [buildType]/[version]/manifest.json (version-specific)
     * - [buildType]/roleplayai_manifest.json (build-specific latest)
     */
    async uploadManifest(manifestPath, version, buildType = 'production', onProgress = null) {
        const manifestData = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestData);
        
        // Ensure buildType is in manifest
        if (!manifest.buildType) {
            manifest.buildType = buildType;
        }
        
        // Update chunk URLs to include buildType in path
        manifest.files.forEach(file => {
            file.chunks.forEach(chunk => {
                const hashPrefix = chunk.hash.substring(0, 2);
                chunk.url = `${buildType}/${version}/chunks/${hashPrefix}/${chunk.hash}`;
            });
        });
        
        // Re-serialize with buildType
        const updatedManifestData = JSON.stringify(manifest, null, 2);
        
        // Upload version-specific manifest
        const versionKey = `${buildType}/${version}/manifest.json`;
        await this.uploadBuffer(
            Buffer.from(updatedManifestData, 'utf-8'),
            versionKey,
            onProgress
        );
        
        // Upload build-specific latest manifest
        const latestKey = `${buildType}/roleplayai_manifest.json`;
        await this.uploadBuffer(
            Buffer.from(updatedManifestData, 'utf-8'),
            latestKey,
            onProgress
        );
        
        return {
            success: true,
            versionKey,
            latestKey
        };
    }
    
    /**
     * Upload version file to R2
     */
    async uploadVersion(versionPath, version, buildType = 'production', onProgress = null) {
        const versionKey = `${buildType}/${version}/version.json`;
        return await this.uploadFile(versionPath, versionKey, onProgress);
    }
    
    /**
     * Get R2 URL for a key (for manifest URLs)
     * Note: This is the R2 endpoint URL, not a public URL
     * Public URLs would need to be configured via Cloudflare
     */
    getR2Url(key) {
        // For now, return the R2 endpoint URL
        // In production, you might want to use a Cloudflare public URL
        return `${this.config.endpoint}/${this.config.bucket}/${key}`;
    }
    
    /**
     * Verify manifest against R2 bucket - check if all chunks exist
     */
    async verifyManifest(manifest, buildType = 'production', onProgress = null) {
        const { getAllChunks } = require('./manifestUtils');
        const allChunks = getAllChunks(manifest);
        const version = manifest.version;
        
        const results = {
            totalChunks: allChunks.length,
            existingChunks: [],
            missingChunks: [],
            totalSize: 0,
            existingSize: 0,
            missingSize: 0
        };
        
        console.log(`[R2Uploader] Verifying ${allChunks.length} chunks for version ${version}, buildType ${buildType}`);
        
        if (onProgress) {
            onProgress({ percentage: 0, message: `Starting verification of ${allChunks.length} chunks...` });
        }
        
        for (let i = 0; i < allChunks.length; i++) {
            const chunk = allChunks[i];
            const hashPrefix = chunk.hash.substring(0, 2);
            const r2Key = `${buildType}/${version}/chunks/${hashPrefix}/${chunk.hash}`;
            
            // Report progress
            if (onProgress) {
                const percentage = ((i + 1) / allChunks.length) * 100;
                onProgress({ 
                    percentage, 
                    message: `Checking chunk ${i + 1}/${allChunks.length}: ${chunk.hash.substring(0, 8)}...`,
                    currentChunk: i + 1,
                    totalChunks: allChunks.length,
                    chunkHash: chunk.hash
                });
            }
            
            const exists = await this.objectExists(r2Key);
            results.totalSize += chunk.size;
            
            if (exists) {
                results.existingChunks.push({
                    hash: chunk.hash,
                    size: chunk.size,
                    key: r2Key
                });
                results.existingSize += chunk.size;
                
                if (onProgress) {
                    onProgress({ 
                        percentage: ((i + 1) / allChunks.length) * 100,
                        message: `✓ Chunk ${i + 1}/${allChunks.length} exists (${results.existingChunks.length} found, ${results.missingChunks.length} missing)`,
                        chunkStatus: 'exists'
                    });
                }
            } else {
                results.missingChunks.push({
                    hash: chunk.hash,
                    size: chunk.size,
                    key: r2Key
                });
                results.missingSize += chunk.size;
                
                if (onProgress) {
                    onProgress({ 
                        percentage: ((i + 1) / allChunks.length) * 100,
                        message: `✗ Chunk ${i + 1}/${allChunks.length} missing: ${chunk.hash.substring(0, 16)}...`,
                        chunkStatus: 'missing',
                        chunkHash: chunk.hash
                    });
                }
            }
        }
        
        results.verificationComplete = true;
        results.allChunksExist = results.missingChunks.length === 0;
        
        if (onProgress) {
            onProgress({ 
                percentage: 100, 
                message: `Verification complete! ${results.existingChunks.length} found, ${results.missingChunks.length} missing` 
            });
        }
        
        return results;
    }
    
    /**
     * List all available versions in R2 for a given build type
     * @param {string} buildType - Build type (production/staging)
     * @returns {Promise<{versions: string[], currentVersion: string|null}>} Object with versions array and current version
     */
    async listVersions(buildType = 'production') {
        try {
            const versions = new Set();
            let continuationToken = undefined;
            
            do {
                const listCommand = new ListObjectsV2Command({
                    Bucket: this.config.bucket,
                    Prefix: `${buildType}/`,
                    Delimiter: '/'
                });
                
                const response = await this.client.send(listCommand);
                
                // Process common prefixes (version folders)
                if (response.CommonPrefixes && response.CommonPrefixes.length > 0) {
                    console.log(`[R2Uploader] Found ${response.CommonPrefixes.length} common prefixes`);
                    for (const prefix of response.CommonPrefixes) {
                        // Extract version from prefix like "production/1.0.1.4/"
                        const prefixStr = prefix.Prefix || prefix;
                        const match = prefixStr.match(new RegExp(`${buildType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/`));
                        if (match && match[1]) {
                            const version = match[1];
                            // Skip if it's not a version folder (e.g., "roleplayai_manifest.json" would be in Contents, not CommonPrefixes)
                            if (version === 'roleplayai_manifest.json') {
                                continue;
                            }
                            // Verify manifest exists for this version
                            const manifestKey = `${buildType}/${version}/manifest.json`;
                            const manifestExists = await this.objectExists(manifestKey);
                            if (manifestExists) {
                                versions.add(version);
                                console.log(`[R2Uploader] Found version: ${version}`);
                            } else {
                                console.log(`[R2Uploader] Version ${version} found but manifest doesn't exist`);
                            }
                        } else {
                            console.log(`[R2Uploader] Could not extract version from prefix: ${prefixStr}`);
                        }
                    }
                } else {
                    console.log('[R2Uploader] No common prefixes found in response');
                    // Fallback: try to list Contents and extract versions from keys
                    if (response.Contents && response.Contents.length > 0) {
                        console.log(`[R2Uploader] Trying fallback: checking ${response.Contents.length} objects`);
                        for (const obj of response.Contents) {
                            const key = obj.Key;
                            // Match pattern: production/version/manifest.json
                            const match = key.match(new RegExp(`${buildType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/manifest\\.json$`));
                            if (match && match[1]) {
                                const version = match[1];
                                versions.add(version);
                                console.log(`[R2Uploader] Found version from Contents: ${version}`);
                            }
                        }
                    }
                }
                
                continuationToken = response.NextContinuationToken;
            } while (continuationToken);
            
            // Sort versions (simple string sort, can be improved with semver parsing)
            const sortedVersions = Array.from(versions).sort((a, b) => {
                // Try to parse as version numbers for better sorting
                const aParts = a.split('.').map(Number);
                const bParts = b.split('.').map(Number);
                for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                    const aPart = aParts[i] || 0;
                    const bPart = bParts[i] || 0;
                    if (aPart !== bPart) {
                        return bPart - aPart; // Descending order (newest first)
                    }
                }
                return b.localeCompare(a); // Fallback to string comparison
            });
            
            // Try to get the current/latest version from the latest manifest
            let currentVersion = null;
            try {
                const latestKey = `${buildType}/roleplayai_manifest.json`;
                const latestExists = await this.objectExists(latestKey);
                if (latestExists) {
                    const latestManifest = await this.getManifest(null, buildType, latestKey);
                    if (latestManifest && latestManifest.version) {
                        currentVersion = latestManifest.version;
                    }
                }
            } catch (error) {
                // If latest manifest doesn't exist or can't be read, that's okay
                console.log('[R2Uploader] Could not determine current version:', error.message);
            }
            
            return {
                versions: sortedVersions,
                currentVersion: currentVersion
            };
        } catch (error) {
            console.error('[R2Uploader] Error listing versions:', error);
            throw new Error(`Failed to list versions: ${error.message}`);
        }
    }
    
    /**
     * Get manifest from R2 for a specific version
     * @param {string} version - Version string (e.g., "1.0.1.4") or null to use custom key
     * @param {string} buildType - Build type (production/staging)
     * @param {string} customKey - Optional custom key (used when version is null, e.g., for latest manifest)
     * @returns {Promise<Object>} Parsed manifest object
     */
    async getManifest(version, buildType = 'production', customKey = null) {
        try {
            const manifestKey = customKey || `${buildType}/${version}/manifest.json`;
            
            const getCommand = new GetObjectCommand({
                Bucket: this.config.bucket,
                Key: manifestKey
            });
            
            const response = await this.client.send(getCommand);
            
            // Read the stream
            const chunks = [];
            for await (const chunk of response.Body) {
                chunks.push(chunk);
            }
            
            const manifestData = Buffer.concat(chunks).toString('utf-8');
            const manifest = JSON.parse(manifestData);
            
            return manifest;
        } catch (error) {
            if (error.$metadata?.httpStatusCode === 404) {
                const keyInfo = customKey || `${buildType}/${version}/manifest.json`;
                throw new Error(`Manifest not found: ${keyInfo}`);
            }
            console.error('[R2Uploader] Error getting manifest:', error);
            throw new Error(`Failed to get manifest: ${error.message}`);
        }
    }
    
    /**
     * Promote a version as the current/latest version
     * Downloads manifest, verifies chunks, updates URLs, and uploads as latest manifest
     * @param {string} version - Version string to promote
     * @param {string} buildType - Build type (production/staging)
     * @param {Function} onProgress - Progress callback
     * @param {Object} localManifest - Optional local manifest object (if provided, skips R2 fetch)
     * @returns {Promise<Object>} Result object with success status
     */
    async promoteVersion(version, buildType = 'production', onProgress = null, localManifest = null) {
        try {
            let manifest;
            
            if (localManifest) {
                // Use provided local manifest
                if (onProgress) {
                    onProgress({ percentage: 0, message: `Using local manifest for version ${version}...` });
                }
                manifest = localManifest;
                // Ensure version matches
                if (manifest.version !== version) {
                    console.warn(`[R2Uploader] Local manifest version (${manifest.version}) differs from specified version (${version}). Using specified version.`);
                    manifest.version = version;
                }
            } else {
                // Get manifest from R2
                if (onProgress) {
                    onProgress({ percentage: 0, message: `Fetching manifest for version ${version}...` });
                }
                manifest = await this.getManifest(version, buildType);
            }
            
            if (onProgress) {
                onProgress({ percentage: 10, message: `Verifying all chunks exist in R2...` });
            }
            
            // Verify all chunks exist
            const verificationResult = await this.verifyManifest(manifest, buildType, (progress) => {
                if (onProgress) {
                    // Map verification progress to 10-80% of total progress
                    const mappedProgress = 10 + (progress.percentage * 0.7);
                    onProgress({ 
                        percentage: mappedProgress, 
                        message: progress.message 
                    });
                }
            });
            
            if (!verificationResult.allChunksExist) {
                throw new Error(
                    `Cannot promote version ${version}: ${verificationResult.missingChunks.length} chunks are missing in R2. ` +
                    `Please ensure all chunks are uploaded before promoting.`
                );
            }
            
            if (onProgress) {
                onProgress({ percentage: 80, message: `Updating chunk URLs and preparing manifest...` });
            }
            
            // Ensure buildType is set
            manifest.buildType = buildType;
            
            // Update chunk URLs to point to the correct version
            manifest.files.forEach(file => {
                file.chunks.forEach(chunk => {
                    const hashPrefix = chunk.hash.substring(0, 2);
                    chunk.url = `${buildType}/${version}/chunks/${hashPrefix}/${chunk.hash}`;
                });
            });
            
            // Serialize updated manifest
            const updatedManifestData = JSON.stringify(manifest, null, 2);
            
            if (onProgress) {
                onProgress({ percentage: 90, message: `Uploading as latest manifest...` });
            }
            
            // Upload as latest manifest
            const latestKey = `${buildType}/roleplayai_manifest.json`;
            await this.uploadBuffer(
                Buffer.from(updatedManifestData, 'utf-8'),
                latestKey,
                (progress) => {
                    if (onProgress) {
                        onProgress({ 
                            percentage: 90 + (progress.uploaded ? 10 : 0), 
                            message: `Uploading latest manifest...` 
                        });
                    }
                }
            );
            
            if (onProgress) {
                onProgress({ percentage: 100, message: `Version ${version} successfully promoted as latest!` });
            }
            
            return {
                success: true,
                version: version,
                buildType: buildType,
                latestKey: latestKey,
                totalChunks: verificationResult.totalChunks,
                message: `Version ${version} has been promoted as the latest ${buildType} version.`
            };
        } catch (error) {
            console.error('[R2Uploader] Error promoting version:', error);
            if (onProgress) {
                onProgress({ percentage: 0, message: `Error: ${error.message}`, error: true });
            }
            throw error;
        }
    }
}

module.exports = { R2Uploader };

