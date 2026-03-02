import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Captiva Platform",
  description: "Suivi complet d’une captive d’assurance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#e2e8f0,transparent_35%),radial-gradient(circle_at_80%_0,#cbd5e1,transparent_25%)]">
          <div className="mr-auto ml-0 grid min-h-screen w-full max-w-[90rem] grid-cols-[260px_1fr] gap-6 px-6 py-6">
            <Sidebar />
            <main className="relative z-10 rounded-xl bg-white/90 backdrop-blur border border-slate-200 shadow-sm p-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
