/**
 * afterSign Hook Script
 * Signs the main application executable after electron-builder processes it
 * This ensures the icon is preserved (handled by signAndEditExecutable) and then the exe is signed
 */

const path = require('path');
const fs = require('fs');
const { signFileWithToken } = require('../sign-utils');

module.exports = async function (context) {
  console.log('\n=== AfterSign Hook: Signing Application Executable ===');
  
  // Get the app output directory
  const appOutDir = context.appOutDir || context.outDir;
  if (!appOutDir) {
    throw new Error('❌ BUILD FAILED: appOutDir not found in context');
  }

  // Find the main executable (portable exe name)
  const mainExePath = path.join(appOutDir, 'Role-Play-AI-Uploader.exe');
  
  if (!fs.existsSync(mainExePath)) {
    throw new Error(`❌ BUILD FAILED: Main executable not found at ${mainExePath}`);
  }

  // Check for certificate
  const certificateSha1 = process.env.WIN_CERTIFICATE_SHA1;
  if (!certificateSha1) {
    throw new Error('❌ BUILD FAILED: WIN_CERTIFICATE_SHA1 environment variable must be set');
  }

  // Sign the main executable
  const timestampServer = process.env.WIN_TIMESTAMP_SERVER || 'http://timestamp.digicert.com';
  signFileWithToken(mainExePath, certificateSha1, timestampServer);
  
  console.log('✓ Application executable signed successfully\n');
};


