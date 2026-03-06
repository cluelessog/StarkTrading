import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function askYesNo(prompt: string): Promise<boolean> {
  const answer = await ask(`${prompt} (y/n): `);
  return answer.toLowerCase().startsWith('y');
}

export async function askGraduated(prompt: string): Promise<number> {
  const answer = await ask(`${prompt} (0 / 0.5 / 1): `);
  const val = parseFloat(answer);
  if (val === 0 || val === 0.5 || val === 1) return val;
  return 0;
}

export async function askOptionalText(prompt: string): Promise<string | undefined> {
  const answer = await ask(`${prompt}: `);
  return answer || undefined;
}

export function closePrompts(): void {
  rl.close();
}
