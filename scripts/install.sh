#!/usr/bin/env bash
set -euo pipefail

# Stark-Trading Install Script (Linux / macOS / WSL)

STARK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_RC=""

echo "==================================="
echo "  Stark-Trading Installer"
echo "==================================="
echo ""

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
echo "  Run: source $SHELL_RC"
echo "  Then: stark --help"
echo ""
echo "  Data directory: $STARK_DATA_DIR"
echo "  Config file:    $STARK_DATA_DIR/config.json (created on first run)"
echo "  Database:       $STARK_DATA_DIR/stark.db (created on first run)"
echo ""
