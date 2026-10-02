const fs = require('node:fs');
const path = require('node:path');

const SECRET_KEY = /(token|secret|password|authorization|cookie|otp|pin|private.?key|id.?number)/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redact(child);
  }
  return result;
}

function dayStamp(date) {
  return date.toISOString().slice(0, 10);
}

class DailyLogger {
  constructor(directory, maxBytes = 10 * 1024 * 1024, retentionDays = 14) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    this.retentionDays = retentionDays;
    this.currentFile = null;
    this.currentBytes = 0;
  }

  initialize(now = new Date()) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.prune(now);
    this.selectFile(now);
  }

  selectFile(now) {
    const stamp = dayStamp(now);
    let index = 0;
    while (true) {
      const suffix = index === 0 ? '' : `.part-${String(index).padStart(2, '0')}`;
      const candidate = path.join(this.directory, `soak-${stamp}${suffix}.jsonl`);
      if (!fs.existsSync(candidate) || fs.statSync(candidate).size < this.maxBytes) {
        this.currentFile = candidate;
        this.currentBytes = fs.existsSync(candidate) ? fs.statSync(candidate).size : 0;
        return;
      }
      index += 1;
    }
  }

  prune(now = new Date()) {
    const cutoff = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = /^soak-(\d{4}-\d{2}-\d{2})(?:\.part-\d+)?\.jsonl$/.exec(entry.name);
      if (!match) continue;
      const fileDate = new Date(`${match[1]}T00:00:00.000Z`).getTime();
      if (Number.isFinite(fileDate) && fileDate < cutoff) {
        fs.rmSync(path.join(this.directory, entry.name), { force: true });
      }
    }
  }

  write(level, event, fields = {}, now = new Date()) {
    if (!this.currentFile) this.initialize(now);
    if (dayStamp(now) !== path.basename(this.currentFile).slice(5, 15)) {
      this.selectFile(now);
    }
    const record = redact({ timestamp: now.toISOString(), level, event, ...fields, ...(this.nodeName ? { nodeName: this.nodeName } : {}) });
    const line = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.currentBytes + bytes > this.maxBytes) {
      this.selectFile(now);
    }
    fs.appendFileSync(this.currentFile, line, { encoding: 'utf8', mode: 0o600 });
    this.currentBytes += bytes;
  }

  info(event, fields = {}) { this.write('info', event, fields); }
  warn(event, fields = {}) { this.write('warn', event, fields); }
  error(event, fields = {}) { this.write('error', event, fields); }
}

module.exports = { DailyLogger, redact };