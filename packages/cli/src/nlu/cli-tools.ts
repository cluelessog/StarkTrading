import type { PersistentCommandContext } from '../utils/command-context.js';
import { calculatePortfolioHeat } from '@stark/core/journal/portfolio-heat.js';
import { TradeManager } from '@stark/core/journal/trade-manager.js';
import { generateAdvancedStats } from '@stark/core/journal/performance.js';
import { generateFocusList } from '@stark/core/mbi/focus-list.js';
import type { MBIRegime } from '@stark/core/models/market.js';
import { ToolRegistry } from '@stark/core/nlu/tool-registry.js';
import { createDefaultRegistry } from '@stark/core/scoring/registry.js';

export function createCLIToolRegistry(ctx: PersistentCommandContext): ToolRegistry {
  const registry = new ToolRegistry();
  const tradeManager = new TradeManager(ctx.db);

  registry.register({
    name: 'score',
    description: 'Score a stock symbol using all 13 factors',
    examples: ['score RELIANCE', 'score INFY', 'check RELIANCE', 'analyze TCS'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      if (!symbol) return { data: null, summary: 'No symbol provided. Usage: score SYMBOL' };
      const allStocks = ctx.queries.getWatchlistStocks(1);
      const watchlistMatch = allStocks.find((s) => s.symbol === symbol);
      let token: string;
      if (watchlistMatch) {
        token = watchlistMatch.token;
      } else {
        const results = await ctx.provider.searchSymbol(symbol);
        const exact = results.find((r) => r.symbol === symbol);
        if (!exact) return { data: null, summary: `Symbol '${symbol}' not found.` };
        token = exact.token;
      }
      const result = await ctx.engine.scoreSymbol(symbol, token, {
        sessionId: 'cli-nlu', startedAt: Date.now(), symbols: [symbol],
        apiCalls: {}, cacheHits: 0, cacheMisses: 0, llmCalls: 0, errors: [], degradedFactors: [],
      });
      const lines = [`${symbol}: ${result.totalScore}/${result.maxPossibleScore} (${result.status})`];
      for (const f of result.factors) {
        lines.push(`  ${f.factorId.padEnd(20)} ${f.score}/${f.maxScore} — ${f.reasoning}`);
      }
      return { data: result, summary: lines.join('\n') };
    },
  });

  registry.register({
    name: 'focus',
    description: 'Show the current focus list (top-scored stocks)',
    examples: ['focus', 'focus list', 'what should I buy', 'what to buy'],
    async execute(_args) {
      const regime = (ctx.queries.getLatestMarketContext()?.mbiRegime as MBIRegime) ?? 'CAUTIOUS';
      const factorRegistry = createDefaultRegistry();
      const focusList = generateFocusList(ctx.db, regime, factorRegistry, { includePartial: true });
      if (focusList.stocks.length === 0) return { data: null, summary: `Focus list empty (regime: ${regime}, threshold: ${focusList.threshold})` };
      const lines = [`Focus list (regime: ${regime}, threshold: ${focusList.threshold}):`];
      for (let i = 0; i < focusList.stocks.length; i++) {
        const s = focusList.stocks[i];
        lines.push(`  ${i + 1}. ${s.symbol.padEnd(15)} ${s.totalScore}/${s.maxScore}`);
      }
      return { data: focusList, summary: lines.join('\n') };
    },
  });

  registry.register({
    name: 'heat',
    description: 'Show portfolio heat (total risk exposure)',
    examples: ['heat', 'my heat', 'portfolio heat', 'risk exposure'],
    async execute(_args) {
      const heat = calculatePortfolioHeat(ctx.db, ctx.config.risk.swing);
      const lines = [`Portfolio Heat: ${heat.heatPct}% [${heat.status}]`,
        `  Total risk: Rs ${heat.totalRisk.toLocaleString('en-IN')}`,
        `  Capital:    Rs ${heat.totalCapital.toLocaleString('en-IN')}`];
      for (const p of heat.positions) {
        const pctOfCapital = ((p.riskAmount / heat.totalCapital) * 100).toFixed(1);
        lines.push(`  ${p.symbol.padEnd(15)} Rs ${p.riskAmount.toLocaleString('en-IN').padStart(8)}  ${pctOfCapital}%`);
      }
      return { data: heat, summary: lines.join('\n') };
    },
  });

  registry.register({
    name: 'trades',
    description: 'List open or closed trades',
    examples: ['open trades', 'closed trades', 'trades', 'show me my trades'],
    async execute(args) {
      const filter = args.filter ?? 'open';
      const trades = filter === 'closed' ? ctx.queries.getClosedTrades()
        : filter === 'all' ? ctx.queries.getAllTrades()
        : ctx.queries.getOpenTrades();
      if (trades.length === 0) return { data: [], summary: `No ${filter} trades.` };
      const lines = [`${filter.charAt(0).toUpperCase() + filter.slice(1)} Trades (${trades.length}):`];
      for (const t of trades) {
        const basic = `  ${(t as any).symbol} — Entry: Rs ${(t as any).entryPrice} x ${(t as any).shares}`;
        if ((t as any).exitPrice != null) {
          lines.push(`${basic} → Exit: Rs ${(t as any).exitPrice} | P&L: Rs ${(t as any).pnl}`);
        } else {
          lines.push(`${basic} | Stop: Rs ${(t as any).stopPrice ?? 'N/A'}`);
        }
      }
      return { data: trades, summary: lines.join('\n') };
    },
  });

  registry.register({
    name: 'status',
    description: 'Show account and market status',
    examples: ['status', 'my status', 'show status'],
    async execute(_args) {
      const openTrades = ctx.queries.getOpenTrades();
      const marketCtx = ctx.queries.getLatestMarketContext();
      return { data: { openTrades: openTrades.length, marketCtx }, summary: `${openTrades.length} open trades | Regime: ${marketCtx?.mbiRegime ?? 'unknown'}` };
    },
  });

  registry.register({
    name: 'market',
    description: 'Show market overview and current regime',
    examples: ['market', 'market overview', 'how is the market'],
    async execute(_args) {
      const latestMbi = ctx.queries.getLatestMBI();
      const marketCtx = ctx.queries.getLatestMarketContext();
      return { data: { mbi: latestMbi, marketCtx }, summary: `Regime: ${marketCtx?.mbiRegime ?? 'unknown'} | EM: ${latestMbi?.em ?? 'N/A'} | Source: ${latestMbi?.source ?? 'N/A'}` };
    },
  });

  registry.register({
    name: 'morning',
    description: 'Run morning preparation workflow',
    examples: ['morning', 'run morning'],
    async execute(_args) {
      await ctx.refreshAuth();
      const regime = (ctx.queries.getLatestMarketContext()?.mbiRegime as MBIRegime) ?? 'CAUTIOUS';
      const factorRegistry = createDefaultRegistry();
      const focusList = generateFocusList(ctx.db, regime, factorRegistry, { includePartial: true });
      return { data: focusList, summary: `Morning: ${focusList.stocks.length} focus stocks | Regime: ${regime}` };
    },
  });

  registry.register({
    name: 'evening',
    description: 'Run evening review and scoring workflow',
    examples: ['evening', 'run evening'],
    async execute(_args) {
      await ctx.refreshAuth();
      const stocks = ctx.queries.getWatchlistStocks(1, 0);
      if (stocks.length === 0) return { data: null, summary: 'No watchlist stocks. Run `stark import` first.' };
      const symbols = stocks.map((s) => ({ symbol: s.symbol, token: s.token, name: s.name }));
      const { results } = await ctx.engine.scoreBatch(symbols);
      const top = results.sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);
      return { data: results, summary: `Evening: scored ${results.length} stocks. Top: ${top.map(s => `${s.symbol}(${s.totalScore})`).join(', ')}` };
    },
  });

  registry.register({
    name: 'sync',
    description: 'Sync watchlist and market data',
    examples: ['sync'],
    async execute(_args) {
      await ctx.refreshAuth();
      const stocks = ctx.queries.getWatchlistStocks(1, 0);
      return { data: { stockCount: stocks.length }, summary: `Sync: ${stocks.length} stocks in watchlist` };
    },
  });

  registry.register({
    name: 'review',
    description: 'Override a factor score for a symbol',
    examples: ['review RELIANCE linearity 1'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      const factor = args.factor ?? '';
      const value = parseFloat(args.value ?? '0');
      if (!symbol || !factor) return { data: null, summary: 'Usage: review SYMBOL FACTOR VALUE' };
      return { data: { symbol, factor, value }, summary: `[NOT PERSISTED] Override: ${symbol}.${factor} = ${value}. Use \`stark review\` for persistent overrides.` };
    },
  });

  registry.register({
    name: 'performance',
    description: 'Show trading performance metrics',
    examples: ['performance', 'stats', 'how am i doing', 'pnl'],
    async execute(_args) {
      const closed = ctx.queries.getClosedTrades();
      if (closed.length === 0) return { data: null, summary: 'No closed trades yet.' };
      const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
      const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const totalR = closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
      const winRate = (wins.length / closed.length * 100).toFixed(1);
      const advanced = generateAdvancedStats(closed);
      const lines = [
        `Performance (${closed.length} closed trades):`,
        `  Win rate: ${winRate}%`,
        `  Total PnL: Rs ${totalPnl.toLocaleString('en-IN')}`,
        `  Avg R: ${(totalR / closed.length).toFixed(2)}R`,
        `  Profit factor: ${advanced.profitFactor === null ? 'Perfect' : advanced.profitFactor.toFixed(2)}`,
        `  Max drawdown: Rs ${advanced.maxDrawdown.maxDrawdownAbs.toLocaleString('en-IN')}`,
        `  Kelly: ${advanced.kellyPct.toFixed(1)}%`,
      ];
      return { data: advanced, summary: lines.join('\n') };
    },
  });

  registry.register({
    name: 'evolve',
    description: 'Show factor scoring evolution',
    examples: ['evolve', 'evolution', 'factor evolution'],
    async execute(_args) {
      const scores = ctx.queries.getDailyAverageScores(30);
      const latest = scores[scores.length - 1];
      return { data: scores, summary: `Evolve: ${scores.length} days. Latest avg: ${latest?.avgScore?.toFixed(1) ?? 'N/A'}` };
    },
  });

  registry.register({
    name: 'entry',
    description: 'Log a trade entry',
    examples: ['entry RELIANCE 2500 100 2450', 'enter reliance at 2500 with stop at 2450'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      if (!symbol) return { data: null, summary: 'Usage: entry SYMBOL PRICE SHARES [STOP] [CONVICTION]' };
      const entryPrice = parseFloat(args.price ?? '');
      const shares = parseInt(args.shares ?? '', 10);
      if (isNaN(entryPrice) || isNaN(shares)) return { data: null, summary: 'Error: price and shares must be valid numbers' };
      let stopPrice: number | undefined;
      if (args.stop) {
        stopPrice = parseFloat(args.stop);
        if (isNaN(stopPrice)) return { data: null, summary: 'Error: stop price must be a valid number' };
      }
      const conviction = (args.conviction ?? 'MEDIUM').toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';
      try {
        const result = tradeManager.entry({ symbol, entryPrice, shares, stopPrice, conviction, riskProfile: ctx.config.risk.swing });
        return { data: result, summary: `Trade entered: ${result.symbol} — Rs ${result.entryPrice} x ${result.shares} (ID: ${result.tradeId})` };
      } catch (err) {
        return { data: null, summary: `Error: ${(err as Error).message}` };
      }
    },
  });

  registry.register({
    name: 'exit',
    description: 'Log a trade exit',
    examples: ['exit RELIANCE 2600 target', 'sell reliance at 2600'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      const exitPrice = parseFloat(args.price ?? '');
      if (!symbol || isNaN(exitPrice)) return { data: null, summary: 'Usage: exit SYMBOL PRICE [REASON]' };
      const reasonStr = (args.reason ?? 'DISCRETION').toUpperCase();
      const validReasons = ['STOPPED', 'TARGET', 'DISCRETION', 'INVALIDATED'];
      if (!validReasons.includes(reasonStr)) return { data: null, summary: `Error: reason must be one of: ${validReasons.join(', ')}` };
      try {
        const result = tradeManager.exit({ symbol, exitPrice, exitReason: reasonStr as any });
        const pnlSign = result.pnl >= 0 ? '+' : '';
        return { data: result, summary: `Trade closed: ${result.symbol} — P&L: ${pnlSign}Rs ${result.pnl} (${result.rMultiple}R)` };
      } catch (err) {
        return { data: null, summary: `Error: ${(err as Error).message}` };
      }
    },
  });

  registry.register({
    name: 'mbi-analyze',
    description: 'Analyze MBI regime history and score correlation',
    examples: ['mbi-analyze', 'mbi', 'market breadth'],
    async execute(_args) {
      const history = ctx.queries.getMBIHistory(30);
      const latest = history[history.length - 1];
      return { data: history, summary: `MBI: ${history.length} days. Latest EM: ${latest?.em ?? 'N/A'}, source: ${latest?.source ?? 'N/A'}` };
    },
  });

  registry.register({
    name: 'logs',
    description: 'Show recent automation logs',
    examples: ['logs', 'show logs', 'recent logs'],
    async execute(_args) {
      const logs = ctx.queries.getAutomationLogs(10);
      if (logs.length === 0) return { data: [], summary: 'No recent automation logs.' };
      const lines = [`Recent logs (${logs.length}):`];
      for (const l of logs) {
        lines.push(`  ${(l as any).createdAt} — ${(l as any).action}: ${(l as any).status}`);
      }
      return { data: logs, summary: lines.join('\n') };
    },
  });

  registry.register({
    name: 'help',
    description: 'Show available commands',
    examples: ['help', 'commands', '?'],
    async execute(_args) {
      const tools = registry.getAll();
      const lines = ['Available commands:'];
      for (const t of tools) {
        lines.push(`  ${t.name.padEnd(15)} ${t.description}`);
      }
      lines.push('', 'You can also use natural language: "show me my trades", "how is the market"');
      return { data: tools.map(t => t.name), summary: lines.join('\n') };
    },
  });

  return registry;
}
