/**
 * afterAllArtifactBuild Hook Script
 * Signs all portable artifacts (portable exe)
 * Updates latest.yml with correct SHA512 checksum after signing
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { signFileWithToken } = require('../sign-utils');

/**
 * Wait for a file to be available (not locked by another process)
 * @param {string} filePath - Path to the file
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delayMs - Delay between retries in milliseconds
 * @returns {Promise<void>}
 */
function waitForFileAvailable(filePath, maxRetries = 10, delayMs = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const checkFile = () => {
      attempts++;
      
      // Try to open the file in write mode to check if it's locked
      fs.open(filePath, 'r+', (err, fd) => {
        if (err) {
          if (err.code === 'EBUSY' || err.code === 'EACCES') {
            // File is locked, retry
            if (attempts < maxRetries) {
              console.log(`[Signing] File is locked, waiting ${delayMs}ms before retry (${attempts}/${maxRetries})...`);
              setTimeout(checkFile, delayMs);
            } else {
              reject(new Error(`File is still locked after ${maxRetries} attempts: ${filePath}`));
            }
          } else {
            // Other error, reject immediately
            reject(err);
          }
        } else {
          // File is available, close it and resolve
          fs.close(fd, () => resolve());
        }
      });
    };
    
    checkFile();
  });
}

/**
 * Update latest.yml with new SHA512 checksum and size after signing
 * @param {string} distDir - Directory containing latest.yml
 * @param {string} portablePath - Path to the signed portable exe
 */
function updateLatestYml(distDir, portablePath) {
  const yamlPath = path.join(distDir, 'latest.yml');
  const fileName = path.basename(portablePath);

  if (!fs.existsSync(yamlPath)) {
    console.log('⚠ latest.yml not found, skipping update.');
    return;
  }

  console.log(`\n[Manifest Update] Updating latest.yml for ${fileName}...`);

  // Calculate new SHA512 hash and size of signed portable exe
  const fileContent = fs.readFileSync(portablePath);
  const newSha512 = crypto.createHash('sha512').update(fileContent).digest('base64');
  const newSize = fs.statSync(portablePath).size;

  let yamlContent = fs.readFileSync(yamlPath, 'utf8');
  
  // Find and update SHA512 checksum
  // Pattern: sha512: <hash>
  const sha512Regex = new RegExp(`(sha512:\\s*)([A-Za-z0-9+/=]+)`, 'g');
  const sha512Match = yamlContent.match(sha512Regex);
  
  if (sha512Match) {
    // Replace all SHA512 values (there might be multiple entries)
    yamlContent = yamlContent.replace(sha512Regex, `$1${newSha512}`);
    console.log(`[Manifest Update] Updated SHA512 checksum`);
  } else {
    console.warn(`[Manifest Update] Could not find sha512 field in latest.yml`);
  }
  
  // Find and update file size
  // Pattern: size: <number>
  const sizeRegex = /(size:\s*)(\d+)/g;
  const sizeMatch = yamlContent.match(sizeRegex);
  
  if (sizeMatch) {
    yamlContent = yamlContent.replace(sizeRegex, `$1${newSize}`);
    console.log(`[Manifest Update] Updated size: ${newSize} bytes`);
  } else {
    console.warn(`[Manifest Update] Could not find size field in latest.yml`);
  }
  
  // Write updated content back
  fs.writeFileSync(yamlPath, yamlContent);
  console.log(`[Manifest Update] Successfully updated latest.yml\n`);
}

module.exports = async function (context) {
  console.log('\n=== AfterAllArtifactBuild Hook: Signing Portable Artifacts ===');
  
  // Get artifact paths from context
  const artifactPaths = context.artifactPaths || [];
  
  if (artifactPaths.length === 0) {
    console.warn('⚠ No artifacts found in context');
    return;
  }

  // Check for certificate
  const certificateSha1 = process.env.WIN_CERTIFICATE_SHA1;
  if (!certificateSha1) {
    throw new Error('❌ BUILD FAILED: WIN_CERTIFICATE_SHA1 environment variable must be set');
  }

  const timestampServer = process.env.WIN_TIMESTAMP_SERVER || 'http://timestamp.digicert.com';
  let signedCount = 0;
  let portablePath = null;

  // Loop through artifacts and sign .exe files (portable)
  for (const artifactPath of artifactPaths) {
    if (typeof artifactPath === 'string' && artifactPath.endsWith('.exe')) {
      if (fs.existsSync(artifactPath)) {
        try {
          // Wait for file to be available (not locked by another process)
          console.log(`[Signing] Waiting for file to be available: ${path.basename(artifactPath)}...`);
          await waitForFileAvailable(artifactPath, 15, 1000); // 15 retries, 1 second delay
          
          // Small additional delay to ensure file is fully released
          await new Promise(resolve => setTimeout(resolve, 500));
          
          signFileWithToken(artifactPath, certificateSha1, timestampServer);
          signedCount++;
          portablePath = artifactPath; // Save portable path for latest.yml update
        } catch (error) {
          // Re-throw to fail the build
          throw new Error(`Failed to sign portable artifact ${path.basename(artifactPath)}: ${error.message}`);
        }
      } else {
        console.warn(`⚠ Artifact not found: ${artifactPath}`);
      }
    }
  }

  console.log(`✓ Signed ${signedCount} portable artifact(s)`);

  // Update latest.yml with correct checksum after signing
  if (portablePath) {
    const distDir = path.dirname(portablePath);
    try {
      updateLatestYml(distDir, portablePath);
    } catch (error) {
      console.warn(`⚠ Failed to update latest.yml: ${error.message}`);
      // Don't fail the build if latest.yml update fails, but warn about it
    }
  }

  console.log('');
};


