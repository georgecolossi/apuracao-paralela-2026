import { prisma } from '@/lib/db';
import ConfirmButton from './ConfirmButton';
import { CheckCircle2, XCircle, HelpCircle, FileCheck2, Info, MapPin, Hash, ShieldAlert } from 'lucide-react';

export default async function ConferirPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = await prisma.ballotReport.findUnique({
    where: { id },
    include: {
      election: true,
      round: true,
      votes: {
        include: { office: true }
      }
    }
  });

  if (!report) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md w-full">
          <HelpCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-800 mb-2">Boletim não encontrado</h1>
          <p className="text-slate-500 mb-6">O código identificador informado não consta na base de dados.</p>
          <a href="/admin/scanner" className="inline-block bg-slate-900 text-white font-bold px-6 py-3 rounded-xl hover:bg-slate-800 transition-colors">
            Voltar ao Scanner
          </a>
        </div>
      </div>
    );
  }

  // Preserve Phase 6 logic: Only PENDENTE_CONFIRMACAO
  if (report.status !== 'PENDENTE_CONFIRMACAO') {
    return (
      <div className="min-h-screen bg-slate-50 font-sans flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md w-full">
          <Info className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-800 mb-2">Boletim indisponível</h1>
          <p className="text-slate-600 mb-6">
            Este Boletim de Urna não está aguardando confirmação. O status atual é{' '}
            <strong className="text-slate-900 uppercase bg-slate-100 px-2 py-1 rounded text-xs ml-1 tracking-wider">{report.status}</strong>.
          </p>
          <a href="/admin/scanner" className="inline-block bg-slate-900 text-white font-bold px-6 py-3 rounded-xl hover:bg-slate-800 transition-colors">
            Voltar ao Scanner
          </a>
        </div>
      </div>
    );
  }

  let validation = { hashStatus: 'UNVERIFIED', sigStatus: 'UNVERIFIED' };
  try {
    if (report.validationData) {
      validation = JSON.parse(report.validationData as string);
    }
  } catch {}

  
  const { CandidateResolver } = await import('@/lib/metadata/CandidateResolver');
  const { enrichVoteWithMetadata } = await import('@/lib/metadata/voteEnricher');
  const resolver = new CandidateResolver();
  await resolver.load(report.election.year, report.round.roundNumber);

  const enrichedVotes = report.votes.map(v => {
    const meta = enrichVoteWithMetadata(
      { voteType: v.voteType, candidateNumber: v.candidateNumber, partyNumber: v.partyNumber, officeName: v.office.name },
      report.election.year,
      report.round.roundNumber,
      report.stateCode,
      resolver
    );
    return { ...v, meta };
  });

  const votesByOffice = enrichedVotes.reduce((acc, vote) => {
    if (!acc[vote.office.name]) acc[vote.office.name] = [];
    acc[vote.office.name].push(vote);
    return acc;
  }, {} as Record<string, typeof enrichedVotes>);


  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col">


      <main className="flex-1 max-w-4xl w-full mx-auto p-4 md:p-6 py-8 flex flex-col gap-6">
        {report.isSimulation && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-5 rounded-xl shadow-sm flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold uppercase tracking-wider text-sm">Modo Simulação / Dados de Teste</p>
              <p className="text-sm mt-1 text-amber-700">Este boletim contém dados simulados e não será totalizado como resultado real na apuração pública.</p>
            </div>
          </div>
        )}
        
        {/* Identificação e Hash */}
        <div className="bg-white shadow-sm border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
              <Hash className="w-5 h-5 text-slate-400" />
              Identidade do BU
            </h2>
            
            {validation.hashStatus === 'VERIFIED' ? (
              <span className="inline-flex items-center bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1.5 rounded-full border border-emerald-200 uppercase tracking-wide">
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> HASH VERIFICADO
              </span>
            ) : validation.hashStatus === 'INVALID' ? (
              <span className="inline-flex items-center bg-red-100 text-red-800 text-xs font-bold px-3 py-1.5 rounded-full border border-red-200 uppercase tracking-wide">
                <XCircle className="w-4 h-4 mr-1.5" /> HASH INVÁLIDO
              </span>
            ) : (
              <span className="inline-flex items-center bg-slate-100 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-full border border-slate-300 uppercase tracking-wide">
                <HelpCircle className="w-4 h-4 mr-1.5" /> HASH NÃO VERIFICADO
              </span>
            )}
          </div>
          
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Estado</span>
              <span className="text-2xl font-black text-slate-900">{report.stateCode}</span>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Município</span>
              <span className="text-2xl font-black text-slate-900">{report.cityCode}</span>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Zona</span>
              <span className="text-2xl font-black text-slate-900">{report.zoneCode}</span>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Seção</span>
              <span className="text-2xl font-black text-slate-900">{report.sectionCode}</span>
            </div>
          </div>
        </div>

        {/* Votos */}
        <div className="bg-white shadow-sm border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 p-5">
            <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
              <MapPin className="w-5 h-5 text-slate-400" />
              Resumo de Votos
            </h2>
          </div>
          
          {Object.entries(votesByOffice).map(([officeName, votes]) => {
            const sortedVotes = [...votes].sort((a, b) => {
              if (a.voteType === 'BRANCO' || a.voteType === 'NULO') return 1;
              if (b.voteType === 'BRANCO' || b.voteType === 'NULO') return -1;
              return (b.quantity - a.quantity);
            });

            return (
              <div key={officeName} className="border-b border-slate-200 last:border-b-0">
                <div className="px-5 py-4 bg-slate-50/50">
                  <h3 className="font-bold text-indigo-900 uppercase tracking-wide text-sm">{officeName}</h3>
                </div>
                <div className="px-5 pb-5 pt-2">
                  <div className="flex flex-col gap-2">
                    {sortedVotes.map(v => (
                      <div key={v.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                        <div className="flex items-center gap-3">
                          <span className={`inline-flex w-20 justify-center px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider ${
                            v.voteType === 'BRANCO' ? 'bg-slate-200 text-slate-700' : 
                            v.voteType === 'NULO' ? 'bg-red-100 text-red-700' : 
                            v.voteType === 'LEGENDA' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {v.voteType}
                          </span>
                          <div className="flex flex-col">
                            {v.voteType === 'NOMINAL' ? (
                              v.meta.status === 'FOUND' ? (
                                <>
                                  <span className="font-bold text-slate-800 text-sm md:text-base">{v.meta.candidateName}</span>
                                  <span className="text-xs text-slate-500 font-medium">{v.candidateNumber} · {v.meta.partyAbbreviation}</span>
                                </>
                              ) : v.meta.status === 'AMBIGUOUS' ? (
                                <>
                                  <span className="font-bold text-slate-800 text-sm md:text-base">Candidato {v.candidateNumber}</span>
                                  <span className="text-xs text-amber-600 font-medium">Metadados ambíguos</span>
                                </>
                              ) : (
                                <>
                                  <span className="font-bold text-slate-800 text-sm md:text-base">Candidato {v.candidateNumber}</span>
                                  <span className="text-xs text-slate-500 font-medium">Metadados não encontrados</span>
                                </>
                              )
                            ) : v.voteType === 'LEGENDA' ? (
                              v.meta.status === 'FOUND' ? (
                                <>
                                  <span className="font-bold text-slate-800 text-sm md:text-base">Partido {v.partyNumber}</span>
                                  <span className="text-xs text-slate-500 font-medium">{v.meta.partyAbbreviation}</span>
                                </>
                              ) : (
                                <span className="font-bold text-slate-800 text-sm md:text-base">Partido {v.partyNumber}</span>
                              )
                            ) : (
                              <span className="font-bold text-slate-800 text-sm md:text-base">—</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex items-end gap-2">
                          <span className="font-black text-lg md:text-xl text-slate-900 leading-none">
                            {v.quantity}
                          </span>
                          <span className="text-xs font-bold text-slate-400 uppercase mb-0.5">votos</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          
          {Object.keys(votesByOffice).length === 0 && (
             <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
               <Info className="w-8 h-8 text-slate-300 mb-3" />
               <p className="font-medium">Nenhum voto contabilizado neste Boletim.</p>
             </div>
          )}
        </div>

        {/* Componente Cliente (Confirm/Cancel) */}
        <div className="mt-2">
          <ConfirmButton reportId={report.id} />
        </div>
      </main>
    </div>
  );
}
