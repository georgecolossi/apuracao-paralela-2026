import Link from 'next/link';
import { prisma } from '@/lib/db';
import { LogoutButton } from '@/components/LogoutButton';
import { ScanLine, LayoutDashboard, Users, FileText, CheckCircle2, AlertCircle, Clock, Search, RotateCcw, ShieldCheck, Download, Trash2, MapPin } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const totalBUs = await prisma.ballotReport.count({ where: { isSimulation: false } });
  const processedBUs = await prisma.ballotReport.count({ where: { status: 'PROCESSADO', isSimulation: false } });
  const pendingBUs = await prisma.ballotReport.count({ where: { status: 'PENDENTE_CONFIRMACAO', isSimulation: false } });
  const duplicateBUs = await prisma.ballotReport.count({ where: { status: 'DUPLICADO', isSimulation: false } });

  const activeOperators = await prisma.user.count({ where: { isActive: true } });

  const recentBUs = await prisma.ballotReport.findMany({
    where: { isSimulation: false },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col">
      <header className="bg-slate-900 text-white shadow-md border-b-4 border-indigo-600">
        <div className="max-w-5xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl font-bold uppercase tracking-tight">Admin <span className="text-indigo-400">Panel</span></h1>
          </div>
          <div className="flex items-center gap-3">
            <LogoutButton />
            <a href="/apuracao" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-white border border-slate-700 transition-colors">
              <span className="hidden sm:inline">Ver Painel Público</span>
              <ScanLine className="w-4 h-4 sm:hidden" />
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-5xl mx-auto w-full flex flex-col gap-6">
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Action Call */}
          <Link href="/admin/scanner" className="md:col-span-3 bg-indigo-600 text-white p-6 md:p-8 rounded-2xl text-center hover:bg-indigo-700 font-bold block shadow-md shadow-indigo-600/20 transition-all transform hover:-translate-y-1 relative overflow-hidden group">
            <div className="absolute inset-0 bg-indigo-500 opacity-0 group-hover:opacity-20 transition-opacity" />
            <ScanLine className="w-12 h-12 mx-auto mb-3 text-indigo-200 group-hover:scale-110 transition-transform" />
            <h2 className="text-2xl md:text-3xl uppercase tracking-widest mb-1 font-black">Ler Boletim de Urna</h2>
            <p className="text-indigo-200 font-medium text-sm tracking-wide uppercase">Acessar o scanner e coletar QR Codes</p>
          </Link>
          
          {/* Operator Stats */}
          <div className="bg-white p-6 shadow-sm rounded-2xl border border-slate-200 flex flex-col justify-center items-center">
            <Users className="w-8 h-8 text-slate-400 mb-2" />
            <h3 className="font-bold text-slate-500 uppercase text-xs tracking-widest mb-1">Operadores Ativos</h3>
            <span className="text-5xl font-black text-slate-900">{activeOperators}</span>
          </div>

          {/* BU Stats */}
          <div className="md:col-span-2 bg-white p-6 shadow-sm rounded-2xl border border-slate-200 flex flex-col justify-center">
            <h3 className="font-bold text-slate-700 uppercase text-sm tracking-wide mb-5 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              Estatísticas da Operação (Reais)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <p className="text-3xl font-black text-slate-900">{totalBUs}</p>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mt-1">Lidos (Total)</p>
              </div>
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                <p className="text-3xl font-black text-emerald-600">{processedBUs}</p>
                <p className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider mt-1">Processados</p>
              </div>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100">
                <p className="text-3xl font-black text-amber-600">{pendingBUs}</p>
                <p className="text-[10px] text-amber-600 uppercase font-bold tracking-wider mt-1">Pendentes</p>
              </div>
              <div className="bg-red-50 p-3 rounded-xl border border-red-100">
                <p className="text-3xl font-black text-red-600">{duplicateBUs}</p>
                <p className="text-[10px] text-red-600 uppercase font-bold tracking-wider mt-1">Duplicados</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent History */}
        <div className="bg-white p-6 shadow-sm rounded-2xl border border-slate-200">
          <h3 className="font-bold text-slate-700 uppercase text-sm tracking-wide mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            Últimos Boletins Inseridos
          </h3>
          
          {recentBUs.length === 0 ? (
            <div className="text-slate-400 text-center py-8 flex flex-col items-center justify-center">
              <FileText className="w-8 h-8 mb-2 opacity-50" />
              <p className="font-medium text-sm">Nenhum boletim lido ainda.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase tracking-wider bg-slate-50 border-y border-slate-100">
                    <th className="py-3 px-4 font-bold rounded-l-lg">Horário</th>
                    <th className="py-3 px-4 font-bold">Localização (Mun/Zona/Seção)</th>
                    <th className="py-3 px-4 font-bold rounded-r-lg">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBUs.map(bu => (
                    <tr key={bu.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {new Date(bu.createdAt).toLocaleTimeString('pt-BR')}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800">
                        {bu.cityCode} <span className="text-slate-300 font-normal">/</span> {bu.zoneCode} <span className="text-slate-300 font-normal">/</span> {bu.sectionCode}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                          bu.status === 'PROCESSADO' ? 'bg-emerald-100 text-emerald-800' :
                          bu.status === 'DUPLICADO' ? 'bg-red-100 text-red-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {bu.status === 'PROCESSADO' && <CheckCircle2 className="w-3 h-3" />}
                          {bu.status === 'DUPLICADO' && <AlertCircle className="w-3 h-3" />}
                          {bu.status === 'PENDENTE_CONFIRMACAO' && <Clock className="w-3 h-3" />}
                          {bu.status === 'PENDENTE_CONFIRMACAO' ? 'PENDENTE' : bu.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Link href="/admin/cobertura" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group">
            <MapPin className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Cobertura</span>
          </Link>
          <Link href="/admin/conferencia" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group">
            <Search className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Conferência Global</span>
          </Link>
          <Link href="/admin/recalcular" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group">
            <RotateCcw className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Integridade</span>
          </Link>
          <Link href="/admin/audit" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group">
            <ShieldCheck className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Logs de Auditoria</span>
          </Link>
          <Link href="/api/export?format=csv" target="_blank" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group">
            <Download className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Exportar CSV</span>
          </Link>

          <Link href="/admin/preparar" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-red-50 transition-colors flex flex-col items-center gap-2 group">
            <Trash2 className="w-5 h-5 text-red-400 group-hover:text-red-600 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-red-600 group-hover:text-red-700">Zerar</span>
          </Link>
        </div>

      </main>
    </div>
  );
}
