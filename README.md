# RolePlayAI Uploader

Electron application for preparing game packages and uploading them to Cloudflare R2.

## Features

### Tab 1: Package Preparation
- Select source directory (Unreal Engine package output)
- Configure version and chunk sizes
- Generate chunk-based manifests
- Filter out unnecessary files (.pdb, Saved folders, etc.)

### Tab 2: Upload Management
- Compare manifests to detect changes
- Upload only changed files/chunks (delta upload)
- Upload all files (full upload)
- Manage R2 bucket uploads
- Progress tracking and logging

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the application:
```bash
npm start
```

3. Build for distribution:
```bash
npm run dist
```

## Configuration

### R2 Credentials
R2 credentials are pre-filled but can be updated in the Upload Management tab.

**Default Configuration:**
- Bucket: `vrcentre-roleplay-ai-bucket`
- Endpoint: `https://d9f8ae13b4516b91e13fe7a672fe51b9.r2.cloudflarestorage.com`
- Access Key ID: (pre-filled)
- Secret Access Key: (pre-filled)

## Shared Code

This application shares code with the RolePlayAI Launcher:
- `src/chunkManager.js` - Content-Defined Chunking (FastCDC)
- `src/manifestUtils.js` - Manifest utilities

These files are copied from the launcher repository. When updating shared code, ensure both repositories are kept in sync.

## Development

### Project Structure
```
RolePlayAI_Uploader/
├── main.js              # Electron main process
├── preload.js           # Preload script
├── renderer.js          # UI logic
├── index.html           # UI markup
├── package.json         # Dependencies and scripts
├── src/
│   ├── chunkManager.js  # Shared: Chunking logic
│   ├── manifestUtils.js # Shared: Manifest utilities
│   ├── packagePrep.js   # Tab 1: Package preparation
│   ├── uploadManager.js # Tab 2: Upload management
│   ├── deltaDetector.js # Delta comparison logic
│   └── r2Uploader.js    # R2 upload client
└── assets/              # Icons and images
```

## R2 Bucket Structure

The uploader organizes files in R2 with the following structure:

```
vrcentre-roleplay-ai-bucket/
├── roleplayai_manifest.json          # Latest manifest
├── [version]/
│   ├── version.json                  # Version metadata
│   ├── manifest.json                 # Version-specific manifest
│   └── chunks/
│       └── [hash-prefix]/
│           └── [hash]                 # Chunk files
```

## License

ISC - VR Centre Pty Ltd

