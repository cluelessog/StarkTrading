#!/usr/bin/env bash
set -euo pipefail

# Stark-Trading Install Script (Linux / macOS / WSL)

STARK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_RC=""

echo "==================================="
echo "  Stark-Trading Installer"
echo "==================================="
echo ""

# ── Pre-check: Symlink support ────────────────────────────────────────────

TEST_LINK="$STARK_DIR/.symlink-test-$$"
if ! ln -s "$STARK_DIR/package.json" "$TEST_LINK" 2>/dev/null; then
  echo "[!!] This filesystem does not support symlinks (likely exFAT)."
  echo "     Package managers require symlinks to install dependencies."
  echo ""

  # Detect NTFS C: drive on WSL
  if [ -d "/mnt/c" ]; then
    NEW_DIR="/mnt/c/Projects/SteveTrading"
    echo "     Auto-copying project to $NEW_DIR (NTFS)..."
    mkdir -p "$(dirname "$NEW_DIR")"
    if [ -d "$NEW_DIR" ]; then
      echo "[!!] $NEW_DIR already exists. Remove it first or install manually."
      exit 1
    fi
    rsync -a --exclude='.claude' --exclude='.omc' --exclude='node_modules' "$STARK_DIR/" "$NEW_DIR/"
    echo "[OK] Copied to $NEW_DIR"
    echo ""
    echo "     Restarting install from NTFS location..."
    echo ""
    exec bash "$NEW_DIR/scripts/install.sh"
  else
    echo "[ERROR] No NTFS drive found. Move this project to an NTFS filesystem."
    exit 1
  fi
else
  rm -f "$TEST_LINK"
fi

# ── Step 1: Check/Install Bun ──────────────────────────────────────────────

if command -v bun &>/dev/null; then
  echo "[OK] Bun found: $(bun --version)"
else
  echo "[..] Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun &>/dev/null; then
    echo "[ERROR] Bun installation failed. Install manually: https://bun.sh"
    exit 1
  fi
  echo "[OK] Bun installed: $(bun --version)"
fi

# ── Step 2: Install dependencies ───────────────────────────────────────────

echo ""
echo "[..] Installing dependencies..."
cd "$STARK_DIR"
bun install --frozen-lockfile 2>/dev/null || bun install
echo "[OK] Dependencies installed."

# ── Step 3: Verify CLI works ───────────────────────────────────────────────

echo ""
echo "[..] Verifying CLI..."
if bun run "$STARK_DIR/packages/cli/bin/stark.ts" --version &>/dev/null; then
  echo "[OK] CLI works: $(bun run "$STARK_DIR/packages/cli/bin/stark.ts" --version)"
else
  echo "[ERROR] CLI verification failed."
  exit 1
fi

# ── Step 4: Create shell alias ─────────────────────────────────────────────

echo ""

# Detect shell config file
if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "${SHELL:-}")" = "zsh" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  SHELL_RC="$HOME/.bash_profile"
else
  SHELL_RC="$HOME/.bashrc"
fi

ALIAS_LINE="alias stark='bun run $STARK_DIR/packages/cli/bin/stark.ts'"

if grep -qF "alias stark=" "$SHELL_RC" 2>/dev/null; then
  # Update existing alias
  sed -i.bak "/alias stark=/c\\$ALIAS_LINE" "$SHELL_RC"
  rm -f "${SHELL_RC}.bak"
  echo "[OK] Updated existing 'stark' alias in $SHELL_RC"
else
  echo "" >> "$SHELL_RC"
  echo "# Stark-Trading CLI" >> "$SHELL_RC"
  echo "$ALIAS_LINE" >> "$SHELL_RC"
  echo "[OK] Added 'stark' alias to $SHELL_RC"
fi

# ── Step 4b: Create Windows access (if WSL) ──────────────────────────────

if grep -qi microsoft /proc/version 2>/dev/null; then
  # Convert WSL path to Windows path for the CLI entry point
  WIN_STARK_DIR="$(wslpath -w "$STARK_DIR")"
  WIN_CLI="$WIN_STARK_DIR\\packages\\cli\\bin\\stark.ts"

  # Create stark.cmd for CMD / PowerShell
  STARK_CMD="/mnt/c/Windows/stark.cmd"
  echo "@echo off" > "$STARK_CMD"
  echo "bun run \"$WIN_CLI\" %*" >> "$STARK_CMD"
  echo "[OK] Created stark.cmd for Windows CMD/PowerShell (C:\\Windows\\stark.cmd)"

  # Add PowerShell function to Windows $PROFILE
  WIN_USER="$(cmd.exe /C "echo %USERPROFILE%" 2>/dev/null | tr -d '\r')"
  if [ -n "$WIN_USER" ]; then
    PS_PROFILE_DIR="$(wslpath "$WIN_USER")/Documents/PowerShell"
    PS_PROFILE="$PS_PROFILE_DIR/Microsoft.PowerShell_profile.ps1"
    mkdir -p "$PS_PROFILE_DIR" 2>/dev/null
    PS_FUNC="function stark { & bun run \"$WIN_CLI\" @args }"
    if [ -f "$PS_PROFILE" ] && grep -qF "function stark" "$PS_PROFILE" 2>/dev/null; then
      sed -i.bak '/# Stark-Trading CLI/d; /function stark/d' "$PS_PROFILE"
      rm -f "${PS_PROFILE}.bak"
    fi
    echo "" >> "$PS_PROFILE"
    echo "# Stark-Trading CLI" >> "$PS_PROFILE"
    echo "$PS_FUNC" >> "$PS_PROFILE"
    echo "[OK] Added 'stark' function to PowerShell profile"
  fi
fi

# ── Step 5: Initialize config ─────────────────────────────────────────────

echo ""
STARK_DATA_DIR="$HOME/.stark"
if [ ! -d "$STARK_DATA_DIR" ]; then
  mkdir -p "$STARK_DATA_DIR"
  echo "[OK] Created data directory: $STARK_DATA_DIR"
else
  echo "[OK] Data directory exists: $STARK_DATA_DIR"
fi

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
echo "==================================="
echo "  Installation complete!"
echo "==================================="
echo ""
echo "  WSL:        source $SHELL_RC && stark --help"
if grep -qi microsoft /proc/version 2>/dev/null; then
echo "  PowerShell: Restart PowerShell, then: stark --help"
echo "  CMD:        stark --help (works immediately)"
fi
echo ""
echo "  Data directory: $STARK_DATA_DIR"
echo "  Config file:    $STARK_DATA_DIR/config.json (created on first run)"
echo "  Database:       $STARK_DATA_DIR/stark.db (created on first run)"
echo ""
