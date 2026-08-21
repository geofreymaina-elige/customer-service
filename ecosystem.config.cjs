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
        PORT: 5005,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5005,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      autorestart: true,
      exp_backoff_restart_delay: 100,
    },
  ],
};
