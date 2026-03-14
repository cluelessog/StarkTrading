import type { Queries } from '@stark/core/db/queries.js';

const PLATFORM = 'telegram';
const HISTORY_LIMIT = 20;
const TRIM_TO = 50;

export class ChatSessionManager {
  constructor(private queries: Queries) {}

  recordMessage(chatId: number, role: 'user' | 'assistant', message: string): void {
    this.queries.insertChatMessage(String(chatId), PLATFORM, role, message);
  }

  getHistory(chatId: number): Array<{ role: string; message: string }> {
    return this.queries.getRecentChatMessages(String(chatId), HISTORY_LIMIT);
  }

  cleanup(chatId: number): void {
    this.queries.trimChatHistory(String(chatId), TRIM_TO);
  }
}
