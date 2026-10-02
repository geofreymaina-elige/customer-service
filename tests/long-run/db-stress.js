const { performance } = require('node:perf_hooks');
const ACCOUNT_AGGREGATE_SQL = `
  SELECT kyc_status, count(*)::bigint AS row_count
  FROM customer_applications
  WHERE astpp_id = $1
  GROUP BY kyc_status
`;

class DbStressRunner {
  constructor(config, logger, databaseMonitor) {
    this.config = config;
    this.logger = logger;
    this.databaseMonitor = databaseMonitor;
    this.nextRunAt = config.dbStressEnabled
      ? Date.now() + this.randomBetween(config.dbStressIntervalMinMs, config.dbStressIntervalMaxMs)
      : Number.POSITIVE_INFINITY;
  }

  randomBetween(minimum, maximum) {
    return Math.floor(minimum + Math.random() * Math.max(0, maximum - minimum));
  }

  async runIfDue(apiCycle) {
    if (!this.config.dbStressEnabled || Date.now() < this.nextRunAt) return;
    this.nextRunAt = Date.now() + this.randomBetween(
      this.config.dbStressIntervalMinMs,
      this.config.dbStressIntervalMaxMs,
    );
    this.logger.warn('db_stress_window_started', {
      windowMs: this.config.dbStressWindowMs,
      parallelism: this.config.dbStressParallelism,
      queryProfile: 'read_only_kyc_status_aggregate',
    });

    const startedAt = Date.now();
    const tasks = Array.from(
      { length: this.config.dbStressParallelism },
      () => this.runAggregateWorker(startedAt),
    );
    tasks.push(apiCycle);
    await Promise.allSettled(tasks);
    this.logger.warn('db_stress_window_finished', {
      durationMs: Date.now() - startedAt,
      nextWindowAt: new Date(this.nextRunAt).toISOString(),
    });
  }

  async runAggregateWorker(windowStartedAt) {
    const pool = this.databaseMonitor.pool;
    if (!pool) return;

    while (Date.now() - windowStartedAt < this.config.dbStressWindowMs) {
      const startedAt = performance.now();
      let client;
      try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await client.query(ACCOUNT_AGGREGATE_SQL, [this.config.variables.astppId]);
        await client.query('COMMIT');
        this.logger.info('db_stress_query_completed', {
          durationMs: Math.round(performance.now() - startedAt),
          statusGroups: result.rows.length,
        });
      } catch (error) {
        if (client) {
          try { await client.query('ROLLBACK'); } catch {}
        }
        this.logger.error('db_stress_query_failed', {
          durationMs: Math.round(performance.now() - startedAt),
          errorCode: error.code,
          errorMessage: error.message,
        });
      } finally {
        client?.release();
      }
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
    }
  }
}

module.exports = { ACCOUNT_AGGREGATE_SQL, DbStressRunner };