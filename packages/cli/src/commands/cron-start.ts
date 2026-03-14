import { createPersistentCommandContext } from '../utils/command-context.js';
import { TradingScheduler } from '@stark/core/scheduler/index.js';
import { TelegramNotifier } from '@stark/core/notifications/index.js';
import { logger } from '@stark/core/log/index.js';

export async function cronStartCommand(_args: string[]): Promise<void> {
  const ctx = await createPersistentCommandContext();

  const schedulerConfig = ctx.config.scheduler ?? {};
  const scheduler = new TradingScheduler({
    eveningTime: schedulerConfig.eveningTime ?? '18:00',
    morningTime: schedulerConfig.morningTime ?? '08:30',
    syncIntervalMinutes: schedulerConfig.syncIntervalMinutes ?? 30,
    nseHolidays: ctx.config.nseHolidays ?? [],
  });

  // Optional Telegram notifier
  const telegram = ctx.config.telegram;
  const notifier = telegram?.botToken
    ? new TelegramNotifier(telegram.botToken, telegram.allowedChatIds ?? [])
    : null;

  const shutdown = (): void => {
    logger.info('cron', 'shutdown', 'Scheduler shutting down...');
    scheduler.stop();
    ctx.dispose();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('cron', 'start', 'Scheduler started', {
    eveningTime: schedulerConfig.eveningTime,
    morningTime: schedulerConfig.morningTime,
    syncIntervalMinutes: schedulerConfig.syncIntervalMinutes,
  });

  scheduler.start({
    async onEvening() {
      logger.info('cron', 'evening_start', 'Running evening workflow...');
      await ctx.refreshAuth();

      const stocks = ctx.queries.getWatchlistStocks(1, 0);
      if (stocks.length === 0) {
        logger.warn('cron', 'evening_skip', 'No watchlist stocks — skipping evening score');
        ctx.queries.insertAutomationLog('evening', 'skipped', 'No watchlist stocks');
        return;
      }

      try {
        const symbols = stocks.map((s) => ({ symbol: s.symbol, token: s.token, name: s.name }));
        const { results } = await ctx.engine.scoreBatch(symbols);
        const summary = `Evening: scored ${results.length} stocks. Top: ${results
          .sort((a, b) => b.totalScore - a.totalScore)
          .slice(0, 3)
          .map((s) => `${s.symbol}(${s.totalScore})`)
          .join(', ')}`;

        logger.info('cron', 'evening_complete', summary);
        ctx.queries.insertAutomationLog('evening', 'success', summary);

        if (notifier?.isAvailable()) {
          await notifier.send(summary);
        }
      } catch (err) {
        const msg = (err as Error).message;
        logger.error('cron', 'evening_error', msg);
        ctx.queries.insertAutomationLog('evening', 'failure', msg);
      }
    },

    async onMorning() {
      logger.info('cron', 'morning_start', 'Running morning workflow...');
      await ctx.refreshAuth();

      try {
        const focusStocks = ctx.db.query<{ symbol: string; total_score: number }>(
          `SELECT symbol, total_score FROM stock_scores WHERE status = 'COMPLETE' ORDER BY total_score DESC LIMIT 5`,
        );

        const prevCtx = ctx.queries.getLatestMarketContext();
        const mbiResult = await ctx.mbiManager.getLatestRegime().catch(() => null);
        const currentRegime = mbiResult
          ? (await import('@stark/core/mbi/regime-classifier.js')).classifyRegimeFull(mbiResult.mbi).regime
          : null;

        const regimeChanged =
          prevCtx?.mbiRegime && currentRegime && prevCtx.mbiRegime !== currentRegime;

        const summary = `Morning: ${focusStocks.length} focus stocks | Regime: ${currentRegime ?? 'unknown'}${regimeChanged ? ` (changed from ${prevCtx!.mbiRegime})` : ''}`;
        logger.info('cron', 'morning_complete', summary);
        ctx.queries.insertAutomationLog('morning', 'success', summary);

        if (notifier?.isAvailable() && (regimeChanged || focusStocks.length > 0)) {
          await notifier.send(summary);
        }
      } catch (err) {
        const msg = (err as Error).message;
        logger.error('cron', 'morning_error', msg);
        ctx.queries.insertAutomationLog('morning', 'failure', msg);
      }
    },

    async onSync() {
      logger.info('cron', 'sync_start', 'Running sync...');
      await ctx.refreshAuth();

      try {
        const before = ctx.queries.getOpenTrades().length;
        // Sync is lightweight — just log watchlist count and open trades for now
        const stocks = ctx.queries.getWatchlistStocks(1, 0);
        const after = ctx.queries.getOpenTrades().length;

        const changed = after !== before;
        const summary = `Sync: ${stocks.length} watchlist stocks, ${after} open trades`;
        logger.info('cron', 'sync_complete', summary);
        ctx.queries.insertAutomationLog('sync', 'success', summary);

        if (notifier?.isAvailable() && changed) {
          await notifier.send(summary);
        }
      } catch (err) {
        const msg = (err as Error).message;
        logger.error('cron', 'sync_error', msg);
        ctx.queries.insertAutomationLog('sync', 'failure', msg);
      }
    },
  });

  // Keep process alive
  await new Promise<void>(() => {
    // Runs until SIGTERM/SIGINT
  });
}
