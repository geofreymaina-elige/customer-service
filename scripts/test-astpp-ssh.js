'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('ssh2');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: false });

function log(level, message) {
  console.log(`${new Date().toISOString()} [${level}] ${message}`);
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getPrivateKey() {
  let key = process.env.ASTPP_SSH_PRIVATE_KEY_PATH
    ? fs.readFileSync(process.env.ASTPP_SSH_PRIVATE_KEY_PATH, 'utf8').trim()
    : (process.env.ASTPP_SSH_PRIVATE_KEY || '').trim();

  if (!key) throw new Error('Set ASTPP_SSH_PRIVATE_KEY or ASTPP_SSH_PRIVATE_KEY_PATH.');
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  if (key.startsWith('-----BEGIN')) return key;
  if (/^(ssh-|ecdsa-)/.test(key)) {
    throw new Error('ASTPP SSH key is a public key; configure the matching private key.');
  }

  const decoded = Buffer.from(key, 'base64').toString('utf8');
  return decoded.includes('-----BEGIN') ? decoded : key;
}

function checkSshConnection(options, imagesPath) {
  return new Promise((resolve, reject) => {
    const connection = new Client();
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('SSH check timed out after 10 seconds.')), 10000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      connection.end();
      if (error) reject(error);
      else resolve();
    }

    connection.on('ready', () => {
      log('PASS', `SSH authentication succeeded for ${options.username}@${options.host}:${options.port}.`);
      if (!imagesPath) {
        log('WARN', 'ASTPP_IMAGES_PATH is not configured; skipped the remote image-directory check.');
        finish();
        return;
      }

      const command = `test -d ${shellQuote(imagesPath)} && test -r ${shellQuote(imagesPath)}`;
      connection.exec(command, (error, stream) => {
        if (error) {
          finish(error);
          return;
        }

        let stderr = '';
        stream.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        stream.on('error', finish);
        stream.on('close', (code) => {
          if (code === 0) {
            log('PASS', 'ASTPP image directory exists and is readable.');
            finish();
          } else {
            finish(new Error(stderr.trim() || `Remote image-directory check exited with code ${code}.`));
          }
        });
      });
    });

    connection.on('error', finish);
    connection.connect({
      ...options,
      readyTimeout: 8000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 1,
    });
  });
}

async function main() {
  const host = process.env.ASTPP_SSH_HOST;
  const port = Number(process.env.ASTPP_SSH_PORT);
  const username = process.env.ASTPP_SSH_USERNAME;
  const imagesPath = process.env.ASTPP_IMAGES_PATH;

  log('INFO', 'ASTPP SSH connectivity diagnostic started.');
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username) {
    throw new Error('ASTPP_SSH_HOST, ASTPP_SSH_PORT, and ASTPP_SSH_USERNAME must be configured.');
  }

  log('INFO', `Target: ${host}:${port}; username: ${username}.`);
  log('INFO', `Private key source: ${process.env.ASTPP_SSH_PRIVATE_KEY_PATH ? 'ASTPP_SSH_PRIVATE_KEY_PATH' : 'ASTPP_SSH_PRIVATE_KEY'}.`);
  await checkSshConnection({ host, port, username, privateKey: getPrivateKey() }, imagesPath);
  log('PASS', 'All configured ASTPP SSH checks passed.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log('FAIL', `${message}`);
  process.exitCode = 1;
});
