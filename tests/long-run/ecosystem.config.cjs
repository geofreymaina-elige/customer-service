const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');

module.exports = {
  apps: [
    {
      name: 'customer-soak-node-1',
      script: 'tests/long-run/run.js',
      cwd: projectRoot,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      env_file: path.join(__dirname, '.env'),
      env: {
        LONGRUN_NODE_NAME: 'node-1',
        LONGRUN_TARGET_ENVIRONMENT: 'local',
        LONGRUN_PM2_PROCESS_NAMES: 'customer-management-service,customer-cdc-consumer',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(projectRoot, 'logs/long-run', 'pm2-soak-node-1-error.log'),
      out_file: path.join(projectRoot, 'logs/long-run', 'pm2-soak-node-1-out.log'),
      merge_logs: true,
      exp_backoff_restart_delay: 1000,
    },
    {
      name: 'customer-soak-node-2',
      script: 'tests/long-run/run.js',
      cwd: projectRoot,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      env_file: path.join(__dirname, '.env'),
      env: {
        LONGRUN_NODE_NAME: 'node-2',
        LONGRUN_TARGET_ENVIRONMENT: 'local',
        LONGRUN_PM2_PROCESS_NAMES: 'customer-management-service,customer-cdc-consumer',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(projectRoot, 'logs/long-run', 'pm2-soak-node-2-error.log'),
      out_file: path.join(projectRoot, 'logs/long-run', 'pm2-soak-node-2-out.log'),
      merge_logs: true,
      exp_backoff_restart_delay: 1000,
    },
  ],
};
