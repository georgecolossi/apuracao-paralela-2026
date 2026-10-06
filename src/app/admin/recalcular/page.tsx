import { Activity, ShieldCheck, RefreshCcw } from 'lucide-react';
import Link from 'next/link';

export default function IntegridadePage() {
  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-2xl">
        
        <div className="mb-6">

          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-3">
            <RefreshCcw className="w-7 h-7 text-indigo-600" />
            Integridade da Totalização
          </h1>
          <p className="text-slate-500 font-medium text-sm mt-1 uppercase tracking-widest">Informativo Arquitetural</p>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col gap-6">
          
          <div className="flex items-start gap-4 p-5 rounded-2xl bg-indigo-50 border border-indigo-100">
            <Activity className="w-8 h-8 shrink-0 text-indigo-600 mt-0.5" />
            <p className="text-slate-800 leading-relaxed font-medium">
              Os totais exibidos são calculados a partir dos BUs elegíveis armazenados no banco, 
              reduzindo a dependência de contadores acumulativos separados. A agregação ocorre 
              diretamente via banco de dados relacional (live-query).
            </p>
          </div>

          <div className="flex items-start gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-200">
            <ShieldCheck className="w-8 h-8 shrink-0 text-slate-400 mt-0.5" />
            <p className="text-slate-600 leading-relaxed text-sm">
              Se o estado de um Boletim de Urna for alterado (por exemplo, de <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-bold text-slate-700">PROCESSADO</code> para <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-bold text-slate-700">CANCELADO</code> devido à auditoria),
              o recálculo do Painel Público reflete essa mudança na próxima requisição, eliminando a necessidade de processamento em lote (batch recalculation).
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
