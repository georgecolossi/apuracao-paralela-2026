import { prisma } from '@/lib/db';
import { requireAuthenticatedUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AlertCircle, Database, MapPin, Hash, CheckCircle2, ShieldAlert } from 'lucide-react';

export default async function ConfigPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.authenticated) redirect('/login');

  const elections = await prisma.election.findMany({ include: { rounds: true } });
  const election = elections[0];
  
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
                <dd className="text-lg font-medium text-slate-900">{election.plei}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome</dt>
                <dd className="text-lg font-medium text-slate-900">{election.name}</dd>
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
                <dd className="text-lg font-medium text-slate-900">{expectedBUsCount}</dd>
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
          <h2 className="text-lg font-bold uppercase tracking-wider">Turnos</h2>
        </div>
        
        {election?.rounds.length ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {election.rounds.map(r => (
              <div key={r.id} className={`p-4 rounded-xl border ${r.status === 'ACTIVE' ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                <div className="text-3xl font-black mb-1">{r.roundNumber}º</div>
                <div className="text-xs font-bold uppercase tracking-wider">{r.status}</div>
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
