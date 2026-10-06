import { prisma } from '@/lib/db';
import Link from 'next/link';
import { ArrowLeft, Clock, CheckCircle2, CircleDashed } from 'lucide-react';
import TurnoManagerClient from './TurnoManagerClient';
import TurnoResetClient from './TurnoResetClient';

export const dynamic = 'force-dynamic';

export default async function AdminTurnosPage() {
  const activeElections = await prisma.election.findMany({
    where: { status: 'ACTIVE' },
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' }
      }
    }
  });

  const election = activeElections.length === 1 ? activeElections[0] : null;

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
              <div className="bg-slate-50 border-b border-slate-200 p-5">
                <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">ELEIÇÃO ATIVA</h2>
              </div>
              <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-1">Nome</p>
                  <p className="text-xl font-black text-slate-900">{election.name || 'Eleição Principal'}</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-1">Ano</p>
                  <p className="text-xl font-black text-slate-900">{election.year}</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-1">PLEI</p>
                  <p className="text-xl font-black text-slate-900">{election.plei}</p>
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
                    <div className="flex items-center gap-4">
                      {round.status === 'ACTIVE' ? (
                        <CheckCircle2 className="w-8 h-8 text-indigo-600" />
                      ) : round.status === 'FINISHED' ? (
                        <CheckCircle2 className="w-8 h-8 text-slate-300" />
                      ) : (
                        <CircleDashed className="w-8 h-8 text-slate-300" />
                      )}
                      
                      <div>
                        <h3 className="text-xl font-black text-slate-800">{round.roundNumber}º Turno</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Status:</span>
                          <span className={`text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                            round.status === 'ACTIVE' ? 'bg-indigo-100 text-indigo-800' :
                            round.status === 'FINISHED' ? 'bg-slate-100 text-slate-600' :
                            'bg-slate-50 text-slate-400 border border-slate-200'
                          }`}>
                            {round.status}
                          </span>
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
