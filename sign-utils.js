/**
 * Code Signing Utility Functions
 * Supports USB token signing (Sectigo) via Windows Certificate Store
 * 
 * This module exports reusable signing functions for use in hook scripts.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Find signtool.exe in common locations
 * @returns {string|null} Path to signtool.exe or null if not found
 */
function findSignTool() {
  const possiblePaths = [
    // Windows SDK locations - try to find latest version dynamically
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe',
    'C:\\Program Files\\Windows Kits\\10\\bin\\x64\\signtool.exe',
    // Visual Studio locations
    'C:\\Program Files (x86)\\Microsoft SDKs\\Windows\\v10.0A\\bin\\NETFX 4.8 Tools\\signtool.exe',
    // System PATH
    'signtool.exe'
  ];

  // First, try to find signtool.exe in Windows Kits with versioned folders
  try {
    const kitsPath86 = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
    const kitsPath64 = 'C:\\Program Files\\Windows Kits\\10\\bin';
    
    for (const basePath of [kitsPath86, kitsPath64]) {
      if (fs.existsSync(basePath)) {
        // Look for versioned folders (e.g., 10.0.22621.0)
        const versionDirs = fs.readdirSync(basePath).filter(dir => {
          const fullPath = path.join(basePath, dir);
          return fs.statSync(fullPath).isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(dir);
        }).sort().reverse(); // Sort descending to get latest version first
        
        for (const versionDir of versionDirs) {
          const x64Path = path.join(basePath, versionDir, 'x64', 'signtool.exe');
          if (fs.existsSync(x64Path)) {
            return x64Path;
          }
        }
        
        // Try non-versioned x64 path
        const x64Path = path.join(basePath, 'x64', 'signtool.exe');
        if (fs.existsSync(x64Path)) {
          return x64Path;
        }
      }
    }
  } catch (error) {
    // Continue to other methods
  }

  // Try static paths
  for (const toolPath of possiblePaths) {
    try {
      if (toolPath === 'signtool.exe') {
        // Try to find in PATH using where command
        try {
          const result = execSync('where signtool.exe', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          if (result && result.trim()) {
            return result.trim().split('\n')[0]; // Return first match
          }
        } catch (error) {
          // Not in PATH, continue
        }
      } else if (fs.existsSync(toolPath)) {
        return toolPath;
      }
    } catch (error) {
      continue;
    }
  }

  return null;
}

/**
 * Sign a file using signtool.exe with USB token (certificate thumbprint)
 * @param {string} filePath - Path to the file to sign
 * @param {string} certificateSha1 - SHA1 thumbprint of the certificate on USB token
 * @param {string} timestampServer - Timestamp server URL
 * @throws {Error} If signing fails or file is not found
 */
function signFileWithToken(filePath, certificateSha1, timestampServer = 'http://timestamp.digicert.com') {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Check if certificate thumbprint is provided
  if (!certificateSha1) {
    throw new Error('Certificate SHA1 thumbprint not provided. Set WIN_CERTIFICATE_SHA1 environment variable.');
  }

  // Build signtool command
  const signToolPath = findSignTool();
  if (!signToolPath) {
    throw new Error('signtool.exe not found. Please install Windows SDK.');
  }

  // Use /sha1 to specify certificate by thumbprint (for USB tokens)
  // Use /tr for RFC 3161 timestamping (modern) - don't use /t as it's incompatible with /tr
  const command = `"${signToolPath}" sign /sha1 "${certificateSha1}" /fd sha256 /tr "${timestampServer}" /td sha256 "${filePath}"`;

  console.log(`\n[Signing] ${path.basename(filePath)}`);
  console.log(`[Signing] Full path: ${filePath}`);
  console.log(`[Signing] Using certificate thumbprint: ${certificateSha1.substring(0, 8)}...`);
  console.log(`[Signing] Command: ${command.replace(certificateSha1, certificateSha1.substring(0, 8) + '...')}`);
  
  // CRITICAL: execSync throws if command fails (non-zero exit code)
  // Do not catch - let it throw to fail the build
  execSync(command, { stdio: 'inherit' });
  
  // Verify the signature
  const verifyCommand = `"${signToolPath}" verify /pa "${filePath}"`;
  try {
    execSync(verifyCommand, { stdio: 'pipe' });
    console.log(`✓ Successfully signed and verified: ${path.basename(filePath)}\n`);
  } catch (verifyError) {
    throw new Error(`Signature verification failed for ${path.basename(filePath)}: ${verifyError.message}`);
  }
}

// Export functions for use in hook scripts
module.exports = {
  findSignTool,
  signFileWithToken
};


