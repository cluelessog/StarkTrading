import type { PersistentCommandContext } from '@stark/cli/utils/command-context.js';

export interface ToolResult {
  data: unknown;
  summary: string;
}

export interface StarkTool {
  name: string;
  description: string;
  examples: string[];
  execute(args: Record<string, string>, ctx: PersistentCommandContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools: Map<string, StarkTool> = new Map();

  register(tool: StarkTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): StarkTool | undefined {
    return this.tools.get(name);
  }

  getAll(): StarkTool[] {
    return Array.from(this.tools.values());
  }

  getToolDescriptions(): string {
    return this.getAll()
      .map((t) => `${t.name}: ${t.description} (examples: ${t.examples.join(', ')})`)
      .join('\n');
  }

  toMCPTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: 'object', properties: { args: { type: 'object' } } },
    }));
  }
}
