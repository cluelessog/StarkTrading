import { describe, it, expect } from 'bun:test';
import { generateTOTP } from '../src/auth/session-manager.js';
import { SessionManager } from '../src/auth/session-manager.js';
import type { StarkConfig } from '../src/config/index.js';
import { getDefaultConfig } from '../src/config/index.js';

// ---------------------------------------------------------------------------
// TOTP Generation tests
// ---------------------------------------------------------------------------

describe('generateTOTP', () => {
  it('generates a 6-digit string', () => {
    // Known test secret (base32 encoded "12345678901234567890")
    const secret = 'GEZDGNBVGY3TQOJQ';
    const totp = generateTOTP(secret);
    expect(totp).toHaveLength(6);
    expect(/^\d{6}$/.test(totp)).toBe(true);
  });

  it('generates same TOTP for same time window', () => {
    const secret = 'GEZDGNBVGY3TQOJQ';
    const totp1 = generateTOTP(secret);
    const totp2 = generateTOTP(secret);
    expect(totp1).toBe(totp2);
  });

  it('throws on invalid base32 characters', () => {
    expect(() => generateTOTP('INVALID!@#$')).toThrow();
  });

  it('handles padded base32 secrets', () => {
    const secret = 'GEZDGNBVGY3TQOJQ====';
    const totp = generateTOTP(secret);
    expect(totp).toHaveLength(6);
    expect(/^\d{6}$/.test(totp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SessionManager tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  it('falls back to MockProvider when no angelOne config', async () => {
    const config = getDefaultConfig();
    const manager = new SessionManager();
    const provider = await manager.ensureAuthenticated(config);
    expect(provider.name).toBe('mock');
  });

  it('falls back to MockProvider when no TOTP secret', async () => {
    const config: StarkConfig = {
      ...getDefaultConfig(),
      angelOne: {
        apiKey: 'test-key',
        clientId: 'test-client',
        // no totpSecret
      },
    };
    const manager = new SessionManager();
    // This will fail to import AngelOneProvider in test env or fail auth,
    // either way it should fall back to MockProvider
    const provider = await manager.ensureAuthenticated(config);
    expect(provider.name).toBe('mock');
  });

  it('falls back to MockProvider when no apiKey', async () => {
    const config: StarkConfig = {
      ...getDefaultConfig(),
      angelOne: {
        // no apiKey
        clientId: 'test-client',
        totpSecret: 'GEZDGNBVGY3TQOJQ',
      },
    };
    const manager = new SessionManager();
    const provider = await manager.ensureAuthenticated(config);
    expect(provider.name).toBe('mock');
  });
});
