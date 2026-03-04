'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/calendar', label: 'Calendar' },
  {
    href: '/crm',
    label: 'CRM',
    sectionKey: 'crm',
    children: [
      { href: '/crm/societies', label: 'Societes' },
      { href: '/crm/contacts', label: 'Contacts' },
    ],
  },
  { href: '/projects', label: 'Projects' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/emails', label: 'Emails' },
  { href: '/documents', label: 'Documents' },
  { href: '/finance', label: 'Finance' },
  { href: '/timesheet', label: 'Timesheet' },
  { href: '/boite-mail', label: 'Boite mail' },
  {
    href: '/settings',
    label: 'Settings',
    sectionKey: 'settings',
    children: [
      { href: '/settings/workspace', label: 'Workspace' },
      { href: '/settings/parameters', label: 'Parametres' },
      { href: '/settings/users', label: 'Users' },
      { href: '/settings/log', label: 'Log' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [openSection, setOpenSection] = useState<string | null>(null);

  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

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
                onClick={() => setOpenSection(null)}
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

          const children = link.children ?? [];
          const sectionIsActive = isActive(link.href);
          const isSectionOpen = openSection === link.sectionKey || sectionIsActive;

          return (
            <div key={link.href} className="grid gap-1">
              <button
                type="button"
                onClick={() =>
                  setOpenSection((current) =>
                    current === link.sectionKey ? null : (link.sectionKey ?? null),
                  )
                }
                className={cn(
                  'flex items-center justify-between rounded-md px-3 py-2 text-left text-sm text-[var(--fg)] hover:bg-[#f2eee4]',
                  sectionIsActive
                    ? 'border border-[var(--line)] bg-[#f2eee4] font-bold'
                    : 'font-medium',
                )}
              >
                <span>{link.label}</span>
                <span className="text-xs">{isSectionOpen ? '▾' : '▸'}</span>
              </button>

              {isSectionOpen ? (
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
