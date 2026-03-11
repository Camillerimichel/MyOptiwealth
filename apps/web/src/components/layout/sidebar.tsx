'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';

const links = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/calendar', label: 'Calendrier' },
  {
    href: '/crm',
    label: 'CRM',
    sectionKey: 'crm',
    children: [
      { href: '/crm/societies', label: 'Sociétés' },
      { href: '/crm/contacts', label: 'Contacts' },
    ],
  },
  { href: '/projects', label: 'Projets' },
  { href: '/tasks', label: 'Tâches' },
  { href: '/emails', label: 'E-mails' },
  { href: '/documents', label: 'Documents' },
  { href: '/timesheet', label: 'Feuille de temps' },
  { href: '/finance', label: 'Finance' },
  {
    href: '/boite-mail',
    label: 'Boîte mail',
    sectionKey: 'boite-mail',
    children: [
      { href: '/boite-mail', label: 'Globale' },
      { href: '/boite-mail-inbox', label: 'Réception' },
    ],
  },
  {
    href: '/settings',
    label: 'Paramètres',
    sectionKey: 'settings',
    children: [
      { href: '/settings/workspace', label: 'Espaces de travail' },
      { href: '/settings/parameters', label: 'Paramètres' },
      { href: '/settings/users', label: 'Utilisateurs' },
      { href: '/settings/log', label: 'Journal' },
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
          const sectionIsActive = isActive(link.href) || children.some((child) => isActive(child.href));
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
