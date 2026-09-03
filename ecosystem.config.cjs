module.exports = {
  apps: [
    {
      name: 'customer-management-service',
      script: 'dist/src/main.js',
      instances: 'max', // Horizontal scaling across all CPU cores
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5006,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5006,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      autorestart: true,
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'customer-cdc-consumer',
      script: 'dist/src/workers/cdc/run-cdc-consumer.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-cdc-error.log',
      out_file: './logs/pm2-cdc-out.log',
      merge_logs: true,
      autorestart: true,
      exp_backoff_restart_delay: 100,
    },
  ],
};
