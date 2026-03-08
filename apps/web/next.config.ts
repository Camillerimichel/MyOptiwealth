import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: {
    // Le lint est fait en CI; on l'ignore au build prod pour accelerer les deploys.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
