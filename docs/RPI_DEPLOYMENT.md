# Raspberry Pi Deployment Guide

Deploy Stark Trading as an always-on system on a Raspberry Pi.

## Hardware Requirements

- **Raspberry Pi 4** (4GB+ RAM recommended)
- **USB SSD** (32GB+) — avoid SD cards for reliability
- **Waveshare UPS HAT (B)** — for clean shutdown on power loss
- **Ethernet or stable WiFi** — for broker API and Telegram

## Software Prerequisites

```bash
# Install Bun (aarch64 Linux supported)
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version

# Install git
sudo apt-get update && sudo apt-get install -y git i2c-tools
```

## Clone and Install

```bash
cd ~
git clone <your-repo-url> stark-trading
cd stark-trading
bun install
```

## Configuration

Create `~/.stark/config.json`:

```json
{
  "angelOne": {
    "apiKey": "YOUR_API_KEY",
    "clientId": "YOUR_CLIENT_ID",
    "totpSecret": "YOUR_TOTP_SECRET"
  },
  "llm": {
    "enabled": true,
    "geminiKey": "YOUR_GEMINI_KEY",
    "cacheResponses": true,
    "cacheTtlHours": 24
  },
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "allowedChatIds": [YOUR_CHAT_ID]
  },
  "scheduler": {
    "eveningTime": "16:30",
    "morningTime": "09:00",
    "syncIntervalMinutes": 30
  },
  "sheetId": "YOUR_MBI_SHEET_ID",
  "nseHolidays": [
    "2026-01-26", "2026-03-14", "2026-03-31",
    "2026-04-06", "2026-04-10", "2026-04-14",
    "2026-05-01", "2026-08-15", "2026-08-27",
    "2026-10-02", "2026-10-20", "2026-10-21",
    "2026-11-05", "2026-12-25"
  ],
  "emThresholds": { "strongBull": 25, "bull": 15, "cautious": 12, "choppy": 9.5 },
  "risk": {
    "swing": { "riskPerTrade": 10000, "totalCapital": 500000, "heatWarning": 0.06, "heatAlert": 0.08 },
    "intraday": { "riskPerTrade": 10000, "totalCapital": 500000, "heatWarning": 0.06, "heatAlert": 0.08 }
  },
  "scoring": {
    "scoreThresholds": { "bull": 8.0, "cautious": 8.5, "choppy": 9.0, "bear": 10.0 },
    "maxFocusStocks": { "strongBull": 5, "bull": 5, "cautious": 3, "choppy": 2, "bear": 0 }
  }
}
```

See [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md) for Telegram bot configuration details.

## Systemd Services

### Telegram Bot Service

```bash
sudo tee /etc/systemd/system/stark-telegram.service << 'EOF'
[Unit]
Description=Stark Trading Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/stark-trading
ExecStart=/home/pi/.bun/bin/bun run packages/telegram/bin/stark-telegram.ts
Restart=always
RestartSec=10
Environment=HOME=/home/pi

[Install]
WantedBy=multi-user.target
EOF
```

### Scheduler (Cron) Service

```bash
sudo tee /etc/systemd/system/stark-cron.service << 'EOF'
[Unit]
Description=Stark Trading Scheduler
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/stark-trading
ExecStart=/home/pi/.bun/bin/bun run packages/cli/bin/stark.ts cron
Restart=always
RestartSec=10
Environment=HOME=/home/pi

[Install]
WantedBy=multi-user.target
EOF
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable stark-telegram stark-cron
sudo systemctl start stark-telegram stark-cron

# Check status
sudo systemctl status stark-telegram
sudo systemctl status stark-cron

# View logs
journalctl -u stark-telegram -f
journalctl -u stark-cron -f
```

## UPS HAT Setup

### Enable I2C

```bash
sudo raspi-config
# Navigate: Interface Options > I2C > Enable

# Verify
i2cdetect -y 1
# Should show device at address 0x36
```

### Install Battery Monitor

```bash
sudo cp scripts/ups-monitor.sh /usr/local/bin/ups-monitor
sudo chmod +x /usr/local/bin/ups-monitor

# Test
sudo /usr/local/bin/ups-monitor
```

### Systemd Timer (runs every 5 minutes)

```bash
sudo tee /etc/systemd/system/ups-monitor.service << 'EOF'
[Unit]
Description=UPS Battery Monitor

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ups-monitor
EOF

sudo tee /etc/systemd/system/ups-monitor.timer << 'EOF'
[Unit]
Description=Check UPS battery every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ups-monitor.timer
sudo systemctl start ups-monitor.timer
```

## Maintenance

### Updating

```bash
cd ~/stark-trading
git pull
bun install
sudo systemctl restart stark-telegram stark-cron
```

### Database Backup

```bash
# SQLite backup (safe while running due to WAL mode)
cp ~/.stark/stark.db ~/.stark/stark.db.backup
```

### Monitoring

```bash
# Service status
sudo systemctl status stark-telegram stark-cron

# Recent logs
journalctl -u stark-telegram --since "1 hour ago"
journalctl -u stark-cron --since "1 hour ago"

# Battery status
sudo /usr/local/bin/ups-monitor
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot not responding | Check `journalctl -u stark-telegram -f` for errors |
| Auth failures | Verify `~/.stark/config.json` has correct Angel One credentials |
| Scheduler not firing | Check timezone: `timedatectl` should show Asia/Kolkata |
| Database locked | Restart services: `sudo systemctl restart stark-telegram stark-cron` |
| I2C not working | Run `sudo raspi-config` and enable I2C interface |
| Bun not found | Ensure `~/.bun/bin` is in PATH for the service user |
