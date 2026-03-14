import type { MessagePlatform } from './platform.js';
import { TelegramPlatform } from './telegram-platform.js';

export function createPlatform(
  type: 'telegram',
  config: { botToken: string; allowedChatIds: number[] },
): MessagePlatform {
  if (type === 'telegram') return new TelegramPlatform(config.botToken, config.allowedChatIds);
  throw new Error(`Unknown platform: ${type}`);
}
