const { execFile } = require('node:child_process');

function parsePm2List(json, processNames) {
  const allowedNames = new Set(processNames);
  return JSON.parse(json)
    .filter((item) => allowedNames.has(item.name))
    .map((item) => ({
      name: item.name,
      pmId: item.pm_id,
      pid: item.pid,
      status: item.pm2_env?.status,
      restartCount: item.pm2_env?.restart_time,
      uptimeMs: item.pm2_env?.pm_uptime ? Math.max(0, Date.now() - item.pm2_env.pm_uptime) : null,
      cpuPercent: item.monit?.cpu,
      memoryBytes: item.monit?.memory,
    }));
}

class Pm2Monitor {
  constructor(processNames, logger) {
    this.processNames = processNames;
    this.logger = logger;
    this.previous = new Map();
    this.inProgress = false;
  }

  async sample() {
    if (!this.processNames.length || this.inProgress) return;
    this.inProgress = true;
    try {
      const output = await new Promise((resolve, reject) => {
        execFile('pm2', ['jlist'], { timeout: 5000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      const processes = parsePm2List(output, this.processNames);
      const foundNames = new Set(processes.map((process) => process.name));
      for (const name of this.processNames) {
        if (!foundNames.has(name)) {
          this.logger.warn('pm2_process_missing', { name });
        }
      }

      for (const process of processes) {
        const previous = this.previous.get(process.name);
        if (previous && process.restartCount > previous.restartCount) {
          this.logger.error('pm2_process_restarted', {
            name: process.name,
            previousRestartCount: previous.restartCount,
            restartCount: process.restartCount,
            pid: process.pid,
          });
        }
        if (previous && process.status !== previous.status) {
          this.logger.warn('pm2_process_status_changed', {
            name: process.name,
            previousStatus: previous.status,
            status: process.status,
          });
        }
        this.logger.info('pm2_process_sample', process);
        this.previous.set(process.name, process);
      }
    } catch (error) {
      this.logger.warn('pm2_snapshot_failed', {
        errorCode: error.code,
        errorMessage: error.message,
      });
    } finally {
      this.inProgress = false;
    }
  }
}

module.exports = { Pm2Monitor, parsePm2List };