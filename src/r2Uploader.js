// r2Uploader.js
// R2 upload client using AWS SDK for Cloudflare R2

const { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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
}

module.exports = { R2Uploader };

