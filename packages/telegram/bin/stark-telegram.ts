#!/usr/bin/env bun

import { loadConfig } from '@stark/core/config/index.js';
import { createPersistentCommandContext } from '@stark/cli/utils/command-context.js';
import { TelegramPlatform } from '../src/telegram-platform.js';
import { startBot } from '../src/index.js';
import { logger, generateRunId } from '@stark/core/log/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.init({ consoleLevel: 'INFO' });
  logger.setRunId(generateRunId());

  if (!config.telegram?.botToken) {
    console.error('Error: config.telegram.botToken is not set in ~/.stark/config.json');
    process.exit(1);
  }

  const ctx = await createPersistentCommandContext();
  const platform = new TelegramPlatform(
    config.telegram.botToken,
    config.telegram.allowedChatIds ?? [],
  );

  const shutdown = (): void => {
    logger.info('bot', 'shutdown', 'Shutting down...');
    platform.stop();
    ctx.dispose();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await startBot({ platform, ctx });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
