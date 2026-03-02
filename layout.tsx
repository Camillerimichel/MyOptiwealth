import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { menu } from "@/lib/menu";

export const metadata: Metadata = {
  title: "Captiva Platform",
  description: "Suivi complet d’une captive d’assurance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <div className="grid grid-cols-[260px_1fr] min-h-screen">
          <aside className="bg-white border-r border-slate-200 p-4 space-y-4">
            <div className="text-xl font-semibold text-slate-800">Captiva</div>
            <nav className="space-y-2">
              {menu.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block px-3 py-2 rounded-md text-sm hover:bg-slate-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
