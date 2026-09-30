'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';

export default function ConfirmButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleConfirm() {
    if (loading) return;
    setLoading(true);
    setStatusMsg('Processando confirmação...');
    try {
      const res = await fetch(`/api/reports/${reportId}/confirm`, {
        method: 'POST'
      });
      if (res.ok) {
        setStatusMsg('Boletim processado com sucesso!');
        setTimeout(() => {
          router.push('/admin/scanner');
        }, 1500);
      } else {
        const data = await res.json().catch(() => null);
        alert(`Erro ao confirmar: ${data?.error || res.status}`);
        setLoading(false);
        setStatusMsg(null);
      }
    } catch {
      alert('Erro de rede ao confirmar o BU.');
      setLoading(false);
      setStatusMsg(null);
    }
  }

  async function handleCancel() {
    if (loading) return;
    if (!confirm('Deseja realmente cancelar este Boletim de Urna? Os dados lidos serão descartados.')) return;
    
    setLoading(true);
    setStatusMsg('Cancelando boletim...');
    try {
      await fetch(`/api/reports/${reportId}/cancel`, { method: 'POST' });
      router.push('/admin/scanner');
    } catch {
      alert('Erro ao cancelar.');
      setLoading(false);
      setStatusMsg(null);
    }
  }

  return (
    <div className="mt-8 flex flex-col w-full">
      {statusMsg && (
        <div className="mb-6 flex justify-center">
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-6 py-3 rounded-full text-sm font-bold tracking-wide shadow-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {statusMsg}
          </div>
        </div>
      )}
      
      <div className="flex flex-col-reverse md:flex-row gap-4 w-full md:justify-end">
        <button 
          onClick={handleCancel}
          disabled={loading}
          className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-4 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-all uppercase tracking-wide text-sm"
        >
          <X className="w-5 h-5" />
          Cancelar Leitura
        </button>
        <button 
          onClick={handleConfirm}
          disabled={loading}
          className="flex-1 md:flex-none flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 text-white font-black rounded-xl hover:bg-emerald-700 shadow-md shadow-emerald-600/20 disabled:opacity-50 transition-all uppercase tracking-wide text-lg"
        >
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <Check className="w-6 h-6" />
          )}
          {loading ? 'Processando...' : 'Confirmar e Totalizar'}
        </button>
      </div>
    </div>
  );
}
