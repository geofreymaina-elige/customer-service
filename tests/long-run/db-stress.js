const { performance } = require('node:perf_hooks');

const STRESS_QUERY_TEMPLATES = [
  {
    name: 'customer_volume_by_status',
    query: `
      SELECT kyc_status, count(*)::bigint AS row_count
      FROM customer_applications
      GROUP BY kyc_status
      ORDER BY row_count DESC
    `,
    params: [],
  },
  {
    name: 'customer_volume_by_country',
    query: `
      SELECT COALESCE(country_code, 'UNKNOWN') AS country_code,
             count(*)::bigint AS row_count
      FROM customers
      WHERE deleted_at IS NULL
      GROUP BY COALESCE(country_code, 'UNKNOWN')
      ORDER BY row_count DESC
      LIMIT 20
    `,
    params: [],
  },
  {
    name: 'customer_application_trends',
    query: `
      SELECT date_trunc('day', created_at)::date AS day_bucket,
             count(*)::bigint AS row_count
      FROM customer_applications
      GROUP BY date_trunc('day', created_at)
      ORDER BY day_bucket DESC
      LIMIT 30
    `,
    params: [],
  },
  {
    name: 'customer_status_distribution',
    query: `
      SELECT status, count(*)::bigint AS row_count
      FROM customers
      WHERE deleted_at IS NULL
      GROUP BY status
      ORDER BY row_count DESC
    `,
    params: [],
  },
];

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
    const initializedAt = Date.now();
    this.nextRunAt = config.dbStressEnabled
      ? initializedAt + this.randomBetween(config.dbStressIntervalMinMs, config.dbStressIntervalMaxMs)
      : Number.POSITIVE_INFINITY;
    if (config.dbStressEnabled) {
      this.logger.info('db_stress_scheduled', {
        firstWindowAt: new Date(this.nextRunAt).toISOString(),
        firstWindowDelayMs: this.nextRunAt - initializedAt,
        intervalMinMs: config.dbStressIntervalMinMs,
        intervalMaxMs: config.dbStressIntervalMaxMs,
        windowMs: config.dbStressWindowMs,
        parallelism: config.dbStressParallelism,
        queryProfile: 'read_only_customer_snapshot_load',
      });
    } else {
      this.logger.info('db_stress_disabled', {
        reason: 'LONGRUN_ENABLE_DB_STRESS is not true',
        requiredEnvironment: 'staging or explicitly confirmed production',
        databaseStressPolicy: 'production requires explicit opt-in, confirmation, and TLS',
      });
    }
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
      targetEnvironment: this.config.targetEnvironment,
      targetEnvironment: this.config.targetEnvironment,
      queryProfile: 'read_only_customer_snapshot_load',
      queryCount: STRESS_QUERY_TEMPLATES.length,
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
      const template = STRESS_QUERY_TEMPLATES[Math.floor(Math.random() * STRESS_QUERY_TEMPLATES.length)];
      let client;
      try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await client.query(template.query, template.params);
        await client.query('COMMIT');
        this.logger.info('db_stress_query_completed', {
          durationMs: Math.round(performance.now() - startedAt),
          queryName: template.name,
          rowCount: result.rows.length,
          workload: 'read_only_customer_snapshot',
        });
      } catch (error) {
        if (client) {
          try { await client.query('ROLLBACK'); } catch {}
        }
        this.logger.error('db_stress_query_failed', {
          durationMs: Math.round(performance.now() - startedAt),
          queryName: template.name,
          errorCode: error.code,
          errorMessage: error.message,
        });
      } finally {
        client?.release();
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 750));
    }
  }
}

module.exports = { ACCOUNT_AGGREGATE_SQL, STRESS_QUERY_TEMPLATES, DbStressRunner };