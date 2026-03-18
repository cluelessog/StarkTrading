import * as readline from 'readline';
import { NLU } from '@stark/core/nlu/nlu.js';
import { createPersistentCommandContext } from '../utils/command-context.js';
import { createCLIToolRegistry } from '../nlu/cli-tools.js';

const DESTRUCTIVE_COMMANDS = new Set(['entry', 'exit']);

export async function chatCommand(_args: string[]): Promise<void> {
  console.log('Stark Chat — type naturally, or "quit" to exit.');
  console.log('Examples: "show me my trades", "score reliance", "how is the market"');
  console.log('');

  const ctx = await createPersistentCommandContext();
  const registry = createCLIToolRegistry(ctx);
  const nlu = new NLU(registry, ctx.llmService);
  const history: Array<{ role: string; message: string }> = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'stark> ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    if (['quit', 'exit', 'q', 'bye'].includes(text.toLowerCase())) {
      console.log('Goodbye!');
      ctx.dispose();
      rl.close();
      return;
    }

    history.push({ role: 'user', message: text });

    try {
      const intent = await nlu.parse(text, 'cli-chat', history);

      if (intent.command === 'unknown') {
        const reply = 'I did not understand that. Type "help" for available commands.';
        console.log(reply);
        history.push({ role: 'assistant', message: reply });
        rl.prompt();
        return;
      }

      // Confirm destructive actions
      if (DESTRUCTIVE_COMMANDS.has(intent.command) && intent.confidence < 1) {
        const argsStr = Object.entries(intent.args).map(([k, v]) => `${k}=${v}`).join(', ');
        const confirmed = await new Promise<boolean>((resolve) => {
          rl.question(`Understood as: ${intent.command} (${argsStr}). Proceed? (Y/n) `, (answer) => {
            resolve(answer.trim().toLowerCase() !== 'n');
          });
        });
        if (!confirmed) {
          console.log('Cancelled.');
          rl.prompt();
          return;
        }
      }

      const tool = registry.get(intent.command);
      if (!tool) {
        console.log(`Unknown command: ${intent.command}`);
        rl.prompt();
        return;
      }

      const result = await tool.execute(intent.args);
      console.log(result.summary);
      history.push({ role: 'assistant', message: result.summary });
    } catch (err) {
      console.log(`Error: ${(err as Error).message}`);
    }

    // Keep history manageable
    if (history.length > 20) history.splice(0, history.length - 20);

    rl.prompt();
  });

  rl.on('close', () => {
    ctx.dispose();
    process.exit(0);
  });
}
