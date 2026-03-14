#!/bin/bash
# UPS HAT Battery Monitor for Waveshare UPS HAT (B)
# Reads battery level via I2C and triggers clean shutdown at <20%
# Install: sudo cp scripts/ups-monitor.sh /usr/local/bin/
# Systemd timer: see docs/RPI_DEPLOYMENT.md

set -euo pipefail

I2C_BUS=1
I2C_ADDR=0x36
SHUTDOWN_THRESHOLD=20

# Read battery SOC from MAX17040 fuel gauge (register 0x04)
# i2cget returns little-endian 16-bit: low byte = integer %, high byte = fractional
read_battery_percent() {
  local raw
  raw=$(i2cget -y "$I2C_BUS" "$I2C_ADDR" 0x04 w 2>/dev/null) || {
    echo "ERROR: Cannot read I2C device at $I2C_ADDR" >&2
    return 1
  }
  # Low byte of LE word is the integer percentage (0-100)
  local percent=$((raw & 0xFF))
  echo "$percent"
}

BATTERY=$(read_battery_percent) || exit 1

logger -t ups-monitor "Battery: ${BATTERY}%"

if [ "$BATTERY" -lt "$SHUTDOWN_THRESHOLD" ]; then
  logger -t ups-monitor "CRITICAL: Battery at ${BATTERY}% (threshold: ${SHUTDOWN_THRESHOLD}%). Initiating shutdown."
  sudo shutdown -h now "UPS battery low (${BATTERY}%)"
fi
