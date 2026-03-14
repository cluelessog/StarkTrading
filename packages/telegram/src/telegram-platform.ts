import type { IncomingMessage, MessagePlatform } from './platform.js';

const MAX_MESSAGE_LENGTH = 4096;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    chat: { id: number };
    text?: string;
  };
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

/**
 * Escape special characters for Telegram MarkdownV2 format.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

export class TelegramPlatform implements MessagePlatform {
  private running = false;
  private offset = 0;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private readonly baseUrl: string;

  constructor(
    private readonly botToken: string,
    private readonly allowedChatIds: number[],
  ) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(chatId: number, text: string, parseMode?: string): Promise<void> {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      await this.sendSingleMessage(chatId, text, parseMode);
      return;
    }

    // Split into chunks
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
      remaining = remaining.slice(MAX_MESSAGE_LENGTH);
    }

    for (const chunk of chunks) {
      await this.sendSingleMessage(chatId, chunk, parseMode);
    }
  }

  private async sendSingleMessage(chatId: number, text: string, parseMode?: string): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (parseMode) body.parse_mode = parseMode;

    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Telegram sendMessage failed (${response.status}): ${err}`);
    }
  }

  async start(): Promise<void> {
    this.running = true;
    let backoffMs = 1000;

    while (this.running) {
      try {
        const updates = await this.getUpdates();
        backoffMs = 1000; // reset on success

        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.processUpdate(update);
        }
      } catch {
        if (!this.running) break;
        await this.sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const url = `${this.baseUrl}/getUpdates?timeout=30&offset=${this.offset}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`getUpdates failed (${response.status})`);
    }

    const data = (await response.json()) as TelegramResponse<TelegramUpdate[]>;
    if (!data.ok) {
      throw new Error(`getUpdates error: ${data.description}`);
    }

    return data.result;
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message?.text) return;

    const chatId = update.message.chat.id;

    // Silently ignore unauthorized chats
    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(chatId)) {
      return;
    }

    if (!this.messageHandler) return;

    const from = update.message.from;
    const fromName = from
      ? [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id)
      : 'unknown';

    const incoming: IncomingMessage = {
      chatId,
      text: update.message.text,
      messageId: update.message.message_id,
      fromId: from?.id ?? 0,
      fromName,
    };

    try {
      await this.messageHandler(incoming);
    } catch (err) {
      process.stderr.write(`[telegram] handler error: ${(err as Error).message}\n`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
