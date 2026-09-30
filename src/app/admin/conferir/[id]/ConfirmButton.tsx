'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ConfirmButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/confirm`, {
        method: 'POST'
      });
      if (res.ok) {
        router.push('/admin/scanner'); // volta pro scanner
        router.refresh();
      } else {
        alert('Erro ao confirmar');
      }
    } catch (e) {
      alert('Erro de rede');
    }
    setLoading(false);
  }

  async function handleCancel() {
    setLoading(true);
    try {
      await fetch(`/api/reports/${reportId}/cancel`, { method: 'POST' });
      router.push('/admin/scanner');
    } catch (e) {}
    setLoading(false);
  }

  return (
    <div className="flex gap-4 mt-6 justify-end">
      <button 
        onClick={handleCancel}
        disabled={loading}
        className="px-6 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200"
      >
        Cancelar
      </button>
      <button 
        onClick={handleConfirm}
        disabled={loading}
        className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold shadow-lg"
      >
        Confirmar Processamento
      </button>
    </div>
  );
}
