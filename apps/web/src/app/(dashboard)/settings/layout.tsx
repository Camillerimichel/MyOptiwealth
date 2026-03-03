import { ReactNode } from 'react';
import { SettingsNav } from '@/components/settings/settings-nav';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Settings</h1>
      <SettingsNav />
      {children}
    </section>
  );
}
