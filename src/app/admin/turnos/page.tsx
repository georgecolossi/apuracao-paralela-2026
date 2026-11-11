import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';
import Link from 'next/link';
import { ArrowLeft, Clock, CheckCircle2, CircleDashed } from 'lucide-react';
import TurnoManagerClient from './TurnoManagerClient';
import TurnoResetClient from './TurnoResetClient';

export const dynamic = 'force-dynamic';

export default async function AdminTurnosPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) {
    redirect('/login');
  }
  if (auth.user.role !== 'ADMIN') {
    redirect('/admin');
  }

  const activeElections = await prisma.election.findMany({
    where: { status: 'ACTIVE' },
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' },
        include: { _count: { select: { coverage: true } } }
      }
    }
  });

  const election = activeElections.length === 1 ? activeElections[0] : null;
  const activeRound = election?.rounds.find(r => r.status === 'ACTIVE') || null;
  const contextualizedName = activeRound
    ? `Eleições Gerais ${election?.year || 2026} — ${activeRound.roundNumber}º Turno`
    : election?.name || 'Eleição Principal';
  const activePlei = activeRound?.plei || election?.plei || '3221';

  const metadataCounts: Record<string, number> = {};
  const roundBUsCounts: Record<string, number> = {};
  if (election) {
    for (const r of election.rounds) {
      if (r.plei) {
        metadataCounts[r.id] = await prisma.candidateMetadata.count({
          where: { electionCode: r.plei, round: r.roundNumber }
        });
      } else {
        metadataCounts[r.id] = 0;
      }
      roundBUsCounts[r.id] = await prisma.ballotReport.count({
        where: { roundId: r.id, isSimulation: false }
      });
    }
  }

  return (
    <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-4xl mx-auto w-full flex flex-col gap-6">
        
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-5 rounded-xl shadow-sm">
          <h2 className="font-bold uppercase tracking-wider mb-2">Advertência Operacional</h2>
          <p className="text-sm font-medium">O Painel Público e a totalização utilizam <strong>exclusivamente</strong> o turno ATIVO. Os dados não são apresentados como resultado oficial do TSE.</p>
        </div>

        {activeElections.length === 0 && (
          <div className="bg-white p-6 shadow-sm rounded-xl border border-slate-200 text-center text-slate-500 font-bold">
            Nenhuma eleição ativa encontrada.
          </div>
        )}
        
        {activeElections.length > 1 && (
          <div className="bg-white p-6 shadow-sm rounded-xl border border-red-200 text-center text-red-600 font-bold">
            Configuração ambígua: múltiplas eleições ativas.
          </div>
        )}

        {election && (
          <>
            <div className="bg-white shadow-sm border border-slate-200 rounded-2xl overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 p-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">Contexto Operacional Ativo</h2>
                  <p className="text-xs text-slate-500 font-medium">Parâmetros vigentes para coleta de QRBU e apuração pública</p>
                </div>
                {activeRound && (
                  <span className="text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full bg-indigo-600 text-white shadow-sm">
                    {activeRound.roundNumber}º Turno em Andamento
                  </span>
                )}
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Eleição / Turno</p>
                  <p className="text-lg font-black text-slate-900">{contextualizedName}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">PLEI Ativo</p>
                  <p className="text-lg font-mono font-black text-indigo-700">{activePlei}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Ano</p>
                  <p className="text-lg font-black text-slate-900">{election.year}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Cobertura Denominador</p>
                  <p className="text-lg font-black text-slate-900 flex items-center gap-1.5">
                    <span>{activeRound?.roundNumber === 2 ? '~193 BUs' : '193 BUs'}</span>
                    {activeRound?.roundNumber === 2 && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                        Provisória
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white shadow-sm border border-slate-200 rounded-2xl overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 p-5">
                <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">TURNOS</h2>
              </div>
              <div className="p-0 flex flex-col">
                {election.rounds.map(round => (
                  <div key={round.id} className={`p-6 border-b border-slate-100 last:border-0 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${round.status === 'ACTIVE' ? 'bg-indigo-50/50' : ''}`}>
                    <div className="flex items-start md:items-center gap-4">
                      {round.status === 'ACTIVE' ? (
                        <CheckCircle2 className="w-8 h-8 text-indigo-600 shrink-0 mt-0.5 md:mt-0" />
                      ) : round.status === 'FINISHED' ? (
                        <CheckCircle2 className="w-8 h-8 text-slate-400 shrink-0 mt-0.5 md:mt-0" />
                      ) : (
                        <CircleDashed className="w-8 h-8 text-slate-300 shrink-0 mt-0.5 md:mt-0" />
                      )}
                      
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-black text-slate-800">{round.roundNumber}º Turno</h3>
                          <span className={`text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                            round.status === 'ACTIVE' ? 'bg-indigo-100 text-indigo-800' :
                            round.status === 'FINISHED' ? 'bg-slate-200 text-slate-700' :
                            'bg-slate-50 text-slate-400 border border-slate-200'
                          }`}>
                            {round.status === 'ACTIVE' ? 'ATIVO' : round.status === 'FINISHED' ? 'FINALIZADO' : round.status}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
                          <div>
                            <span className="font-semibold text-slate-400 uppercase tracking-wider">PLEI: </span>
                            <span className="font-mono font-bold text-slate-800">{round.plei || 'N/D'}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-400 uppercase tracking-wider">Candidatos: </span>
                            <span className="font-bold text-slate-800">{metadataCounts[round.id] || 0}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-400 uppercase tracking-wider">Boletins: </span>
                            <span className="font-bold text-slate-800">{roundBUsCounts[round.id] || 0} BUs</span>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-400 uppercase tracking-wider">Cobertura: </span>
                            <span className={`font-bold ${round.roundNumber === 2 ? 'text-amber-700' : 'text-slate-800'}`}>
                              {round.roundNumber === 2 ? '~193 BUs (Provisória)' : '193 BUs (Finalizada)'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-2 items-end">
                      {round.status === 'PLANNED' && (
                        <TurnoManagerClient 
                          roundId={round.id} 
                          roundNumber={round.roundNumber} 
                          hasActiveRound={election.rounds.some(r => r.status === 'ACTIVE')} 
                        />
                      )}
                      
                      <TurnoResetClient
                        roundId={round.id}
                        roundNumber={round.roundNumber}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
  );
}
