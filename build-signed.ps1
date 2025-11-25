# build-signed.ps1
# Script to build and sign the Electron Uploader app with a Sectigo USB Token

# 1. Check for the Certificate Thumbprint Environment Variable
if (-not $env:WIN_CERTIFICATE_SHA1) {
    Write-Host "⚠️  WIN_CERTIFICATE_SHA1 environment variable is not set." -ForegroundColor Yellow
    $certThumbprint = Read-Host "Please enter your Sectigo Certificate Thumbprint (SHA1)"
    
    if (-not $certThumbprint) {
        Write-Host "❌ Error: Thumbprint is required to sign the app." -ForegroundColor Red
        exit 1
    }
    
    # Set the variable for this session
    $env:WIN_CERTIFICATE_SHA1 = $certThumbprint
    Write-Host "✅ Certificate Thumbprint set for this session." -ForegroundColor Green
} else {
    Write-Host "✅ Using existing Certificate Thumbprint." -ForegroundColor Green
}

# 2. Reminder for Hardware
Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " IMPORTANT: Ensure your Sectigo USB Token is plugged in" -ForegroundColor Cyan
Write-Host " and the SafeNet Client is 'Ready'." -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 3. Build
Write-Host "`n🚀 Starting Build Process..." -ForegroundColor Magenta

try {
    # Run the npm build command
    # cmd /c ensures npm is executed correctly
    cmd /c "npm run dist"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ Build Success!" -ForegroundColor Green
        
        # Verify if the output file exists
        $exeFiles = Get-ChildItem "dist" -Filter "*.exe" | Where-Object { $_.Name -like "*portable*" }
        if ($exeFiles) {
             Write-Host "Created: $($exeFiles.Name)" -ForegroundColor Cyan
        }
    } else {
        throw "Build command failed with exit code $LASTEXITCODE"
    }
}
catch {
    Write-Host "`n❌ BUILD FAILED!" -ForegroundColor Red
    Write-Host "Error details: $_" -ForegroundColor Red
    exit 1
}


