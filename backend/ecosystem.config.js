module.exports = {
  apps: [
    {
      name: "moneymatrix-api",
      script: "./src/index.js",
      instances: "max", // Use all CPU cores
      exec_mode: "cluster", // Enable clustering
      merge_logs: true,
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Environment variables
      env: {
        NODE_ENV: "production",
        PORT: 8000,
      },

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_delay: 5000,

      // Auto-restart settings
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: "10s",

      // Monitoring
      monitor_delay: 5000,
      watch: false, // Disable watch in production
      ignore_watch: ["node_modules", "logs"],

      // Rolling restart for zero-downtime deploys
      max_memory_restart: "500M",

      // Advanced cluster settings
      cron_restart: "0 0 * * *", // Restart every midnight
    },
  ],

  // Deploy configuration (optional)
  deploy: {
    production: {
      user: "node",
      host: "your-server.com",
      ref: "origin/main",
      repo: "git@github.com:your-repo/moneymatrix.git",
      path: "/var/www/moneymatrix",
      "post-deploy":
        "npm install && npm run validate:env && pm2 start ecosystem.config.js --env production",
      "pre-deploy-local":
        "echo 'Deploying to production' && git status",
    },
  },
};
