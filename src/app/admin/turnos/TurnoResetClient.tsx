'use client';

import { useState } from 'react';
import { Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function TurnoResetClient({ roundId, roundNumber }: { roundId: string; roundNumber: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const roundName = roundNumber === 1 ? 'Primeiro Turno' : roundNumber === 2 ? 'Segundo Turno' : `${roundNumber}º Turno`;
  const roundNameUpper = roundNumber === 1 ? 'PRIMEIRO TURNO' : roundNumber === 2 ? 'SEGUNDO TURNO' : `${roundNumber}º TURNO`;
  const expectedText = `ZERAR ${roundNameUpper}`;

  const handleReset = async () => {
    setError('');
    if (confirmText.trim() !== expectedText) {
      setError(`Digite exatamente: ${expectedText}`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationText: confirmText.trim(), roundId })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Erro interno ao zerar turno');
      }

      setSuccess(true);
      setTimeout(() => {
        setIsOpen(false);
        setConfirmText('');
        setSuccess(false);
        router.refresh();
      }, 1500);
      
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
        className="flex items-center gap-2 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider text-xs transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        Zerar Turno
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col">
            <div className="bg-red-50 border-b border-red-100 p-5 flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-bold uppercase tracking-wide">
                Zerar Dados do {roundName}
              </h3>
            </div>
            
            <div className="p-6 text-sm text-slate-700 space-y-4">
              <p>Ao realizar esta operação:</p>
              <ul className="list-disc pl-5 space-y-1 font-medium text-red-600">
                <li>Todos os BUs e Votos do <strong>{roundName}</strong> serão excluídos.</li>
              </ul>
              <ul className="list-disc pl-5 space-y-1 font-medium text-emerald-600 mt-2">
                <li>O catálogo geográfico oficial será mantido.</li>
                <li>Dados de <strong>outros turnos</strong> permanecerão intactos.</li>
              </ul>
              
              <div className="mt-6 pt-4 border-t border-slate-100">
                <p className="font-bold text-slate-900 mb-2">
                  Para prosseguir, digite: <span className="font-black text-red-600 select-all">{expectedText}</span>
                </p>
                <input 
                  type="text" 
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 font-bold text-slate-900 placeholder:text-slate-500 bg-white"
                  placeholder={expectedText}
                  disabled={loading || success}
                />
              </div>

              {error && <p className="text-red-600 font-bold text-xs mt-2">{error}</p>}
            </div>
            
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-end gap-3">
              <button 
                onClick={() => setIsOpen(false)}
                disabled={loading || success}
                className="px-4 py-2 rounded-lg font-bold uppercase tracking-wider text-xs text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleReset}
                disabled={loading || success || confirmText.trim() !== expectedText}
                className="px-4 py-2 rounded-lg font-bold uppercase tracking-wider text-xs bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? 'Limpando...' : success ? <><CheckCircle2 className="w-4 h-4" /> Zerado!</> : 'Executar Limpeza'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
