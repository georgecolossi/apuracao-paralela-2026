import { prisma } from '@/lib/db';
import Link from 'next/link';
import { Search, ArrowLeft, Database, CheckCircle2, AlertCircle, Clock, FileCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ConferenciaGlobal() {
  const reports = await prisma.ballotReport.findMany({
    orderBy: { createdAt: 'desc' },
    include: { operator: true, round: true }
  });

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col">


      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 py-8">
        <div className="bg-white p-6 shadow-sm rounded-2xl border border-slate-200">
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-4 flex items-center gap-2">
            <Search className="w-5 h-5 text-slate-400" />
            Todos os Boletins Processados
          </h2>
          
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">
                  <th className="py-3 px-4 font-black">Data/Hora</th>
                  <th className="py-3 px-4 font-black">Turno</th>
                  <th className="py-3 px-4 font-black">Município</th>
                  <th className="py-3 px-4 font-black">Zona / Seç / Urna</th>
                  <th className="py-3 px-4 font-black">Operador</th>
                  <th className="py-3 px-4 font-black text-center">Modo</th>
                  <th className="py-3 px-4 font-black">Status</th>
                  <th className="py-3 px-4 font-black text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 font-medium">Nenhum BU inserido no sistema.</td>
                  </tr>
                ) : (
                  reports.map(rep => (
                    <tr key={rep.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {rep.createdAt.toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800 text-center">{rep.round?.roundNumber || "?"}º Turno</td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {rep.cityCode} <span className="text-slate-400 font-normal">({rep.stateCode})</span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-700">
                        {rep.zoneCode} <span className="text-slate-300 font-normal">/</span> {rep.sectionCode} <span className="text-slate-300 font-normal">/</span> {rep.urnCode}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700">
                        {rep.operator?.name || 'Sistema'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                          rep.isSimulation ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-blue-700'
                        }`}>
                          {rep.isSimulation ? 'SIMULAÇÃO' : 'REAL'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                          rep.status === 'PROCESSADO' ? 'bg-emerald-100 text-emerald-800' :
                          rep.status === 'DUPLICADO' ? 'bg-red-100 text-red-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {rep.status === 'PROCESSADO' && <CheckCircle2 className="w-3 h-3" />}
                          {rep.status === 'DUPLICADO' && <AlertCircle className="w-3 h-3" />}
                          {rep.status === 'PENDENTE_CONFIRMACAO' && <Clock className="w-3 h-3" />}
                          {rep.status === 'PENDENTE_CONFIRMACAO' ? 'PENDENTE' : rep.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link href={`/admin/conferir/${rep.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-indigo-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors">
                          <FileCheck className="w-4 h-4" />
                          Inspecionar
                        </Link>
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
