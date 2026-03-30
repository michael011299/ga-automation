module.exports = {
  apps: [
    {
      name: 'ga-runner',
      script: 'runners.js',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '1G',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'ga-health',
      script: 'server.js',
      env: { NODE_ENV: 'production', PORT: 3001 },
      max_memory_restart: '1G',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'ga-gateway',
      script: 'gateway.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '256M',
      restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
