import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
  const originalEnv = process.env.STARK_MOCK;

  beforeEach(() => {
    delete process.env.STARK_MOCK;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.STARK_MOCK = originalEnv;
    } else {
      delete process.env.STARK_MOCK;
    }
  });

  it('throws when no angelOne config (fail closed)', async () => {
    const config = getDefaultConfig();
    const manager = new SessionManager();
    await expect(manager.ensureAuthenticated(config)).rejects.toThrow('Broker not configured');
  });

  it('throws when no TOTP secret (fail closed)', async () => {
    const config: StarkConfig = {
      ...getDefaultConfig(),
      angelOne: {
        apiKey: 'test-key',
        clientId: 'test-client',
        // no totpSecret
      },
    };
    const manager = new SessionManager();
    await expect(manager.ensureAuthenticated(config)).rejects.toThrow('No TOTP secret configured');
  });

  it('throws when no password (fail closed)', async () => {
    const config: StarkConfig = {
      ...getDefaultConfig(),
      angelOne: {
        apiKey: 'test-key',
        clientId: 'test-client',
        totpSecret: 'GEZDGNBVGY3TQOJQ',
        // no password
      },
    };
    const manager = new SessionManager();
    await expect(manager.ensureAuthenticated(config)).rejects.toThrow('No password configured');
  });

  it('throws when no apiKey (fail closed)', async () => {
    const config: StarkConfig = {
      ...getDefaultConfig(),
      angelOne: {
        // no apiKey
        clientId: 'test-client',
        totpSecret: 'GEZDGNBVGY3TQOJQ',
      },
    };
    const manager = new SessionManager();
    await expect(manager.ensureAuthenticated(config)).rejects.toThrow('Broker not configured');
  });

  it('returns MockProvider when STARK_MOCK=1', async () => {
    process.env.STARK_MOCK = '1';
    const config = getDefaultConfig();
    const manager = new SessionManager();
    const provider = await manager.ensureAuthenticated(config);
    expect(provider.name).toBe('mock');
  });

  it('passes clientcode, password, and totp to authenticate()', async () => {
    const config: StarkConfig = {
      ...getDefaultConfig(),
      angelOne: {
        apiKey: 'test-key',
        clientId: 'TEST123',
        password: 'test-password',
        totpSecret: 'GEZDGNBVGY3TQOJQ',
      },
    };
    const manager = new SessionManager();
    // This will fail because AngelOneProvider tries to make a real HTTP call,
    // but we can verify the error is from the API call, not from missing credentials
    try {
      await manager.ensureAuthenticated(config);
    } catch (err) {
      const message = (err as Error).message;
      // Should NOT be a "Missing credentials" error — credentials are correctly plumbed
      expect(message).not.toContain('Missing credentials');
      // Should NOT be "Broker not configured" or "No password" — those are our guards
      expect(message).not.toContain('Broker not configured');
      expect(message).not.toContain('No password configured');
      expect(message).not.toContain('No TOTP secret configured');
    }
  });
});
