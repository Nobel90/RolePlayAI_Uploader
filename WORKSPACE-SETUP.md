# Workspace Setup Guide

## Opening the Multi-Root Workspace in Cursor

1. **Open the workspace file:**
   - In Cursor: `File` → `Open Workspace from File...`
   - Navigate to: `D:\Dev\VR Centre\RolePlayAI_Workspace.code-workspace`
   - Click `Open`

2. **Verify both projects are visible:**
   - You should see two folders in the sidebar:
     - `Launcher` (RolePlayAI_Launcher)
     - `Uploader` (RolePlayAI_Uploader)

3. **Working with both projects:**
   - Files from both projects will appear in the file explorer
   - Search works across both projects
   - You can open files from either project in the same window

## Git Operations

### Launcher Repository
- Location: `D:\Dev\VR Centre\RolePlayAI_Launcher`
- Remote: `https://github.com/Nobel90/Role-Play-AI_Launcher.git`
- Work normally: `git add`, `git commit`, `git push`

### Uploader Repository
- Location: `D:\Dev\VR Centre\RolePlayAI_Uploader`
- Remote: `https://github.com/Nobel90/RolePlayAI_Uploader.git`
- Work normally: `git add`, `git commit`, `git push`

### Switching Between Repos
When committing, make sure you're in the correct directory:
- Use the terminal to `cd` into the project you want to work with
- Or use Cursor's integrated terminal which shows the current directory

## Shared Code Management

### Current Approach: Copy Files
- `chunkManager.js` and `manifestUtils.js` are copied to both repos
- When updating shared code:
  1. Update in one repo
  2. Copy to the other repo
  3. Commit changes in both repos

### Files to Keep in Sync
- `chunkManager.js` → `src/chunkManager.js` (uploader)
- `manifestUtils.js` → `src/manifestUtils.js` (uploader)

### Future: npm Package (Optional)
If shared code becomes more complex:
1. Create `RolePlayAI_Shared` package
2. Both repos install: `npm install ../RolePlayAI_Shared`
3. Automatic sync via package updates

## Development Workflow

1. **Open workspace** in Cursor
2. **Work on either project** - files are in the same window
3. **Commit separately** - each repo has its own Git history
4. **Push independently** - separate GitHub repositories

## Benefits

✅ Clean separation of concerns
✅ Independent versioning
✅ Work on both simultaneously
✅ Easy code navigation
✅ No complex Git submodules

