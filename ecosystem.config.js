module.exports = {
  apps: [
    {
      name: "wa-backend",
      script: "index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "1G",
      exp_backoff_restart_delay: 100,
      restart_delay: 5000,
      watch: false,
    },
    {
      name: "wa-frontend",
      script: "npm",
      args: "run start",
      cwd: `${__dirname}/dashboard`,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "500M",
      exp_backoff_restart_delay: 100,
      restart_delay: 5000,
      watch: false,
    },
  ],
};
