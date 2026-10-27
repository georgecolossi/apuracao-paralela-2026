import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/lib/auth';
import { Activity, ShieldCheck, RefreshCcw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default async function IntegridadePage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) {
    redirect('/login');
  }
  if (auth.user.role !== 'ADMIN') {
    redirect('/admin');
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-2xl">
        
        <div className="mb-6">
          <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" />
            Voltar ao Dashboard
          </Link>
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

          <div className="flex items-start gap-4 p-5 rounded-2xl bg-emerald-50 border border-emerald-100">
            <ShieldCheck className="w-8 h-8 shrink-0 text-emerald-600 mt-0.5" />
            <p className="text-slate-800 leading-relaxed font-medium">
              A integridade é garantida pela verificação estrita de cada hash SHA-512 e chave canônica 
              única para cada seção eleitoral, prevenindo votos duplicados de forma idempotente e segura.
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}
