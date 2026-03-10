import { loadConfig, saveConfig } from '@stark/core/config/index.js';
import { createInterface } from 'node:readline';

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function setupCommand(_args: string[]): Promise<void> {
  const config = loadConfig();

  console.log('=== Stark API Key Setup ===\n');
  console.log('Configure your API keys for LLM-powered features.');
  console.log('Press Enter to skip any key.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Claude (Anthropic) - Primary
    console.log('1. Claude (Anthropic) - Primary AI');
    console.log('   Powers: chart analysis, scoring factors, market narrative');
    console.log('   Get key: https://console.anthropic.com/settings/keys');
    const anthropicKey = await prompt(rl, '   API Key: ');

    // Perplexity - Research
    console.log('\n2. Perplexity - Financial Research');
    console.log('   Powers: news, catalysts, corporate actions');
    console.log('   Get key: https://www.perplexity.ai/settings/api');
    const perplexityKey = await prompt(rl, '   API Key: ');

    // Gemini - Fallback
    console.log('\n3. Gemini - Fallback Analysis');
    console.log('   Powers: chart analysis (used when Claude key not set)');
    console.log('   Get key: https://aistudio.google.com/app/apikeys');
    const geminiKey = await prompt(rl, '   API Key: ');

    // Update config
    if (!config.llm) {
      config.llm = { enabled: true, cacheResponses: true, cacheTtlHours: 24 };
    }

    if (anthropicKey) config.llm.anthropicKey = anthropicKey;
    if (perplexityKey) config.llm.perplexityKey = perplexityKey;
    if (geminiKey) config.llm.geminiKey = geminiKey;

    const hasAnyKey = !!(anthropicKey || perplexityKey || geminiKey ||
      config.llm.anthropicKey || config.llm.perplexityKey || config.llm.geminiKey);
    config.llm.enabled = hasAnyKey;

    saveConfig(config);

    // Summary
    console.log('\n--- Configuration Summary ---');
    console.log(`  Anthropic (Claude):  ${config.llm.anthropicKey ? 'SET' : 'SKIPPED'}`);
    console.log(`  Perplexity:          ${config.llm.perplexityKey ? 'SET' : 'SKIPPED'}`);
    console.log(`  Gemini (fallback):   ${config.llm.geminiKey ? 'SET' : 'SKIPPED'}`);
    console.log(`  LLM Enabled:         ${config.llm.enabled}`);

    if (!hasAnyKey) {
      console.log('\nAll keys skipped. Static/algorithmic features are fully available.');
      console.log('Run `stark setup` again anytime to add API keys.');
    } else {
      console.log('\nConfiguration saved to ~/.stark/config.json');
    }
  } finally {
    rl.close();
  }
}
