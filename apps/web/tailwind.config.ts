import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#101319',
        paper: '#f8f7f3',
        brand: '#1f4a73',
        accent: '#b9985b',
      },
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui'],
      },
      boxShadow: {
        panel: '0 10px 30px rgba(16, 19, 25, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
