'use client';

import { ShieldAlert, AlertTriangle, CheckCircle2, ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function PrepararApuracaoPage() {
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmation !== 'ZERAR APURAÇÃO') return;
    
    setStatus('loading');
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationText: confirmation })
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
            Preparar Apuração Real
          </h1>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col gap-6">
          
          <div className="flex items-start gap-4 p-5 rounded-2xl bg-red-50 border border-red-200">
            <ShieldAlert className="w-8 h-8 shrink-0 text-red-600 mt-0.5" />
            <div className="text-red-900 leading-relaxed font-medium">
              <h2 className="font-bold text-lg mb-2 uppercase tracking-wide">Atenção: Operação Irreversível</h2>
              <p className="mb-4">
                Esta ação prepara o sistema para o início da apuração oficial. Todos os testes, ensaios e BUs escaneados anteriormente serão apagados.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mt-4">
                <div>
                  <h3 className="font-bold uppercase tracking-wider text-red-800 mb-1">O que será APAGADO:</h3>
                  <ul className="list-disc pl-5 space-y-1 text-red-700">
                    <li>Boletins de Urna (BUs) lidos</li>
                    <li>Votos processados</li>
                    <li>Totais da Apuração Pública</li>
                    <li>Sessões de Scanner antigas</li>
                    <li>Histórico de auditoria de testes</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-bold uppercase tracking-wider text-emerald-800 mb-1">O que será MANTIDO:</h3>
                  <ul className="list-disc pl-5 space-y-1 text-emerald-700">
                    <li>Configuração da Eleição</li>
                    <li>Usuários e Senhas</li>
                    <li>Cargos e Partidos base</li>
                    <li>Área de Cobertura</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleReset} className="flex flex-col gap-4 mt-2">
            <label className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Para confirmar, digite exatamente: <span className="text-red-600 font-black">ZERAR APURAÇÃO</span>
            </label>
            <input 
              type="text" 
              className="w-full border-2 border-slate-300 bg-slate-50 p-4 rounded-xl text-slate-900 font-bold focus:ring-4 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all text-center tracking-widest text-lg"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="ZERAR APURAÇÃO"
            />

            {status === 'error' && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm font-bold mt-2">
                <AlertTriangle className="w-5 h-5" />
                {errorMsg}
              </div>
            )}

            <button 
              type="submit"
              disabled={confirmation !== 'ZERAR APURAÇÃO' || status === 'loading' || status === 'success'}
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
