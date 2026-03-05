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

function main(): void {
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
  const known = COMMANDS.find((c) => c.name === command);

  if (!known) {
    console.error(`Error: Unknown command "${command}"`);
    console.error(`Run \`stark --help\` to see available commands.`);
    process.exit(1);
  }

  // Placeholder: each command will be implemented in subsequent tasks
  console.log(`Command "${command}" is not yet implemented.`);
  console.log(`Run \`stark --help\` for available commands.`);
  process.exit(0);
}

main();
