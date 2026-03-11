'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const tabs = [
  { href: '/settings/workspace', label: 'Espaces de travail' },
  { href: '/settings/parameters', label: 'Paramètres' },
  { href: '/settings/users', label: 'Utilisateurs' },
  { href: '/settings/log', label: 'Journal' },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              active
                ? 'border-[var(--line)] bg-[#f2eee4] font-bold text-[var(--fg)]'
                : 'border-[var(--line)] bg-white font-medium text-[var(--fg)] hover:bg-[#f8f4ea]',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
