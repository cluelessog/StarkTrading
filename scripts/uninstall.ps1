# Stark-Trading Uninstall Script (Windows PowerShell)
# Run: powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
# Removes: PowerShell function + data directory (%USERPROFILE%\.stark\)
# Keeps:   source code repo intact

$ErrorActionPreference = "Stop"
$StarkDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "  Stark-Trading Uninstaller" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Remove PowerShell function

if (Test-Path $PROFILE) {
    $content = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains("function stark")) {
        $content = $content -replace '(?m)\r?\n# Stark-Trading CLI\r?\nfunction stark \{[^\}]+\}\r?\n?', ''
        Set-Content -Path $PROFILE -Value $content.TrimEnd()
        Write-Host "[OK] Removed 'stark' function from $PROFILE" -ForegroundColor Green
    } else {
        Write-Host "[--] No 'stark' function found in $PROFILE" -ForegroundColor Gray
    }
} else {
    Write-Host "[--] No PowerShell profile found." -ForegroundColor Gray
}

# Step 2: Remove data directory

Write-Host ""
$starkDataDir = Join-Path $env:USERPROFILE ".stark"

if (Test-Path $starkDataDir) {
    $size = (Get-ChildItem $starkDataDir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $sizeMB = [math]::Round($size / 1MB, 2)
    Write-Host "Data directory found: $starkDataDir ($sizeMB MB)" -ForegroundColor Yellow

    $confirm = Read-Host "Delete $starkDataDir? This removes your database, config, and logs. (y/N)"
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        Remove-Item -Path $starkDataDir -Recurse -Force
        Write-Host "[OK] Removed $starkDataDir" -ForegroundColor Green
    } else {
        Write-Host "[--] Kept $starkDataDir" -ForegroundColor Gray
    }
} else {
    Write-Host "[--] No data directory found at $starkDataDir" -ForegroundColor Gray
}

# Done

Write-Host ""
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "  Uninstall complete." -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Removed: PowerShell function + data directory"
Write-Host "  Kept:    source code at $StarkDir"
Write-Host ""
Write-Host "  Restart PowerShell to clear the 'stark' function."
Write-Host ""
Write-Host "  To reinstall later:"
Write-Host "    powershell -ExecutionPolicy Bypass -File $StarkDir\scripts\install.ps1"
Write-Host ""
