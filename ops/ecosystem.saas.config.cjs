module.exports = {
  apps: [
    {
      name: 'myoptiwealth-saas-api',
      cwd: '/var/www/myoptiwealth/apps/api',
      script: 'dist/src/main.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        API_PORT: '7000',
      },
    },
    {
      name: 'myoptiwealth-saas-web',
      cwd: '/var/www/myoptiwealth/apps/web',
      script: 'npm',
      args: 'run start -- --port 3002',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
