#!/usr/bin/env node

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (process.argv.includes('--help')) {
  console.log('Long-run API/DB soak worker');
  console.log('Run with npm run soak; stop with Ctrl+C. It defaults to localhost and performs no state-changing calls or DB stress.');
  console.log('See tests/long-run/README.md for production opt-ins, Postman variables, DB sampling, and staging-only stress settings.');
  process.exit(0);
}

const { monitorEventLoopDelay } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { loadConfig } = require('./config');
const { DailyLogger } = require('./daily-logger');
const { ApiRunner } = require('./api-runner');
const { DatabaseMonitor } = require('./database-monitor');
const { DbStressRunner } = require('./db-stress');
const { AppLogTailer } = require('./app-log-tailer');
const { Pm2Monitor } = require('./pm2-monitor');

function randomBetween(minimum, maximum) {
  return Math.floor(minimum + Math.random() * Math.max(0, maximum - minimum));
}

async function main() {
  const config = loadConfig();
  const logger = new DailyLogger(config.logDirectory, config.logMaxBytes, config.logRetentionDays);
  logger.nodeName = config.nodeName;
  logger.initialize();
  const apiRunner = new ApiRunner(config, logger);

  if (process.argv.includes('--dry-run')) {
    apiRunner.logPlan();
    logger.info('dry_run_complete', { networkRequestsSent: 0, databaseConnectionsOpened: 0 });
    console.log('Dry run complete: no network or database requests were sent.');
    console.log(`API target host: ${new URL(config.baseUrl).host}`);
    console.log(`Daily logs: ${config.logDirectory}`);
    return;
  }

  const databaseMonitor = new DatabaseMonitor(config, logger);
  const dbStressRunner = new DbStressRunner(config, logger, databaseMonitor);
  const appLogTailer = new AppLogTailer(config.appLogPaths, logger);
  const pm2Monitor = new Pm2Monitor(config.pm2ProcessNames, logger);
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.warn('worker_stop_requested', { signal });
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  const startedAt = Date.now();
  const deadline = config.durationHours ? startedAt + config.durationHours * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
  logger.info('worker_started', {
    nodeName: config.nodeName,
    targetEnvironment: config.targetEnvironment,
    apiHost: new URL(config.baseUrl).host,
    dbHost: config.database.host,
    dbPort: config.database.port,
    apiCycleSeconds: [config.cycleMinMs / 1000, config.cycleMaxMs / 1000],
    balanceIntervalMinutes: config.balanceIntervalMs / 60000,
    dbSamplingIntervalSeconds: config.dbSampleIntervalMs / 1000,
    dbStressEnabled: config.dbStressEnabled,
    databaseMonitorConfigured: config.databaseMonitorEnabled,
    authFlowsConfigured: {
      astppToken: Boolean(config.variables.astppToken),
      appAccessToken: config.deviceSignInOnStart,
      transactionToken: config.pinRefreshEnabled,
      deviceIdentifier: Boolean(config.variables.deviceIdentifier),
    },
    logDirectory: config.logDirectory,
    logRetentionDays: config.logRetentionDays,
    logMaxBytes: config.logMaxBytes,
  });
  apiRunner.logPlan();

  databaseMonitor.start();
  appLogTailer.start();
  await databaseMonitor.sample();
  await apiRunner.runStartupRequests();

  let dbSampleInProgress = false;
  const dbSampleTimer = setInterval(async () => {
    if (dbSampleInProgress || stopping) return;
    dbSampleInProgress = true;
    try {
      await databaseMonitor.sample();
    } finally {
      dbSampleInProgress = false;
    }
  }, config.dbSampleIntervalMs);
  const runtimeTimer = setInterval(() => {
    if (stopping) return;
    const memory = process.memoryUsage();
    logger.info('node_runtime_sample', {
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      eventLoopP99Ms: Number((eventLoop.percentile(99) / 1e6).toFixed(2)),
    });
    eventLoop.reset();
    void pm2Monitor.sample();
  }, 30000);
  const appLogTimer = setInterval(() => {
    void appLogTailer.poll().catch((error) => {
      logger.warn('app_log_tailer_error', { errorCode: error.code, errorMessage: error.message });
    });
  }, 1500);
  let apiCycleCount = 0;
  while (!stopping && Date.now() < deadline) {
    const now = Date.now();
    const apiCycle = apiRunner.runCycle(now);
    await dbStressRunner.runIfDue(apiCycle);
    await apiCycle;
    apiCycleCount += 1;

    if (Date.now() >= deadline) break;
    await delay(randomBetween(config.cycleMinMs, config.cycleMaxMs));
  }

  logger.warn('worker_stopping', {
    uptimeSeconds: Math.round(process.uptime()),
    apiCycles: apiCycleCount,
  });
  clearInterval(dbSampleTimer);
  clearInterval(runtimeTimer);
  clearInterval(appLogTimer);
  eventLoop.disable();
  await databaseMonitor.close();
  logger.info('worker_stopped', { uptimeSeconds: Math.round(process.uptime()) });
}

main().catch((error) => {
  console.error('Long-run worker failed to start:', error.message);
  process.exitCode = 1;
});