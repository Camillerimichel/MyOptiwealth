module.exports = {
  apps: [
    {
      name: "myoptiwealth-api",
      cwd: "/var/www/myoptiwealth",
      script: "src/index.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: "3400",
      },
    },
    {
      name: "myoptiwealth-frontend",
      cwd: "/var/www/myoptiwealth",
      script: "npm",
      args: "start -- --port 3401",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
