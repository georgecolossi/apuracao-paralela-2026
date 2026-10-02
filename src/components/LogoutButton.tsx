'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  
  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh(); // Ensure RSC payloads are flushed
  };

  return (
    <button 
      onClick={handleLogout}
      className="flex items-center gap-2 text-sm bg-red-900/40 hover:bg-red-800/80 px-3 py-1.5 rounded-lg text-white border border-red-800/50 transition-colors"
      title="Sair"
    >
      <LogOut className="w-4 h-4" />
      <span className="hidden sm:inline font-bold tracking-wide uppercase">Sair</span>
    </button>
  );
}
