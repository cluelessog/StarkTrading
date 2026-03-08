# Stark-Trading Install Script (Windows PowerShell)
# Run: powershell -ExecutionPolicy Bypass -File scripts\install.ps1

$ErrorActionPreference = 'Stop'
$StarkDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host '===================================' -ForegroundColor Cyan
Write-Host '  Stark-Trading Installer (Windows)' -ForegroundColor Cyan
Write-Host '===================================' -ForegroundColor Cyan
Write-Host ''

# -- Pre-check: Filesystem -------------------------------------------------------

$driveLetter = (Resolve-Path $StarkDir).Drive.Name
$driveInfo = Get-WmiObject Win32_Volume -Filter "DriveLetter='${driveLetter}:'" -ErrorAction SilentlyContinue
if ($driveInfo -and $driveInfo.FileSystem -ne 'NTFS') {
    Write-Host "[!!] Drive ${driveLetter}: is $($driveInfo.FileSystem), not NTFS." -ForegroundColor Red
    Write-Host '     Package managers require NTFS for symlinks.' -ForegroundColor Yellow
    Write-Host ''
    $newDir = Join-Path 'C:\Projects' 'SteveTrading'
    Write-Host "     Auto-copying project to $newDir (NTFS)..." -ForegroundColor Yellow
    if (Test-Path $newDir) {
        Write-Host "[!!] $newDir already exists. Remove it first or install manually." -ForegroundColor Red
        exit 1
    }
    $parentDir = Split-Path -Parent $newDir
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    # Use robocopy to skip locked/session files (.claude, .omc, node_modules)
    & robocopy $StarkDir $newDir /E /XD .claude .omc node_modules /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    Write-Host "[OK] Copied to $newDir" -ForegroundColor Green
    Write-Host ''
    Write-Host '     Restarting install from NTFS location...' -ForegroundColor Yellow
    Write-Host ''
    $newScript = Join-Path $newDir 'scripts\install.ps1'
    & powershell -ExecutionPolicy Bypass -File $newScript
    exit $LASTEXITCODE
}

# -- Step 1: Check/Install Bun --------------------------------------------------

$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
if ($bunCmd) {
    $bunVersion = & bun --version
    Write-Host "[OK] Bun found: $bunVersion" -ForegroundColor Green
} else {
    Write-Host '[..] Bun not found. Installing...' -ForegroundColor Yellow
    try {
        Invoke-RestMethod bun.sh/install.ps1 | Invoke-Expression
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
        $bunVersion = & bun --version
        Write-Host "[OK] Bun installed: $bunVersion" -ForegroundColor Green
    } catch {
        Write-Host '[ERROR] Bun installation failed. Install manually: https://bun.sh' -ForegroundColor Red
        exit 1
    }
}

# -- Step 2: Install dependencies -----------------------------------------------

Write-Host ''
Write-Host '[..] Installing dependencies...' -ForegroundColor Yellow
Push-Location $StarkDir
try {
    # Clean stale state that conflicts between Linux/Windows
    $lockFile = Join-Path $StarkDir 'bun.lock'
    if (Test-Path $lockFile) {
        Remove-Item $lockFile -Force
        Write-Host '[..] Removed stale lockfile' -ForegroundColor Yellow
    }

    # Remove existing node_modules to avoid EISDIR conflicts
    # Use cmd rmdir which handles deep nested paths better on Windows
    foreach ($nmDir in @(
        (Join-Path $StarkDir 'node_modules'),
        (Join-Path $StarkDir 'packages\core\node_modules'),
        (Join-Path $StarkDir 'packages\cli\node_modules')
    )) {
        if (Test-Path $nmDir) {
            Write-Host "[..] Removing $nmDir ..." -ForegroundColor Yellow
            & cmd /c "rmdir /s /q `"$nmDir`"" 2>$null
            if (Test-Path $nmDir) {
                Remove-Item $nmDir -Recurse -Force -ErrorAction SilentlyContinue
            }
            if (Test-Path $nmDir) {
                Write-Host "[!!] Could not fully remove $nmDir - delete it manually and retry" -ForegroundColor Red
                throw 'Failed to clean node_modules'
            }
        }
    }
    Write-Host '[OK] Clean slate for install.' -ForegroundColor Green

    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & bun install 2>&1 | Out-Host
    $bunExit = $LASTEXITCODE
    $ErrorActionPreference = $prevPref

    if ($bunExit -ne 0) {
        Write-Host '[..] bun install failed (symlink issue). Falling back to pnpm...' -ForegroundColor Yellow

        # Clean node_modules left by failed bun install
        $nmDir = Join-Path $StarkDir 'node_modules'
        if (Test-Path $nmDir) {
            & cmd /c "rmdir /s /q `"$nmDir`"" 2>$null
        }

        $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
        if (-not $pnpmCmd) {
            $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
            if ($npmCmd) {
                Write-Host '[..] Installing pnpm...' -ForegroundColor Yellow
                & npm install -g pnpm 2>&1 | Out-Null
                $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
            } else {
                Write-Host '[ERROR] No fallback package manager available.' -ForegroundColor Red
                Write-Host '     Option 1: Install Node.js from https://nodejs.org then re-run' -ForegroundColor Yellow
                Write-Host '     Option 2: Run this script as Administrator (fixes symlinks for bun)' -ForegroundColor Yellow
                Write-Host '     Option 3: Install from WSL instead: bash scripts/install.sh' -ForegroundColor Yellow
                throw 'No package manager available'
            }
        }
        $prevPref2 = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & pnpm install --node-linker=hoisted 2>&1 | Out-Host
        $pnpmExit = $LASTEXITCODE
        $ErrorActionPreference = $prevPref2
        if ($pnpmExit -ne 0) {
            Write-Host '[ERROR] pnpm install also failed.' -ForegroundColor Red
            Write-Host '     Try: Run as Administrator, or install from WSL: bash scripts/install.sh' -ForegroundColor Yellow
            throw "pnpm install failed with exit code $pnpmExit"
        }
    }
    Write-Host '[OK] Dependencies installed.' -ForegroundColor Green
} finally {
    Pop-Location
}

# -- Step 3: Verify CLI works ---------------------------------------------------

Write-Host ''
Write-Host '[..] Verifying CLI...' -ForegroundColor Yellow
$cliPath = Join-Path $StarkDir 'packages\cli\bin\stark.ts'
$version = & bun run $cliPath --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] CLI works: $version" -ForegroundColor Green
} else {
    Write-Host '[ERROR] CLI verification failed.' -ForegroundColor Red
    exit 1
}

# -- Step 4: Create PowerShell function/alias -----------------------------------

Write-Host ''

$profileDir = Split-Path -Parent $PROFILE
if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}
if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force | Out-Null
}

$starkFunc = 'function stark { & bun run "' + $cliPath + '" @args }'
$funcBlock = "`n# Stark-Trading CLI`n$starkFunc"

$profileContent = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
if ($profileContent -and $profileContent.Contains($starkFunc.Substring(0, 14))) {
    $profileContent = $profileContent -replace '(?m)# Stark-Trading CLI\r?\n.*stark.*\{[^\}]+\}', ('# Stark-Trading CLI' + "`n" + $starkFunc)
    Set-Content -Path $PROFILE -Value $profileContent
    Write-Host "[OK] Updated stark in $PROFILE" -ForegroundColor Green
} else {
    Add-Content -Path $PROFILE -Value $funcBlock
    Write-Host "[OK] Added stark to $PROFILE" -ForegroundColor Green
}

# -- Step 4b: Create CMD access ------------------------------------------------

$starkCmd = 'C:\Windows\stark.cmd'
$cmdContent = "@echo off`r`nbun run `"$cliPath`" %*"
Set-Content -Path $starkCmd -Value $cmdContent -Force -ErrorAction SilentlyContinue
if (Test-Path $starkCmd) {
    Write-Host "[OK] Created $starkCmd (works in CMD immediately)" -ForegroundColor Green
} else {
    Write-Host '[--] Could not create stark.cmd in C:\Windows (needs admin). CMD access skipped.' -ForegroundColor Gray
}

# -- Step 4c: Create WSL access ------------------------------------------------

$wslCmd = Get-Command wsl -ErrorAction SilentlyContinue
if ($wslCmd) {
    $wslStarkDir = & wsl wslpath -u ($StarkDir -replace '\\', '\\')
    $wslAlias = "alias stark='bun run $wslStarkDir/packages/cli/bin/stark.ts'"
    $bashrc = & wsl bash -c 'echo $HOME/.bashrc'
    $hasAlias = & wsl bash -c "grep -qF 'alias stark=' '$bashrc' 2>/dev/null && echo yes || echo no"
    if ($hasAlias.Trim() -eq 'yes') {
        & wsl bash -c "sed -i '/alias stark=/c\$wslAlias' '$bashrc'"
        Write-Host "[OK] Updated 'stark' alias in WSL $bashrc" -ForegroundColor Green
    } else {
        & wsl bash -c "echo '' >> '$bashrc'; echo '# Stark-Trading CLI' >> '$bashrc'; echo `"$wslAlias`" >> '$bashrc'"
        Write-Host "[OK] Added 'stark' alias to WSL $bashrc" -ForegroundColor Green
    }
}

# -- Step 5: Initialize data directory ------------------------------------------

Write-Host ''
$starkDataDir = Join-Path $env:USERPROFILE '.stark'
if (-not (Test-Path $starkDataDir)) {
    New-Item -ItemType Directory -Path $starkDataDir -Force | Out-Null
    Write-Host "[OK] Created data directory: $starkDataDir" -ForegroundColor Green
} else {
    Write-Host "[OK] Data directory exists: $starkDataDir" -ForegroundColor Green
}

# -- Done -----------------------------------------------------------------------

Write-Host ''
Write-Host '===================================' -ForegroundColor Cyan
Write-Host '  Installation complete!' -ForegroundColor Cyan
Write-Host '===================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  PowerShell: Restart PowerShell, then: stark --help'
Write-Host '  CMD:        stark --help (works immediately)'
if ($wslCmd) {
    Write-Host '  WSL:        source ~/.bashrc && stark --help'
}
Write-Host ''
Write-Host "  Data directory: $starkDataDir"
$configPath = Join-Path $starkDataDir 'config.json'
$dbPath = Join-Path $starkDataDir 'stark.db'
Write-Host "  Config file:    $configPath (created on first run)"
Write-Host "  Database:       $dbPath (created on first run)"
Write-Host ''
