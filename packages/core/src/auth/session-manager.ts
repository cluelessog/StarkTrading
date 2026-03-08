import { createHmac } from 'node:crypto';
import type { DataProvider } from '../api/data-provider.js';
import type { StarkConfig } from '../config/index.js';

/**
 * Generate TOTP per RFC 6238 (30-second window, SHA1, 6 digits)
 */
function generateTOTP(secret: string): string {
  const time = Math.floor(Date.now() / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(time));

  // Decode base32 secret
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const val = base32Chars.indexOf(char);
    if (val === -1) throw new Error(`Invalid base32 character: ${char}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const secretBytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < secretBytes.length; i++) {
    secretBytes[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  }

  const hmac = createHmac('sha1', secretBytes).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 1000000).toString().padStart(6, '0');
}

export class SessionManager {
  async ensureAuthenticated(config: StarkConfig): Promise<DataProvider> {
    // Try AngelOne if configured
    if (config.angelOne?.apiKey && config.angelOne?.clientId) {
      try {
        const { AngelOneProvider } = await import('../api/angel-one.js');
        const provider = new AngelOneProvider(config.angelOne.apiKey);

        // Check if already authenticated
        if (provider.isAuthenticated()) {
          return provider;
        }

        // Generate TOTP if secret available
        if (config.angelOne.totpSecret) {
          const totp = generateTOTP(config.angelOne.totpSecret);
          await provider.authenticate({
            clientId: config.angelOne.clientId,
            totp,
          });
          return provider;
        }

        console.warn('[WARN] No TOTP secret configured. Add angelOne.totpSecret to ~/.stark/config.json');
        console.warn('[WARN] Falling back to MockProvider');
      } catch (err) {
        console.warn(`[WARN] AngelOne auth failed: ${(err as Error).message}`);
        console.warn('[WARN] Falling back to MockProvider');
      }
    }

    // Fallback to MockProvider
    const { MockProvider } = await import('../api/mock-provider.js');
    return new MockProvider();
  }
}

export { generateTOTP };
