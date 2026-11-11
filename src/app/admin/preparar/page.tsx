'use client';

import { ShieldAlert, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getConfirmationAliases, validateAdminConfirmation } from '@/lib/normalization';

interface RoundItem {
  id: string;
  roundNumber: number;
  status: string;
  plei?: string | null;
}

export default function PrepararApuracaoPage() {
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [rounds, setRounds] = useState<RoundItem[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/admin/turnos')
      .then(r => r.json())
      .then(data => {
        if (data.rounds && Array.isArray(data.rounds) && data.rounds.length > 0) {
          setRounds(data.rounds);
          const active = data.rounds.find((r: RoundItem) => r.status === 'ACTIVE') || data.rounds[0];
          setSelectedRoundId(active.id);
        }
      })
      .catch(() => {});
  }, []);

  const selectedRound = rounds.find(r => r.id === selectedRoundId);
  const { canonical: expectedText, aliases } = getConfirmationAliases('RESET', selectedRound?.roundNumber);
  const isConfirmationValid = validateAdminConfirmation(confirmation, aliases);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmationValid || !selectedRoundId) return;
    
    setStatus('loading');
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmationText: confirmation.trim(),
          roundId: selectedRoundId
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro desconhecido');
      }
      
      setStatus('success');
      setTimeout(() => {
        router.push('/apuracao');
      }, 2000);
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-2xl">
        
        <div className="mb-6">
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-3">
            <Trash2 className="w-7 h-7 text-red-600" />
            Preparar Apuração (Limpeza Operacional)
          </h1>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col gap-6">
          
          <div className="flex items-start gap-4 p-5 rounded-2xl bg-red-50 border border-red-200">
            <ShieldAlert className="w-8 h-8 shrink-0 text-red-600 mt-0.5" />
            <div className="text-red-900 leading-relaxed font-medium">
              <h2 className="font-bold text-lg mb-2 uppercase tracking-wide">Atenção: Operação Irreversível</h2>
              <p className="mb-4">
                Esta ação prepara o sistema para o início da apuração ou limpa testes e simulações do turno selecionado.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mt-4">
                <div>
                  <h3 className="font-bold uppercase tracking-wider text-red-800 mb-1">O que será APAGADO:</h3>
                  <ul className="list-disc pl-5 space-y-1 text-red-700">
                    <li>Boletins de Urna (BUs) do turno</li>
                    <li>Votos processados</li>
                    <li>Totais do turno na Apuração Pública</li>
                    <li>Sessões de Scanner vinculadas</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-bold uppercase tracking-wider text-emerald-800 mb-1">O que será MANTIDO:</h3>
                  <ul className="list-disc pl-5 space-y-1 text-emerald-700">
                    <li>Configuração da Eleição</li>
                    <li>Usuários e Senhas</li>
                    <li>Catálogo de Candidatos e Partidos</li>
                    <li>Área de Cobertura e Seções</li>
                    <li>Outros turnos não selecionados</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {rounds.length > 1 && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">
                Selecione o Turno a Zerar:
              </label>
              <div className="grid grid-cols-2 gap-3">
                {rounds.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRoundId(r.id)}
                    className={`p-3 rounded-xl border text-sm font-bold uppercase tracking-wider transition-colors ${
                      selectedRoundId === r.id
                        ? 'border-red-500 bg-red-50 text-red-900 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {r.roundNumber}º Turno {r.status === 'ACTIVE' && '(Ativo)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleReset} className="flex flex-col gap-4 mt-2">
            <label className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Para confirmar, digite: <span className="text-red-600 font-black">{expectedText || 'ZERAR APURAÇÃO'}</span>
            </label>
            <input 
              type="text" 
              className="w-full border-2 border-slate-300 bg-slate-50 p-4 rounded-xl text-slate-900 font-bold focus:ring-4 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all text-center tracking-widest text-lg"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={expectedText || 'ZERAR APURAÇÃO'}
            />

            {status === 'error' && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm font-bold mt-2">
                <AlertTriangle className="w-5 h-5" />
                {errorMsg}
              </div>
            )}

            <button 
              type="submit"
              disabled={!isConfirmationValid || status === 'loading' || status === 'success'}
              className={`w-full p-4 rounded-xl font-black uppercase tracking-wide transition-all flex items-center justify-center gap-2 mt-2 ${
                status === 'success' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20' : 
                'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-600/20 disabled:opacity-50 disabled:grayscale'
              }`}
            >
              {status === 'idle' || status === 'error' ? (
                <>
                  <Trash2 className="w-5 h-5" />
                  Executar Limpeza Transacional
                </>
              ) : status === 'loading' ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Limpando Banco...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Apuração Zerada!
                </>
              )}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
