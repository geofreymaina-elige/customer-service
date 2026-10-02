const fs = require('node:fs');
const path = require('node:path');

const ISSUE_LINE = /\b(ERROR|WARN|WARNING|FATAL|Exception|uncaught|Connection terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|deadlock|read-only transaction)\b/i;

function redactApplicationLine(line) {
  return line
    .replace(/(X-Astpp-Token\s*[:=]\s*)[^\s,}]+/gi, '$1[REDACTED]')
    .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s,}]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]{20,}/g, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g, '[JWT_REDACTED]')
    .replace(/((?:password|pin|otp|token|secret|private.?key)\s*[:=]\s*)['"]?[^\s,'"}]+/gi, '$1[REDACTED]')
    .replace(/((?:customer|astpp|account|user)(?:[_ ]?id)?\s*[:= ]\s*)\d{3,}/gi, '$1[ID_REDACTED]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, '[PHONE_REDACTED]');
}

class AppLogTailer {
  constructor(filePaths, logger) {
    this.logger = logger;
    this.files = filePaths.map((filePath) => ({ path: filePath, offset: 0, identity: null, partial: '' }));
    this.running = false;
  }

  start() {
    for (const file of this.files) {
      try {
        const stat = fs.statSync(file.path);
        file.offset = stat.size;
        file.identity = `${stat.dev}:${stat.ino}`;
        this.logger.info('app_log_tail_started', { file: path.basename(file.path), fromEnd: true });
      } catch (error) {
        this.logger.warn('app_log_tail_unavailable', {
          file: path.basename(file.path),
          errorCode: error.code,
        });
      }
    }
  }

  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      for (const file of this.files) await this.readNewContent(file);
    } finally {
      this.running = false;
    }
  }

  async readNewContent(file) {
    let stat;
    try {
      stat = await fs.promises.stat(file.path);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn('app_log_tail_read_failed', { file: path.basename(file.path), errorCode: error.code });
      }
      return;
    }

    const identity = `${stat.dev}:${stat.ino}`;
    if (file.identity !== identity || stat.size < file.offset) {
      file.offset = 0;
      file.partial = '';
      file.identity = identity;
    }
    if (stat.size <= file.offset) return;

    const start = file.offset;
    file.offset = stat.size;
    const chunks = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(file.path, { start, end: stat.size - 1, encoding: 'utf8' })
        .on('data', (chunk) => chunks.push(chunk))
        .on('end', resolve)
        .on('error', reject);
    });

    const lines = `${file.partial}${chunks.join('')}`.split(/\r?\n/);
    file.partial = lines.pop() || '';
    for (const line of lines) {
      if (!line || !ISSUE_LINE.test(line)) continue;
      const safeLine = redactApplicationLine(line).slice(0, 3000);
      const databaseIssue = /database|postgres|postgresql|\bpg\b|sqlstate|sql error|connection terminated|read-only transaction/i.test(safeLine);
      this.logger.write(databaseIssue ? 'error' : 'warn', databaseIssue ? 'application_db_issue' : 'application_runtime_issue', {
        sourceFile: path.basename(file.path),
        applicationLog: safeLine,
      });
    }
  }
}

module.exports = { AppLogTailer, redactApplicationLine };