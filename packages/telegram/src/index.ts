import type { MessagePlatform } from './platform.js';
import type { PersistentCommandContext } from '@stark/cli/utils/command-context.js';
import { NLU } from './nlu.js';
import { TelegramFormatter } from './formatter.js';
import { ChatSessionManager } from './session.js';
import { createToolRegistry } from './executor.js';
import { logger } from '@stark/core/log/index.js';

export interface BotOptions {
  platform: MessagePlatform;
  ctx: PersistentCommandContext;
}

export async function startBot(options: BotOptions): Promise<void> {
  const { platform, ctx } = options;

  const registry = createToolRegistry(ctx);
  const nlu = new NLU(registry, ctx.llmService);
  const formatter = new TelegramFormatter();
  const sessions = new ChatSessionManager(ctx.queries);

  platform.onMessage(async (msg) => {
    const chatIdStr = String(msg.chatId);

    // Ensure auth is fresh
    try {
      await ctx.refreshAuth();
    } catch (err) {
      logger.warn('bot', 'auth_refresh_failed', `Auth refresh failed: ${(err as Error).message}`);
    }

    // Record incoming message
    sessions.recordMessage(msg.chatId, 'user', msg.text);

    // Get history for context
    const history = sessions.getHistory(msg.chatId);

    // Parse intent
    let intent;
    try {
      intent = await nlu.parse(msg.text, chatIdStr, history);
    } catch (err) {
      logger.error('bot', 'nlu_error', `NLU error: ${(err as Error).message}`);
      await platform.sendMessage(msg.chatId, 'Sorry, I could not understand that. Try `help` for available commands.');
      return;
    }

    if (intent.command === 'unknown') {
      const reply = "I didn't understand that. Type `help` to see what I can do.";
      await platform.sendMessage(msg.chatId, reply);
      sessions.recordMessage(msg.chatId, 'assistant', reply);
      sessions.cleanup(msg.chatId);
      return;
    }

    // Execute tool
    const tool = registry.get(intent.command);
    if (!tool) {
      const reply = `Unknown command: ${intent.command}. Type \`help\` for available commands.`;
      await platform.sendMessage(msg.chatId, reply);
      sessions.recordMessage(msg.chatId, 'assistant', reply);
      return;
    }

    let reply: string;
    try {
      const result = await tool.execute(intent.args, ctx);
      reply = formatter.format(intent.command, result);
    } catch (err) {
      logger.error('bot', 'tool_error', `Tool error [${intent.command}]: ${(err as Error).message}`);
      reply = `Error running ${intent.command}: ${(err as Error).message}`;
    }

    try {
      await platform.sendMessage(msg.chatId, reply, 'MarkdownV2');
    } catch {
      // MarkdownV2 parse error — fall back to plain text
      try {
        await platform.sendMessage(msg.chatId, reply.replace(/[\\*_[\]()~`>#+\-=|{}.!]/g, ''));
      } catch (sendErr) {
        logger.error('bot', 'send_error', `Send error: ${(sendErr as Error).message}`);
      }
    }

    sessions.recordMessage(msg.chatId, 'assistant', reply);
    sessions.cleanup(msg.chatId);
  });

  logger.info('bot', 'start', 'Telegram bot started');
  await platform.start();
}
