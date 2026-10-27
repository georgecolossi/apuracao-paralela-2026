import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';
import { LogoutButton } from '@/components/LogoutButton';
import {
  ScanLine,
  LayoutDashboard,
  Users,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  RotateCcw,
  ShieldCheck,
  Download,
  Trash2,
  MapPin,
  Archive,
  Layers,
  ExternalLink,
  Eye,
  Settings
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) {
    redirect('/login');
  }

  const role = auth.user.role || 'OPERATOR';
  const isAdmin = role === 'ADMIN';
  const isViewer = role === 'VIEWER';

  const activeOperators = await prisma.user.count({ where: { isActive: true } });

  const activeElections = await prisma.election.findMany({
    where: { status: 'ACTIVE' },
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' }
      }
    }
  });

  const election = activeElections.length === 1 ? activeElections[0] : null;
  const activeRound = election?.rounds.find(r => r.status === 'ACTIVE') || null;
  const activeRoundId = activeRound?.id;
  const contextualizedName = activeRound
    ? `Eleições Gerais ${election?.year || 2026} — ${activeRound.roundNumber}º Turno`
    : election?.name || 'Eleição Principal';
  const activePlei = activeRound?.plei || election?.plei || '3221';

  // Estatísticas exclusivas do Turno Ativo
  const activeTotalBUs = activeRoundId
    ? await prisma.ballotReport.count({ where: { roundId: activeRoundId, isSimulation: false } })
    : 0;
  const activeProcessedBUs = activeRoundId
    ? await prisma.ballotReport.count({ where: { roundId: activeRoundId, status: 'PROCESSADO', isSimulation: false } })
    : 0;
  const activePendingBUs = activeRoundId
    ? await prisma.ballotReport.count({ where: { roundId: activeRoundId, status: 'PENDENTE_CONFIRMACAO', isSimulation: false } })
    : 0;
  const activeDuplicateBUs = activeRoundId
    ? await prisma.ballotReport.count({ where: { roundId: activeRoundId, status: 'DUPLICADO', isSimulation: false } })
    : 0;

  // Estatísticas históricas (Turnos Finalizados)
  const finishedRounds = election?.rounds.filter(r => r.status === 'FINISHED') || [];
  const finishedRoundIds = finishedRounds.map(r => r.id);
  const historicalTotalBUs = finishedRoundIds.length > 0
    ? await prisma.ballotReport.count({ where: { roundId: { in: finishedRoundIds }, isSimulation: false } })
    : 0;
  const historicalProcessedBUs = finishedRoundIds.length > 0
    ? await prisma.ballotReport.count({ where: { roundId: { in: finishedRoundIds }, status: 'PROCESSADO', isSimulation: false } })
    : 0;

  // Últimos boletins inseridos
  const recentBUs = await prisma.ballotReport.findMany({
    where: { isSimulation: false },
    orderBy: { createdAt: 'desc' },
    take: 6,
    include: { round: true }
  });

  return (
    <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-5xl mx-auto w-full flex flex-col gap-6">
        
        {/* User Identity & Role Banner */}
        <div className="flex items-center justify-between bg-slate-900 text-white px-5 py-3 rounded-2xl border border-slate-800 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-indigo-400 text-sm">
              {(auth.user.name || auth.user.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <span>{auth.user.name || auth.user.email}</span>
                {isAdmin && (
                  <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    Administrador
                  </span>
                )}
                {role === 'OPERATOR' && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    Operador
                  </span>
                )}
                {isViewer && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    Visualizador (Leitura)
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">{auth.user.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link
                href="/admin/usuarios"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
              >
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                Usuários
              </Link>
            )}
            <LogoutButton />
          </div>
        </div>

        {/* Main Action Call */}
        {!isViewer ? (
          <Link href="/admin/scanner" className="bg-indigo-600 text-white p-6 md:p-8 rounded-2xl text-center hover:bg-indigo-700 font-bold block shadow-md shadow-indigo-600/20 transition-all transform hover:-translate-y-1 relative overflow-hidden group">
            <div className="absolute inset-0 bg-indigo-500 opacity-0 group-hover:opacity-20 transition-opacity" />
            <ScanLine className="w-12 h-12 mx-auto mb-3 text-indigo-200 group-hover:scale-110 transition-transform" />
            <h2 className="text-2xl md:text-3xl uppercase tracking-widest mb-1 font-black">Ler Boletim de Urna</h2>
            <p className="text-indigo-200 font-medium text-sm tracking-wide uppercase">Acessar o scanner e coletar QR Codes</p>
          </Link>
        ) : (
          <div className="bg-slate-900 border border-slate-800 text-slate-300 p-6 md:p-8 rounded-2xl text-center shadow-sm">
            <Eye className="w-12 h-12 mx-auto mb-3 text-amber-400 opacity-80" />
            <h2 className="text-xl md:text-2xl uppercase tracking-wide mb-1 font-bold text-white">Perfil de Visualização Ativo</h2>
            <p className="text-slate-400 text-sm">Você possui permissão de consulta e auditoria em tempo real, sem acesso de escrita ou leitura de BUs.</p>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Status do Turno Ativo */}
          <div className="bg-white p-6 shadow-sm rounded-2xl border border-slate-200 flex flex-col justify-center items-center text-center relative overflow-hidden">
            <h3 className="font-bold text-slate-500 uppercase text-xs tracking-wider mb-1 line-clamp-1" title={contextualizedName}>
              {contextualizedName}
            </h3>
            {activeRound ? (
              <>
                <span className="text-3xl font-black text-indigo-700 my-1">{activeRound.roundNumber}º Turno</span>
                <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  PLEI {activePlei}
                </span>
              </>
            ) : (
              <span className="text-3xl font-black text-slate-900">INDISP.</span>
            )}
            {isAdmin && (
              <Link href="/admin/turnos" className="mt-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider px-3 py-1.5 rounded transition-colors">
                Gerenciar Turnos
              </Link>
            )}
          </div>
          
          {/* Usuários Ativos */}
          <div className="bg-white p-6 shadow-sm rounded-2xl border border-slate-200 flex flex-col justify-center items-center">
            <Users className="w-8 h-8 text-slate-400 mb-2" />
            <h3 className="font-bold text-slate-500 uppercase text-xs tracking-widest mb-1">Usuários Ativos</h3>
            <span className="text-5xl font-black text-slate-900">{activeOperators}</span>
            {isAdmin && (
              <Link href="/admin/usuarios" className="mt-3 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                Gerenciar Usuários &rarr;
              </Link>
            )}
          </div>

          {/* Estatísticas do Turno Ativo */}
          <div className="md:col-span-2 bg-white p-6 shadow-sm rounded-2xl border border-slate-200 flex flex-col justify-center">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 uppercase text-sm tracking-wide flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Operação Atual — {activeRound ? `${activeRound.roundNumber}º Turno` : 'Turno Ativo'}
              </h3>
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                Cobertura: ~193 BUs (Provisória)
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <p className="text-3xl font-black text-slate-900">{activeTotalBUs}</p>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mt-1">Lidos (T{activeRound?.roundNumber || 2})</p>
              </div>
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                <p className="text-3xl font-black text-emerald-600">{activeProcessedBUs}</p>
                <p className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider mt-1">Processados</p>
              </div>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100">
                <p className="text-3xl font-black text-amber-600">{activePendingBUs}</p>
                <p className="text-[10px] text-amber-600 uppercase font-bold tracking-wider mt-1">Pendentes</p>
              </div>
              <div className="bg-red-50 p-3 rounded-xl border border-red-100">
                <p className="text-3xl font-black text-red-600">{activeDuplicateBUs}</p>
                <p className="text-[10px] text-red-600 uppercase font-bold tracking-wider mt-1">Duplicados</p>
              </div>
            </div>
          </div>
        </div>

        {/* Painel de Histórico Preservado */}
        <div className="bg-slate-100/70 border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <Archive className="w-5 h-5 text-slate-500 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wide">
                  Histórico Preservado — 1º Turno
                </h4>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                  FINALIZADO • PLEI 3220
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                {historicalProcessedBUs} Boletins de Urna processados (100% da cobertura) • Votos e auditoria criptográfica intactos.
              </p>
            </div>
          </div>
          <Link
            href="/apuracao?round=1"
            target="_blank"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-indigo-600 bg-white border border-slate-200 hover:border-indigo-300 px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            Ver Totais T1
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Recent History */}
        <div className="bg-white p-6 shadow-sm rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <h3 className="font-bold text-slate-700 uppercase text-sm tracking-wide flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" />
              Últimos Boletins Inseridos
            </h3>
            <span className="text-xs text-slate-400 font-medium">
              Identificados por turno de origem
            </span>
          </div>
          
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
                    <th className="py-3 px-4 font-bold">Turno de Origem</th>
                    <th className="py-3 px-4 font-bold">Localização (Mun/Zona/Seção)</th>
                    <th className="py-3 px-4 font-bold rounded-r-lg">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBUs.map(bu => {
                    const isT2 = bu.round?.roundNumber === 2;
                    return (
                      <tr key={bu.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 text-slate-600 font-medium">
                          {new Date(bu.createdAt).toLocaleTimeString('pt-BR')}
                        </td>
                        <td className="py-3 px-4">
                          {isT2 ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                              2º Turno (Ativo)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              1º Turno (Histórico)
                            </span>
                          )}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {isAdmin && (
            <Link href="/admin/usuarios" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group shadow-sm">
              <Users className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Usuários</span>
            </Link>
          )}

          {isAdmin && (
            <Link href="/admin/cobertura" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group shadow-sm">
              <MapPin className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Cobertura</span>
            </Link>
          )}

          {!isViewer && (
            <Link href="/admin/conferencia" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group shadow-sm">
              <Search className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Conferência</span>
            </Link>
          )}

          {isAdmin && (
            <Link href="/admin/recalcular" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group shadow-sm">
              <RotateCcw className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Integridade</span>
            </Link>
          )}

          <Link href="/admin/audit" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group shadow-sm">
            <ShieldCheck className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Auditoria</span>
          </Link>

          <Link href="/api/export?format=csv" target="_blank" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-slate-50 transition-colors flex flex-col items-center gap-2 group shadow-sm">
            <Download className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-600 group-hover:text-slate-900">Exportar CSV</span>
          </Link>

          {isAdmin && (
            <Link href="/admin/preparar" className="bg-white border border-slate-200 p-4 rounded-xl text-center hover:bg-red-50 transition-colors flex flex-col items-center gap-2 group shadow-sm">
              <Trash2 className="w-5 h-5 text-red-400 group-hover:text-red-600 transition-colors" />
              <span className="font-bold text-xs uppercase tracking-wider text-red-600 group-hover:text-red-700">Zerar</span>
            </Link>
          )}
        </div>

      </main>
  );
}
