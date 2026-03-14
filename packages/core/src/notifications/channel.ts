export interface NotificationChannel {
  send(message: string): Promise<void>;
  isAvailable(): boolean;
}
