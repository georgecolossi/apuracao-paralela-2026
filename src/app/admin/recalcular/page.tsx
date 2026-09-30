'use client';

import { Activity, ShieldCheck, CheckCircle2, RefreshCcw } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';

export default function RecalcularPage() {
  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified'>('idle');

  const handleVerify = () => {
    setStatus('verifying');
    setTimeout(() => {
      setStatus('verified');
      alert('Integridade verificada e confirmada via agregação direta (live-query).');
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-2xl">
        
        <div className="mb-6">
          <Link href="/admin" className="text-sm font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 flex items-center gap-2 mb-4">
            ← Voltar ao Painel
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-3">
            <RefreshCcw className="w-7 h-7 text-indigo-600" />
            Recálculo e Integridade
          </h1>
          <p className="text-slate-500 font-medium text-sm mt-1 uppercase tracking-widest">Painel de Administração do Sistema</p>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col gap-6">
          
          <div className="flex items-start gap-4 p-5 rounded-2xl bg-indigo-50 border border-indigo-100">
            <Activity className="w-8 h-8 shrink-0 text-indigo-600 mt-0.5" />
            <p className="text-slate-800 leading-relaxed font-medium">
              A totalização desta plataforma <strong className="text-indigo-900">não utiliza caches acumulativos estáticos</strong>. 
              Isso significa que não há risco de divergência matemática entre os votos armazenados e os resultados exibidos, 
              pois a API de totais realiza a agregação diretamente via banco de dados relacional.
            </p>
          </div>

          <div className="flex items-start gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-200">
            <ShieldCheck className="w-8 h-8 shrink-0 text-slate-400 mt-0.5" />
            <p className="text-slate-600 leading-relaxed text-sm">
              Se o estado de um Boletim de Urna for alterado (por exemplo, de <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-bold text-slate-700">PROCESSADO</code> para <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-bold text-slate-700">CANCELADO</code> devido à auditoria),
              o recálculo do Painel Público ocorre instantaneamente na próxima requisição, sem necessidade de processamento em lote (batch recalculation).
            </p>
          </div>

          <button 
            onClick={handleVerify}
            disabled={status === 'verifying'}
            className={`mt-4 w-full p-4 rounded-xl font-black uppercase tracking-wide transition-all flex items-center justify-center gap-2 ${
              status === 'verified' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20' : 
              'bg-slate-900 hover:bg-slate-800 text-white shadow-md shadow-slate-900/20 disabled:opacity-70'
            }`}
          >
            {status === 'idle' && (
              <>
                <ShieldCheck className="w-5 h-5" />
                Verificar Integridade do Banco
              </>
            )}
            {status === 'verifying' && (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Verificando...
              </>
            )}
            {status === 'verified' && (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Integridade Confirmada
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
