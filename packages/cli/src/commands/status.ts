import { createDatabase } from '@stark/core/db/index.js';
import { loadConfig } from '@stark/core/config/index.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function statusCommand(_args: string[]): Promise<void> {
  const config = loadConfig();
  const { queries } = createDatabase();

  console.log('=== Stark Status ===\n');

  // Session status
  const sessionPath = join(homedir(), '.stark', 'session.json');
  if (existsSync(sessionPath)) {
    try {
      const session = JSON.parse(readFileSync(sessionPath, 'utf-8')) as {
        authenticatedAt: string;
      };
      const authDate = new Date(session.authenticatedAt);
      const today = new Date().toISOString().slice(0, 10);
      const authDay = authDate.toISOString().slice(0, 10);
      const isValid = authDay === today;
      console.log(
        `Session: ${isValid ? 'VALID' : 'EXPIRED'} (authenticated: ${authDate.toLocaleString()})`,
      );
    } catch {
      console.log('Session: CORRUPT');
    }
  } else {
    console.log('Session: NOT AUTHENTICATED');
  }

  // API usage today
  const today = new Date().toISOString().slice(0, 10);
  const usage = queries.getApiUsage(today);
  console.log('\nAPI Usage (today):');
  if (Object.keys(usage).length === 0) {
    console.log('  No API calls today');
  } else {
    for (const [service, count] of Object.entries(usage)) {
      console.log(`  ${service}: ${count} calls`);
    }
  }

  // Config summary
  console.log('\nConfiguration:');
  console.log(
    `  Angel One API Key: ${config.angelOne?.apiKey ? 'SET' : 'NOT SET'}`,
  );
  console.log(
    `  Gemini Key: ${config.llm?.geminiKey ? 'SET' : 'NOT SET'}`,
  );
  console.log(
    `  Perplexity Key: ${config.llm?.perplexityKey ? 'SET' : 'NOT SET'}`,
  );
  console.log(`  LLM Enabled: ${config.llm?.enabled ?? false}`);
  console.log('  Database: ~/.stark/stark.db');
}
