'use client';

import { useState } from 'react';
import { PlayCircle, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function TurnoManagerClient({ roundId, roundNumber, hasActiveRound }: { roundId: string; roundNumber: number; hasActiveRound: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleActivate = async () => {
    setError('');
    const expected = `ATIVAR ${roundNumber}º TURNO`;
    if (confirmText.trim().toUpperCase() !== expected.toUpperCase()) {
      setError(`Digite exatamente: ${expected}`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/turnos/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Erro interno ao ativar turno');
      }

      setIsOpen(false);
      setConfirmText('');
      router.refresh();
      
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold uppercase tracking-wider text-sm transition-colors"
      >
        <PlayCircle className="w-4 h-4" />
        Ativar Turno
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col">
            <div className="bg-red-50 border-b border-red-100 p-5 flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-bold uppercase tracking-wide">
                {hasActiveRound ? `Você está prestes a encerrar o turno atual e ativar o ${roundNumber}º Turno.` : `Você está prestes a ativar o ${roundNumber}º Turno.`}
              </h3>
            </div>
            
            <div className="p-6 text-sm text-slate-700 space-y-4">
              <p>Ao realizar esta operação:</p>
              <ul className="list-disc pl-5 space-y-1 font-medium">
                <li>BUs dos turnos encerrados <strong>NÃO</strong> serão apagados.</li>
                <li>O histórico continuará disponível em /admin/conferencia.</li>
                <li>O Painel Público passará a mostrar exclusivamente o <strong>{roundNumber}º Turno</strong>.</li>
                <li>O Scanner passará a aceitar somente QRBUs compatíveis com o novo turno ativo.</li>
              </ul>
              
              <div className="mt-6 pt-4 border-t border-slate-100">
                <p className="font-bold text-slate-900 mb-2">
                  Para prosseguir, digite: <span className="font-black bg-slate-100 px-2 py-0.5 rounded select-all">ATIVAR {roundNumber}º TURNO</span>
                </p>
                <input 
                  type="text" 
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-bold uppercase"
                  placeholder={`ATIVAR ${roundNumber}º TURNO`}
                  disabled={loading}
                />
              </div>

              {error && <p className="text-red-600 font-bold text-xs mt-2">{error}</p>}
            </div>
            
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-end gap-3">
              <button 
                onClick={() => setIsOpen(false)}
                disabled={loading}
                className="px-4 py-2 rounded-lg font-bold uppercase tracking-wider text-xs text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleActivate}
                disabled={loading}
                className="px-4 py-2 rounded-lg font-bold uppercase tracking-wider text-xs bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
              >
                {loading ? 'Processando...' : 'Confirmar Ativação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
