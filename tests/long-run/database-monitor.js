const { Pool } = require('pg');

function databaseIdentity(row) {
  return {
    address: row.server_address,
    port: row.server_port,
    inRecovery: row.in_recovery,
    postmasterStartedAt: new Date(row.postmaster_started_at).toISOString(),
  };
}

function leaderChangeObserved(previous, current) {
  return Boolean(previous && !current.inRecovery && (
    current.address !== previous.address ||
    current.port !== previous.port ||
    previous.inRecovery
  ));
}

class DatabaseMonitor {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.pool = null;
    this.previousIdentity = null;
  }

  start() {
    const db = this.config.database;
    if (!db.database || !db.user) {
      this.logger.warn('database_monitor_disabled', { reason: 'DATABASE_NAME or DATABASE_USER is missing' });
      return false;
    }

    this.pool = new Pool({
      host: db.host,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      ssl: db.ssl ? { rejectUnauthorized: false } : false,
      max: Math.max(3, this.config.dbStressEnabled ? this.config.dbStressParallelism + 1 : 3),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      application_name: `long-run-monitor-${this.config.nodeName}`,
      statement_timeout: 10000,
    });
    this.pool.on('error', (error) => {
      this.logger.error('db_idle_client_disconnected', {
        errorCode: error.code,
        errorMessage: error.message,
      });
    });
    this.logger.info('database_monitor_started', {
      endpoint: `${db.host}:${db.port}`,
      sampleIntervalMs: this.config.dbSampleIntervalMs,
    });
    return true;
  }

  async sample() {
    if (!this.pool) return;
    const sampledAt = new Date().toISOString();
    try {
      const result = await this.pool.query(`
        SELECT clock_timestamp() AS database_time,
               inet_server_addr()::text AS server_address,
               inet_server_port() AS server_port,
               pg_is_in_recovery() AS in_recovery,
               pg_postmaster_start_time() AS postmaster_started_at,
               (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS database_sessions,
               (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active_sessions
      `);
      const row = result.rows[0];
      const identity = databaseIdentity(row);

      if (this.previousIdentity && JSON.stringify(identity) !== JSON.stringify(this.previousIdentity)) {
        const leaderChanged = leaderChangeObserved(this.previousIdentity, identity);
        this.logger.warn(leaderChanged ? 'leader_change_observed' : 'db_endpoint_or_role_changed', {
          previous: this.previousIdentity,
          current: identity,
          observedAt: sampledAt,
          leaderChangeObserved: leaderChanged,
        });
      } else if (!this.previousIdentity) {
        this.logger.info('db_initial_identity', { identity, observedAt: sampledAt });
      }

      this.previousIdentity = identity;
      if (identity.inRecovery) {
        this.logger.error('db_write_listener_returned_replica', { identity, observedAt: sampledAt });
      }
      this.logger.info('db_sample', {
        observedAt: sampledAt,
        databaseTime: new Date(row.database_time).toISOString(),
        identity,
        databaseSessions: Number(row.database_sessions),
        activeSessions: Number(row.active_sessions),
      });
    } catch (error) {
      this.logger.error('db_probe_failed', {
        observedAt: sampledAt,
        errorCode: error.code,
        errorMessage: error.message,
      });
    }
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

module.exports = { DatabaseMonitor, databaseIdentity, leaderChangeObserved };