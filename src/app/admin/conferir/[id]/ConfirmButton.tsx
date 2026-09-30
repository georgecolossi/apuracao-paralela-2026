'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ConfirmButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleConfirm() {
    if (loading) return; // Prevent double click
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
    } catch (e) {
      alert('Erro de rede ao confirmar o BU.');
      setLoading(false);
      setStatusMsg(null);
    }
  }

  async function handleCancel() {
    if (loading) return;
    if (!confirm('Deseja realmente cancelar este Boletim de Urna?')) return;
    
    setLoading(true);
    setStatusMsg('Cancelando...');
    try {
      await fetch(`/api/reports/${reportId}/cancel`, { method: 'POST' });
      router.push('/admin/scanner');
    } catch (e) {
      alert('Erro ao cancelar.');
      setLoading(false);
      setStatusMsg(null);
    }
  }

  return (
    <div className="mt-8 flex flex-col items-center">
      {statusMsg && (
        <div className="mb-4 text-lg font-bold text-blue-900 bg-blue-100 px-6 py-2 rounded-lg animate-pulse">
          {statusMsg}
        </div>
      )}
      
      <div className="flex flex-col-reverse md:flex-row gap-4 w-full md:w-auto md:justify-end">
        <button 
          onClick={handleCancel}
          disabled={loading}
          className="w-full md:w-auto px-8 py-4 bg-gray-200 text-gray-800 font-bold rounded hover:bg-gray-300 disabled:opacity-50 transition"
        >
          CANCELAR BOLETIM
        </button>
        <button 
          onClick={handleConfirm}
          disabled={loading}
          className="w-full md:w-auto px-8 py-4 bg-green-600 text-white font-extrabold rounded hover:bg-green-700 shadow-lg disabled:opacity-50 transition uppercase tracking-wide text-lg flex justify-center items-center"
        >
          {loading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processando...
            </span>
          ) : 'CONFIRMAR BOLETIM'}
        </button>
      </div>
    </div>
  );
}
