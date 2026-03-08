import { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { SafeTopbar } from '@/components/layout/topbar-error-boundary';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar />
      <div className="flex-1">
        <SafeTopbar />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
