# Telegram Bot Setup Guide

## 1. Create Bot via BotFather

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Choose a name (e.g., "Stark Trading Bot")
4. Choose a username (e.g., `stark_trading_bot`) — must end in `bot`
5. BotFather will give you an API token like `123456789:ABCdefGhIjKlMnOpQrStUvWxYz`
6. Save this token securely

## 2. Get Your Chat ID

### Option A: Using @userinfobot
1. Search for `@userinfobot` in Telegram
2. Send `/start`
3. It replies with your user ID (a number like `123456789`)

### Option B: Using the Bot API
1. Send a message to your new bot
2. Open: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat":{"id":123456789}` in the JSON response

## 3. Configure Stark

Add to `~/.stark/config.json`:

```json
{
  "telegram": {
    "botToken": "123456789:ABCdefGhIjKlMnOpQrStUvWxYz",
    "allowedChatIds": [123456789]
  }
}
```

### Security Notes
- `allowedChatIds` is a whitelist — only these chat IDs can interact with the bot
- Add multiple IDs for group chats or additional users
- Messages from unauthorized chats are silently ignored

## 4. Test Connection

```bash
# Start the bot
bun run packages/telegram/bin/stark-telegram.ts

# Send "help" to your bot in Telegram
# You should see a list of available commands
```

## 5. Available Commands

| Command | Description |
|---------|-------------|
| `score SYMBOL` | Score a stock (e.g., "score RELIANCE") |
| `focus` | Show focus list |
| `heat` | Portfolio heat |
| `trades` / `open trades` | List open trades |
| `market` | Market overview |
| `morning` | Run morning workflow |
| `evening` | Run evening workflow |
| `sync` | Sync broker positions |
| `help` | List all commands |

Natural language is also supported (e.g., "how's INFY looking?" or "what's my portfolio heat?").

## 6. Running as a Service

See [RPI_DEPLOYMENT.md](./RPI_DEPLOYMENT.md) for systemd service setup.
