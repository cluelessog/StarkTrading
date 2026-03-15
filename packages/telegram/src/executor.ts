import type { PersistentCommandContext } from '@stark/cli/utils/command-context.js';
import { calculatePortfolioHeat } from '@stark/core/journal/portfolio-heat.js';
import { TradeManager } from '@stark/core/journal/trade-manager.js';
import { generateAdvancedStats } from '@stark/core/journal/performance.js';
import { ToolRegistry, type ToolResult } from './tool-registry.js';

export function createToolRegistry(ctx: PersistentCommandContext): ToolRegistry {
  const registry = new ToolRegistry();
  const tradeManager = new TradeManager(ctx.db);

  registry.register({
    name: 'score',
    description: 'Score a stock symbol using all 13 factors',
    examples: ['score RELIANCE', 'score INFY'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      if (!symbol) return { data: null, summary: 'No symbol provided. Usage: score SYMBOL' };

      // Resolve token from watchlist first, then instrument master
      const allStocks = ctx.queries.getWatchlistStocks(1);
      const watchlistMatch = allStocks.find((s) => s.symbol === symbol);
      let token: string;
      if (watchlistMatch) {
        token = watchlistMatch.token;
      } else {
        const results = await ctx.provider.searchSymbol(symbol);
        const exact = results.find((r) => r.symbol === symbol);
        if (!exact) {
          return { data: null, summary: `Symbol '${symbol}' not found in watchlist or instrument master.` };
        }
        token = exact.token;
      }

      const result = await ctx.engine.scoreSymbol(symbol, token, {
        sessionId: 'bot-single',
        startedAt: Date.now(),
        symbols: [symbol],
        apiCalls: {},
        cacheHits: 0,
        cacheMisses: 0,
        llmCalls: 0,
        errors: [],
        degradedFactors: [],
      });

      return { data: result, summary: `${symbol}: ${result.totalScore}/${result.maxPossibleScore} (${result.status})` };
    },
  });

  registry.register({
    name: 'focus',
    description: 'Show the current focus list (top-scored stocks)',
    examples: ['focus', 'focus list'],
    async execute(_args) {
      const rows = ctx.db.query<{ symbol: string; total_score: number; max_possible_score: number; status: string }>(
        `SELECT symbol, total_score, max_possible_score, status FROM stock_scores
         WHERE status = 'COMPLETE' ORDER BY total_score DESC LIMIT 10`,
      );
      return { data: rows, summary: `Focus list: ${rows.length} stocks` };
    },
  });

  registry.register({
    name: 'heat',
    description: 'Show portfolio heat (total risk exposure)',
    examples: ['heat', 'my heat', 'portfolio heat'],
    async execute(_args) {
      const heat = calculatePortfolioHeat(ctx.db, ctx.config.risk.swing);
      return {
        data: heat,
        summary: `Portfolio heat: ${heat.heatPct}% [${heat.status}] — ${heat.positions.length} positions`,
      };
    },
  });

  registry.register({
    name: 'trades',
    description: 'List open or closed trades',
    examples: ['open trades', 'closed trades', 'trades'],
    async execute(args) {
      const filter = args.filter ?? 'open';
      const trades = filter === 'closed' ? ctx.queries.getClosedTrades()
        : filter === 'all' ? ctx.queries.getAllTrades()
        : ctx.queries.getOpenTrades();
      return { data: trades, summary: `${filter} trades: ${trades.length}` };
    },
  });

  registry.register({
    name: 'status',
    description: 'Show account and market status',
    examples: ['status'],
    async execute(_args) {
      const openTrades = ctx.queries.getOpenTrades();
      const latestMbi = ctx.queries.getLatestMBI();
      const marketCtx = ctx.queries.getLatestMarketContext();
      return {
        data: { openTrades: openTrades.length, mbi: latestMbi, marketCtx },
        summary: `${openTrades.length} open trades | Regime: ${marketCtx?.mbiRegime ?? 'unknown'}`,
      };
    },
  });

  registry.register({
    name: 'market',
    description: 'Show market overview and current regime',
    examples: ['market', 'market overview'],
    async execute(_args) {
      const latestMbi = ctx.queries.getLatestMBI();
      const marketCtx = ctx.queries.getLatestMarketContext();
      return {
        data: { mbi: latestMbi, marketCtx },
        summary: `Regime: ${marketCtx?.mbiRegime ?? 'unknown'} | EM: ${latestMbi?.em ?? 'N/A'}`,
      };
    },
  });

  registry.register({
    name: 'morning',
    description: 'Run morning preparation workflow',
    examples: ['morning'],
    async execute(_args) {
      await ctx.refreshAuth();
      const focusStocks = ctx.db.query<{ symbol: string; total_score: number }>(
        `SELECT symbol, total_score FROM stock_scores WHERE status = 'COMPLETE' ORDER BY total_score DESC LIMIT 5`,
      );
      const marketCtx = ctx.queries.getLatestMarketContext();
      return {
        data: { focusStocks, regime: marketCtx?.mbiRegime },
        summary: `Morning: ${focusStocks.length} focus stocks | Regime: ${marketCtx?.mbiRegime ?? 'unknown'}`,
      };
    },
  });

  registry.register({
    name: 'evening',
    description: 'Run evening review and scoring workflow',
    examples: ['evening'],
    async execute(_args) {
      await ctx.refreshAuth();
      const stocks = ctx.queries.getWatchlistStocks(1, 0);
      if (stocks.length === 0) return { data: null, summary: 'No watchlist stocks. Run sync first.' };

      const symbols = stocks.map((s) => ({ symbol: s.symbol, token: s.token, name: s.name }));
      const { results } = await ctx.engine.scoreBatch(symbols);
      const topStocks = results.sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);

      return {
        data: { scored: results.length, top: topStocks },
        summary: `Evening: scored ${results.length} stocks. Top: ${topStocks.map((s) => `${s.symbol}(${s.totalScore})`).join(', ')}`,
      };
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
    examples: ['review RELIANCE linearity 1', 'override its aoi to 0.5'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      const factor = args.factor ?? '';
      const value = parseFloat(args.value ?? '0');
      if (!symbol || !factor) return { data: null, summary: 'Usage: review SYMBOL FACTOR VALUE' };
      return { data: { symbol, factor, value }, summary: `Override queued: ${symbol}.${factor} = ${value}` };
    },
  });

  registry.register({
    name: 'performance',
    description: 'Show trading performance metrics',
    examples: ['performance', 'stats', 'my performance'],
    async execute(_args) {
      const closed = ctx.queries.getClosedTrades();

      if (closed.length === 0) {
        return { data: null, summary: 'No closed trades yet. Log entries and exits to see performance.' };
      }

      const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
      const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const totalR = closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
      const winRate = (wins.length / closed.length * 100).toFixed(1);
      const avgHoldDays = (closed.reduce((s, t) => s + (t.holdDays ?? 0), 0) / closed.length).toFixed(1);

      const advanced = generateAdvancedStats(closed);

      const lines = [
        `Performance (${closed.length} closed trades):`,
        `  Win rate: ${winRate}%`,
        `  Avg R: ${(totalR / closed.length).toFixed(2)}R`,
        `  Total PnL: Rs ${totalPnl.toLocaleString('en-IN')}`,
        `  Profit factor: ${advanced.profitFactor === null ? 'Perfect (no losses)' : advanced.profitFactor.toFixed(2)}`,
        `  Max drawdown: ${advanced.maxDrawdown.maxDrawdownAbs > 0 ? `Rs ${advanced.maxDrawdown.maxDrawdownAbs.toLocaleString('en-IN')} (${advanced.maxDrawdown.maxDrawdownPct.toFixed(1)}%)` : 'None'}`,
        `  Current streak: ${advanced.currentStreak.type ? `${advanced.currentStreak.length}${advanced.currentStreak.type}` : 'N/A'}`,
        `  Best streak: ${advanced.longestWinStreak}W / Worst: ${advanced.longestLoseStreak}L`,
        `  Kelly: ${advanced.kellyPct.toFixed(1)}%`,
        `  Avg hold: ${avgHoldDays} days`,
      ];

      return { data: { closedTrades: closed.length, wins: wins.length, winRate, totalR: totalR.toFixed(2), advanced }, summary: lines.join('\n') };
    },
  });

  registry.register({
    name: 'evolve',
    description: 'Show factor scoring evolution and edge analysis',
    examples: ['evolve'],
    async execute(_args) {
      const scores = ctx.queries.getDailyAverageScores(30);
      const latest = scores[scores.length - 1];
      return {
        data: scores,
        summary: `Evolve: ${scores.length} days of data. Latest avg: ${latest?.avgScore?.toFixed(1) ?? 'N/A'}`,
      };
    },
  });

  registry.register({
    name: 'import',
    description: 'Import trade data from CSV or broker',
    examples: ['import'],
    async execute(_args) {
      return { data: null, summary: 'Import: use the CLI command `stark import` for full import capabilities.' };
    },
  });

  registry.register({
    name: 'entry',
    description: 'Log a trade entry',
    examples: ['entry RELIANCE 2500 100 2450'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      if (!symbol) return { data: null, summary: 'Usage: entry SYMBOL PRICE SHARES [STOP]' };

      const entryPrice = parseFloat(args.price ?? '');
      const shares = parseInt(args.shares ?? '', 10);

      if (isNaN(entryPrice) || isNaN(shares)) {
        return { data: null, summary: 'Error: price and shares must be valid numbers' };
      }

      let stopPrice: number | undefined;
      if (args.stop) {
        stopPrice = parseFloat(args.stop);
        if (isNaN(stopPrice)) {
          return { data: null, summary: 'Error: stop price must be a valid number' };
        }
        if (stopPrice >= entryPrice) {
          return { data: null, summary: 'Error: stop price must be below entry price' };
        }
      }

      const conviction = (args.conviction ?? 'MEDIUM').toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';
      if (!['HIGH', 'MEDIUM', 'LOW'].includes(conviction)) {
        return { data: null, summary: 'Error: conviction must be HIGH, MEDIUM, or LOW' };
      }

      try {
        const result = tradeManager.entry({ symbol, entryPrice, shares, stopPrice, conviction, riskProfile: ctx.config.risk.swing });
        const lines = [
          `Trade entered: ${result.symbol}`,
          `  Entry: Rs ${result.entryPrice}`,
          `  Shares: ${result.shares}`,
          result.stopPrice != null ? `  Stop: Rs ${result.stopPrice}` : '  Stop: not set',
          result.riskAmount != null ? `  Risk: Rs ${result.riskAmount}` : null,
          `  Conviction: ${result.conviction}`,
          `  Trade ID: ${result.tradeId}`,
        ].filter(Boolean);
        return { data: result, summary: lines.join('\n') };
      } catch (err) {
        return { data: null, summary: `Error: ${(err as Error).message}` };
      }
    },
  });

  registry.register({
    name: 'exit',
    description: 'Log a trade exit',
    examples: ['exit RELIANCE 2600', 'exit RELIANCE 2600 target'],
    async execute(args) {
      const symbol = (args.symbol ?? '').toUpperCase();
      const exitPrice = parseFloat(args.price ?? '');
      if (!symbol || isNaN(exitPrice)) {
        return { data: null, summary: 'Usage: exit SYMBOL PRICE [REASON]' };
      }

      const reasonStr = (args.reason ?? 'DISCRETION').toUpperCase();
      const validReasons = ['STOPPED', 'TARGET', 'DISCRETION', 'INVALIDATED'];
      if (!validReasons.includes(reasonStr)) {
        return { data: null, summary: `Error: reason must be one of: ${validReasons.join(', ')}` };
      }

      try {
        const result = tradeManager.exit({
          symbol,
          exitPrice,
          exitReason: reasonStr as 'STOPPED' | 'TARGET' | 'DISCRETION' | 'INVALIDATED',
        });
        const pnlSign = result.pnl >= 0 ? '+' : '';
        const rSign = result.rMultiple >= 0 ? '+' : '';
        return {
          data: result,
          summary: [
            `Trade closed: ${result.symbol}`,
            `  Entry: Rs ${result.entryPrice}`,
            `  Exit: Rs ${result.exitPrice}`,
            `  P&L: ${pnlSign}Rs ${result.pnl}`,
            `  R: ${rSign}${result.rMultiple}R`,
            `  Hold: ${result.holdDays} days`,
            `  Reason: ${result.exitReason}`,
          ].join('\n'),
        };
      } catch (err) {
        return { data: null, summary: `Error: ${(err as Error).message}` };
      }
    },
  });

  registry.register({
    name: 'mbi-analyze',
    description: 'Analyze MBI regime history and score correlation',
    examples: ['mbi-analyze'],
    async execute(_args) {
      const history = ctx.queries.getMBIHistory(30);
      const latest = history[history.length - 1];
      return {
        data: history,
        summary: `MBI: ${history.length} days. Latest EM: ${latest?.em ?? 'N/A'}, source: ${latest?.source ?? 'N/A'}`,
      };
    },
  });

  registry.register({
    name: 'logs',
    description: 'Show recent automation logs',
    examples: ['logs', 'recent logs'],
    async execute(_args) {
      const logs = ctx.queries.getAutomationLogs(10);
      return {
        data: logs,
        summary: `Recent logs: ${logs.length} entries`,
      };
    },
  });

  registry.register({
    name: 'help',
    description: 'Show available commands',
    examples: ['help', 'commands', '?'],
    async execute(_args) {
      const descriptions = registry.getToolDescriptions();
      return { data: registry.getAll().map((t) => t.name), summary: descriptions };
    },
  });

  return registry;
}
