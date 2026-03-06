#!/usr/bin/env bun

const VERSION = "0.1.0";

const COMMANDS = [
  { name: "auth",        description: "Authenticate with broker and data providers" },
  { name: "import",      description: "Import trade history and market data" },
  { name: "score",       description: "Score trades and strategies" },
  { name: "review",      description: "Review trade performance and patterns" },
  { name: "focus",       description: "Set daily focus and trading parameters" },
  { name: "market",      description: "Show market overview and conditions" },
  { name: "evening",     description: "Run evening review workflow" },
  { name: "morning",     description: "Run morning preparation workflow" },
  { name: "status",      description: "Show current account and position status" },
  { name: "entry",       description: "Log a trade entry" },
  { name: "exit",        description: "Log a trade exit" },
  { name: "trades",      description: "List and filter trades" },
  { name: "performance", description: "Show performance metrics and statistics" },
  { name: "heat",        description: "Show heat map of trading activity" },
  { name: "cron",        description: "Manage scheduled tasks and automation" },
];

function printHelp(): void {
  console.log(`stark v${VERSION} - StarkTrading CLI`);
  console.log("");
  console.log("USAGE:");
  console.log("  stark <command> [options]");
  console.log("");
  console.log("COMMANDS:");

  const maxLen = Math.max(...COMMANDS.map((c) => c.name.length));
  for (const cmd of COMMANDS) {
    console.log(`  ${cmd.name.padEnd(maxLen + 2)}${cmd.description}`);
  }

  console.log("");
  console.log("OPTIONS:");
  console.log("  --help, -h     Show help for a command");
  console.log("  --version, -v  Show version");
  console.log("");
  console.log("Run `stark <command> --help` for command-specific help.");
}

function printVersion(): void {
  console.log(`stark v${VERSION}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    printVersion();
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);
  const known = COMMANDS.find((c) => c.name === command);

  if (!known) {
    console.error(`Error: Unknown command "${command}"`);
    console.error(`Run \`stark --help\` to see available commands.`);
    process.exit(1);
  }

  switch (command) {
    case "auth": {
      const { authCommand } = await import("../src/commands/auth.js");
      await authCommand(commandArgs);
      break;
    }
    case "import": {
      const { importCommand } = await import("../src/commands/import-cmd.js");
      await importCommand(commandArgs);
      break;
    }
    case "status": {
      const { statusCommand } = await import("../src/commands/status.js");
      await statusCommand(commandArgs);
      break;
    }
    case "score": {
      const { scoreCommand } = await import("../src/commands/score.js");
      await scoreCommand(commandArgs);
      break;
    }
    case "review": {
      const { reviewCommand } = await import("../src/commands/review.js");
      await reviewCommand(commandArgs);
      break;
    }
    case "market": {
      const { marketCommand } = await import("../src/commands/market.js");
      await marketCommand(commandArgs);
      break;
    }
    case "focus": {
      const { focusCommand } = await import("../src/commands/focus.js");
      await focusCommand(commandArgs);
      break;
    }
    case "evening": {
      const { eveningCommand } = await import("../src/commands/evening.js");
      await eveningCommand(commandArgs);
      break;
    }
    case "morning": {
      const { morningCommand } = await import("../src/commands/morning.js");
      await morningCommand(commandArgs);
      break;
    }
    default:
      console.log(`Command "${command}" is not yet implemented.`);
      console.log(`Run \`stark --help\` for available commands.`);
      process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
