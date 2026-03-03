'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  {
    href: '/crm',
    label: 'CRM',
    children: [
      { href: '/crm/societies', label: 'Societes' },
      { href: '/crm/contacts', label: 'Contacts' },
    ],
  },
  { href: '/projects', label: 'Projects' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/emails', label: 'Emails' },
  { href: '/documents', label: 'Documents' },
  { href: '/finance', label: 'Finance' },
  { href: '/timesheet', label: 'Timesheet' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [openCrm, setOpenCrm] = useState(false);

  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  const crmIsActive = useMemo(() => pathname.startsWith('/crm'), [pathname]);

  return (
    <aside className="w-full border-b border-[var(--line)] bg-[var(--surface)] px-4 py-4 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
      <p className="mb-6 text-lg font-bold text-[var(--brand)]">MyOptiwealth</p>
      <nav className="grid gap-2">
        {links.map((link) => {
          if (!('children' in link)) {
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm text-[var(--fg)] hover:bg-[#f2eee4]',
                  isActive(link.href)
                    ? 'border border-[var(--line)] bg-[#f2eee4] font-bold'
                    : 'font-medium',
                )}
              >
                {link.label}
              </Link>
            );
          }

          const isCrmOpen = openCrm || crmIsActive;
          const children = link.children ?? [];

          return (
            <div key={link.href} className="grid gap-1">
              <button
                type="button"
                onClick={() => setOpenCrm((value) => !value)}
                className={cn(
                  'flex items-center justify-between rounded-md px-3 py-2 text-left text-sm text-[var(--fg)] hover:bg-[#f2eee4]',
                  crmIsActive
                    ? 'border border-[var(--line)] bg-[#f2eee4] font-bold'
                    : 'font-medium',
                )}
              >
                <span>{link.label}</span>
                <span className="text-xs">{isCrmOpen ? '▾' : '▸'}</span>
              </button>

              {isCrmOpen ? (
                <div className="ml-2 grid gap-1 border-l border-[var(--line)] pl-3">
                  {children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={cn(
                        'rounded-md px-3 py-2 text-sm text-[var(--fg)] hover:bg-[#f2eee4]',
                        isActive(child.href)
                          ? 'border border-[var(--line)] bg-[#f2eee4] font-bold'
                          : 'font-medium',
                      )}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
