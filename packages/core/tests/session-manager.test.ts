import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generateTOTP } from '../src/auth/session-manager.js';
import { SessionManager } from '../src/auth/session-manager.js';
import type { StarkConfig } from '../src/config/index.js';
import { getDefaultConfig } from '../src/config/index.js';

const SESSION_PATH = join(homedir(), '.stark', 'session.json');
const SESSION_BACKUP = SESSION_PATH + '.test-backup';

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

  let sessionMoved = false;

  beforeEach(() => {
    delete process.env.STARK_MOCK;
    // Move session file aside so isAuthenticated() returns false during tests
    if (existsSync(SESSION_PATH)) {
      renameSync(SESSION_PATH, SESSION_BACKUP);
      sessionMoved = true;
    }
  });

  afterEach(() => {
    // Restore session file
    if (sessionMoved && existsSync(SESSION_BACKUP)) {
      renameSync(SESSION_BACKUP, SESSION_PATH);
      sessionMoved = false;
    }
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

    // Mock fetch to capture the authenticate() payload
    let capturedBody: Record<string, string> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('loginByPassword') && init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify({ status: true, data: {
        jwtToken: 'fake-jwt', refreshToken: 'fake-refresh', feedToken: 'fake-feed',
      }}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    try {
      const manager = new SessionManager();
      await manager.ensureAuthenticated(config);

      // Verify the exact credential fields sent to AngelOne API
      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.clientcode).toBe('TEST123');
      expect(capturedBody!.password).toBe('test-password');
      expect(capturedBody!.totp).toMatch(/^\d{6}$/);
      // Must NOT contain the wrong field name
      expect(capturedBody!).not.toHaveProperty('clientId');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
