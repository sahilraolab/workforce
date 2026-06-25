module.exports = {
  apps: [{
    name: 'workforce-eos',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env_production: {
      NODE_ENV: 'production',
    },
    // Load .env.production on the server — copy it to /var/www/workforce/.env
    // before running: pm2 start ecosystem.config.js --env production
    error_file: '/var/log/workforce/error.log',
    out_file: '/var/log/workforce/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '512M',
    restart_delay: 3000,
    watch: false,
  }],
};
