import type { Metadata } from 'next';
import { ReactNode } from 'react';
import { ToastCenter } from '@/components/ui/toast-center';
import './globals.css';

export const metadata: Metadata = {
  title: 'MyOptiwealth SaaS',
  description: 'Premium SaaS for consulting firms',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {children}
        <ToastCenter />
      </body>
    </html>
  );
}
