'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ScanLine, Clock, Settings, LogOut, Menu, ExternalLink } from 'lucide-react';
import { useState } from 'react';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const links = [
    { href: '/admin', label: 'Painel', icon: LayoutDashboard },
    { href: '/admin/scanner', label: 'Scanner', icon: ScanLine },
    { href: '/admin/turnos', label: 'Turnos', icon: Clock },
    { href: '/admin/configuracao', label: 'Configuração', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-slate-900 text-white shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <span className="font-bold text-lg tracking-wide uppercase text-indigo-400">Apuração Admin</span>
              
              <nav className="hidden md:flex items-center gap-1">
                {links.map(link => {
                  const isActive = pathname === link.href;
                  return (
                    <Link key={link.href} href={link.href} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                      <link.icon className="w-4 h-4" />
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            
            <div className="hidden md:flex items-center gap-4">
              <Link href="/apuracao" target="_blank" className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors">
                Ver apuração pública
                <ExternalLink className="w-4 h-4" />
              </Link>
              <div className="w-px h-6 bg-slate-700"></div>
              <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-slate-300 hover:text-red-400 transition-colors">
                Sair
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            <button className="md:hidden p-2 text-slate-300 hover:text-white" onClick={() => setMenuOpen(!menuOpen)}>
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden bg-slate-800 border-t border-slate-700">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {links.map(link => {
                const isActive = pathname === link.href;
                return (
                  <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className={`flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}>
                    <link.icon className="w-5 h-5" />
                    {link.label}
                  </Link>
                );
              })}
              <Link href="/apuracao" target="_blank" className="flex items-center gap-3 px-3 py-3 text-base font-medium text-slate-300 hover:bg-slate-700 hover:text-white">
                <ExternalLink className="w-5 h-5" />
                Ver apuração pública
              </Link>
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-3 text-base font-medium text-slate-300 hover:bg-slate-700 hover:text-red-400 text-left">
                <LogOut className="w-5 h-5" />
                Sair
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
