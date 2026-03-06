#!/usr/bin/env bash
set -euo pipefail

# Stark-Trading Uninstall Script (Linux / macOS / WSL)
# Removes: shell alias + data directory (~/.stark/)
# Keeps:   source code repo intact

STARK_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==================================="
echo "  Stark-Trading Uninstaller"
echo "==================================="
echo ""

# Step 1: Remove shell alias

REMOVED_ALIAS=false
for rc_file in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"; do
  if [ -f "$rc_file" ] && grep -qF "alias stark=" "$rc_file"; then
    sed -i.bak '/# Stark-Trading CLI/d' "$rc_file"
    sed -i.bak '/alias stark=/d' "$rc_file"
    rm -f "${rc_file}.bak"
    echo "[OK] Removed 'stark' alias from $rc_file"
    REMOVED_ALIAS=true
  fi
done

if [ "$REMOVED_ALIAS" = false ]; then
  echo "[--] No 'stark' alias found in shell config files."
fi

# Step 2: Remove data directory

echo ""
STARK_DATA_DIR="$HOME/.stark"

if [ -d "$STARK_DATA_DIR" ]; then
  echo "Data directory found: $STARK_DATA_DIR"
  echo "Contents:"
  du -sh "$STARK_DATA_DIR" 2>/dev/null || true
  echo ""
  read -rp "Delete $STARK_DATA_DIR? This removes your database, config, and logs. (y/N) " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    rm -rf "$STARK_DATA_DIR"
    echo "[OK] Removed $STARK_DATA_DIR"
  else
    echo "[--] Kept $STARK_DATA_DIR"
  fi
else
  echo "[--] No data directory found at $STARK_DATA_DIR"
fi

# Done

echo ""
echo "==================================="
echo "  Uninstall complete."
echo "==================================="
echo ""
echo "  Removed: shell alias + data directory"
echo "  Kept:    source code at $STARK_DIR"
echo ""
echo "  Restart your shell or run:"
echo "    source ~/.bashrc  (or ~/.zshrc)"
echo ""
echo "  To reinstall later: bash $STARK_DIR/scripts/install.sh"
echo ""
