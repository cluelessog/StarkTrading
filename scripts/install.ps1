# Stark-Trading Install Script (Windows PowerShell)
# Run: powershell -ExecutionPolicy Bypass -File scripts\install.ps1

$ErrorActionPreference = "Stop"
$StarkDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "  Stark-Trading Installer (Windows)" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# -- Step 1: Check/Install Bun --------------------------------------------------

$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
if ($bunCmd) {
    $bunVersion = & bun --version
    Write-Host "[OK] Bun found: $bunVersion" -ForegroundColor Green
} else {
    Write-Host "[..] Bun not found. Installing..." -ForegroundColor Yellow
    try {
        Invoke-RestMethod bun.sh/install.ps1 | Invoke-Expression
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $bunVersion = & bun --version
        Write-Host "[OK] Bun installed: $bunVersion" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Bun installation failed. Install manually: https://bun.sh" -ForegroundColor Red
        exit 1
    }
}

# -- Step 2: Install dependencies -----------------------------------------------

Write-Host ""
Write-Host "[..] Installing dependencies..." -ForegroundColor Yellow
Push-Location $StarkDir
try {
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & bun install 2>&1 | Out-Host
    $bunExit = $LASTEXITCODE
    $ErrorActionPreference = $prevPref
    if ($bunExit -ne 0) {
        Write-Host "[..] Retrying without lockfile..." -ForegroundColor Yellow
        $ErrorActionPreference = "Continue"
        & bun install --no-frozen-lockfile 2>&1 | Out-Host
        $bunExit = $LASTEXITCODE
        $ErrorActionPreference = $prevPref
        if ($bunExit -ne 0) {
            throw "bun install failed with exit code $bunExit"
        }
    }
    Write-Host "[OK] Dependencies installed." -ForegroundColor Green
} finally {
    Pop-Location
}

# -- Step 3: Verify CLI works ---------------------------------------------------

Write-Host ""
Write-Host "[..] Verifying CLI..." -ForegroundColor Yellow
$cliPath = Join-Path $StarkDir "packages\cli\bin\stark.ts"
$version = & bun run $cliPath --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] CLI works: $version" -ForegroundColor Green
} else {
    Write-Host "[ERROR] CLI verification failed." -ForegroundColor Red
    exit 1
}

# -- Step 4: Create PowerShell function/alias -----------------------------------

Write-Host ""

# Create or update PowerShell profile
$profileDir = Split-Path -Parent $PROFILE
if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}
if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force | Out-Null
}

$functionBlock = @"

# Stark-Trading CLI
function stark { & bun run "$cliPath" @args }
"@

$profileContent = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
if ($profileContent -and $profileContent.Contains("function stark")) {
    # Update existing
    $profileContent = $profileContent -replace '(?m)# Stark-Trading CLI\r?\nfunction stark \{[^\}]+\}', $functionBlock.Trim()
    Set-Content -Path $PROFILE -Value $profileContent
    Write-Host "[OK] Updated 'stark' function in $PROFILE" -ForegroundColor Green
} else {
    Add-Content -Path $PROFILE -Value $functionBlock
    Write-Host "[OK] Added 'stark' function to $PROFILE" -ForegroundColor Green
}

# -- Step 5: Initialize data directory ------------------------------------------

Write-Host ""
$starkDataDir = Join-Path $env:USERPROFILE ".stark"
if (-not (Test-Path $starkDataDir)) {
    New-Item -ItemType Directory -Path $starkDataDir -Force | Out-Null
    Write-Host "[OK] Created data directory: $starkDataDir" -ForegroundColor Green
} else {
    Write-Host "[OK] Data directory exists: $starkDataDir" -ForegroundColor Green
}

# -- Done -----------------------------------------------------------------------

Write-Host ""
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "  Installation complete!" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Restart PowerShell, then run: stark --help"
Write-Host ""
Write-Host "  Data directory: $starkDataDir"
Write-Host "  Config file:    $starkDataDir\config.json (created on first run)"
Write-Host "  Database:       $starkDataDir\stark.db (created on first run)"
Write-Host ""
