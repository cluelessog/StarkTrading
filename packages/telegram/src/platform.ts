export interface IncomingMessage {
  chatId: number;
  text: string;
  messageId: number;
  fromId: number;
  fromName: string;
}

export interface MessagePlatform {
  start(): Promise<void>;
  stop(): void;
  sendMessage(chatId: number, text: string, parseMode?: string): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}
