import { prisma } from '@/lib/db';
import Link from 'next/link';
import { ShieldCheck, ArrowLeft, TerminalSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      user: true,
      report: true
    }
  });

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col">


      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 py-8">
        <div className="bg-white p-6 shadow-sm rounded-2xl border border-slate-200">
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-4 flex items-center gap-2">
            <TerminalSquare className="w-5 h-5 text-slate-400" />
            Registro Histórico de Ações (Top 50)
          </h2>
          
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">
                  <th className="py-3 px-4 font-black">Data/Hora</th>
                  <th className="py-3 px-4 font-black">Ação</th>
                  <th className="py-3 px-4 font-black">Resultado</th>
                  <th className="py-3 px-4 font-black">BU ID</th>
                  <th className="py-3 px-4 font-black">Usuário</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 font-medium">Nenhum log de auditoria encontrado.</td>
                  </tr>
                ) : (
                  logs.map(log => (
                    <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {log.createdAt.toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md text-xs tracking-wider uppercase">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                          log.result === 'SUCCESS' ? 'bg-emerald-100 text-emerald-800' :
                          log.result === 'ERROR' ? 'bg-red-100 text-red-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {log.result}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500">
                        {log.reportId ? (
                           <Link href={`/admin/conferir/${log.reportId}`} className="hover:text-indigo-600 hover:underline">
                             {log.reportId.split('-')[0]}...
                           </Link>
                        ) : '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-bold">
                        {log.user?.email || 'Sistema'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
