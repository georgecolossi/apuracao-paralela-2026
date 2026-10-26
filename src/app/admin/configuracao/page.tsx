import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AlertCircle, Database, MapPin, Hash, CheckCircle2, ShieldAlert } from 'lucide-react';

export default async function ConfigPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) redirect('/login');

  const elections = await prisma.election.findMany({
    include: {
      rounds: {
        orderBy: { roundNumber: 'asc' }
      }
    }
  });
  const election = elections[0];
  const activeRound = election?.rounds.find(r => r.status === 'ACTIVE') || election?.rounds[0];
  const activePlei = activeRound?.plei || election?.plei || 'N/D';
  const contextualizedName = activeRound
    ? `${election?.name || 'Eleição'} — ${activeRound.roundNumber}º Turno`
    : election?.name || 'Eleição Principal';
  
  const coverage = await prisma.municipality.findFirst({ where: { isCoverage: true }, include: { state: true } });
  
  const expectedAgg = await prisma.pollingSection.aggregate({
    where: { zone: { municipality: { isCoverage: true } } },
    _sum: { expectedBUs: true }
  });
  
  const expectedBUsCount = expectedAgg._sum.expectedBUs || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Configuração Operacional</h1>
        <p className="text-slate-500 mt-2">Visão geral do ambiente e parâmetros de apuração</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-4 text-indigo-600">
            <Database className="w-6 h-6" />
            <h2 className="text-lg font-bold uppercase tracking-wider">Dados da Eleição</h2>
          </div>
          
          {election ? (
            <dl className="space-y-4">
              <div>
                <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider">Identificador (PLEI)</dt>
                <dd className="text-lg font-medium text-slate-900 flex items-center gap-2 mt-0.5">
                  <span className="font-mono font-bold text-indigo-700">{activePlei}</span>
                  <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                    Turno Ativo ({activeRound?.roundNumber || 2}º)
                  </span>
                </dd>
                <p className="text-xs text-slate-400 mt-1">PLEI do turno operacional ativo</p>
              </div>
              <div>
                <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome</dt>
                <dd className="text-lg font-bold text-slate-900 mt-0.5">{contextualizedName}</dd>
                <p className="text-xs text-slate-400 mt-0.5">Nome contextualizado pelo turno operacional ativo</p>
              </div>
              <div>
                <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ano</dt>
                <dd className="text-lg font-medium text-slate-900">{election.year}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-slate-500 text-sm">Nenhuma eleição configurada.</p>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-4 text-emerald-600">
            <MapPin className="w-6 h-6" />
            <h2 className="text-lg font-bold uppercase tracking-wider">Localidade de Cobertura</h2>
          </div>
          
          {coverage ? (
            <dl className="space-y-4">
              <div>
                <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider">Município / UF</dt>
                <dd className="text-lg font-medium text-slate-900">{coverage.name} / {coverage.state?.abbreviation}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider">Código TSE (MUNI)</dt>
                <dd className="text-lg font-medium text-slate-900">{coverage.officialCode}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider">Urnas Esperadas (Denominador)</dt>
                <dd className="text-lg font-medium text-slate-900 flex items-baseline gap-2">
                  <span>{activeRound?.roundNumber === 2 ? `~${expectedBUsCount} BUs` : expectedBUsCount}</span>
                  {activeRound?.roundNumber === 2 && (
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                      Provisória
                    </span>
                  )}
                </dd>
                {activeRound?.roundNumber === 2 && (
                  <p className="text-xs text-amber-700 font-medium mt-1">
                    Estimativa provisória baseada nas seções cadastradas, sujeita à confirmação final de agregação pelo TSE.
                  </p>
                )}
              </div>
            </dl>
          ) : (
            <p className="text-slate-500 text-sm">Nenhuma localidade configurada.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4 text-blue-600">
          <Hash className="w-6 h-6" />
          <h2 className="text-lg font-bold uppercase tracking-wider">Turnos Eleitorais</h2>
        </div>
        
        {election?.rounds.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {election.rounds.map(r => (
              <div
                key={r.id}
                className={`p-4 rounded-xl border transition-colors ${
                  r.status === 'ACTIVE'
                    ? 'border-indigo-300 bg-indigo-50/70 text-indigo-950 shadow-sm'
                    : r.status === 'FINISHED'
                    ? 'border-slate-200 bg-slate-50 text-slate-700'
                    : 'border-slate-200 bg-slate-50/50 text-slate-500'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xl font-black">{r.roundNumber}º Turno</div>
                  <span
                    className={`text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded ${
                      r.status === 'ACTIVE'
                        ? 'bg-indigo-600 text-white'
                        : r.status === 'FINISHED'
                        ? 'bg-slate-200 text-slate-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {r.status === 'ACTIVE' ? 'ATIVO' : r.status === 'FINISHED' ? 'FINALIZADO' : r.status}
                  </span>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">PLEI Oficial:</span>
                    <span className="font-mono font-bold text-slate-800">{r.plei || 'N/D'}</span>
                  </div>
                  {r.roundNumber === 1 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Boletins Auditados:</span>
                      <span className="font-bold text-slate-700">{expectedBUsCount ? `${expectedBUsCount} BUs (Preservados)` : 'Preservados'}</span>
                    </div>
                  )}
                  {r.roundNumber === 2 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Cobertura Estimada:</span>
                      <span className="font-bold text-amber-700">{expectedBUsCount ? `~${expectedBUsCount} BUs` : 'N/D'} (Provisória)</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">Nenhum turno configurado.</p>
        )}
      </div>

      <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200">
        <div className="flex items-start gap-3 text-amber-800">
          <ShieldAlert className="w-6 h-6 shrink-0" />
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider mb-1">Edição Desativada</h2>
            <p className="text-sm">
              Os parâmetros estruturais acima (Eleição e Localidade) determinam os hashes e a unicidade criptográfica dos Boletins de Urna processados. A alteração destes dados durante a apuração é estritamente proibida por questões de auditoria. Para alterar, é necessário realizar um <strong className="font-black">Reset Operacional</strong> global.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
