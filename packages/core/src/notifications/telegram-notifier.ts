import type { NotificationChannel } from './channel.js';

export class TelegramNotifier implements NotificationChannel {
  constructor(
    private readonly botToken: string,
    private readonly chatIds: number[],
  ) {}

  isAvailable(): boolean {
    return Boolean(this.botToken) && this.chatIds.length > 0;
  }

  async send(message: string): Promise<void> {
    if (!this.isAvailable()) return;

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    for (const chatId of this.chatIds) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message }),
        });
        if (!response.ok) {
          const err = await response.text();
          process.stderr.write(`[TelegramNotifier] sendMessage failed for chatId=${chatId}: ${err}\n`);
        }
      } catch (err) {
        process.stderr.write(`[TelegramNotifier] network error for chatId=${chatId}: ${(err as Error).message}\n`);
      }
    }
  }
}
