import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import ConfirmButton from './ConfirmButton';

export default async function ConferirBUPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.ballotReport.findUnique({
    where: { id },
    include: {
      votes: {
        include: {
          office: true
        }
      }
    }
  });

  if (!report) return notFound();

  if (report.status !== 'PENDENTE_CONFIRMACAO') {
    return (
      <div className="min-h-screen bg-gray-50 p-4 md:p-8 flex items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-lg shadow max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Boletim Indisponível</h1>
          <p className="text-gray-600 mb-6">Este Boletim de Urna não está aguardando confirmação. O status atual é <strong className="text-gray-800">{report.status}</strong>.</p>
          <a href="/admin/scanner" className="inline-block bg-blue-900 text-white font-bold px-6 py-3 rounded hover:bg-blue-800">
            Voltar ao Scanner
          </a>
        </div>
      </div>
    );
  }

  // Parse validation data
  let validation = { hashStatus: 'UNVERIFIED', sigStatus: 'UNVERIFIED' };
  try {
    if (report.validationData) {
      validation = JSON.parse(report.validationData as string);
    }
  } catch (e) {}

  // Group votes by office
  const votesByOffice = report.votes.reduce((acc, vote) => {
    if (!acc[vote.office.name]) acc[vote.office.name] = [];
    acc[vote.office.name].push(vote);
    return acc;
  }, {} as Record<string, typeof report.votes>);

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      <header className="bg-blue-900 text-white p-4 shadow-md flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold uppercase tracking-tight">Apuração Paralela 2026</h1>
          <p className="text-blue-200 text-sm font-medium">Conferência de Boletim</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 py-8">
        {report.isSimulation && (
          <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 mb-6 rounded shadow-sm flex items-center">
            <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div>
              <p className="font-bold uppercase tracking-wider">Modo Simulação / Dados de Teste</p>
              <p className="text-sm">Este boletim contém dados simulados e não será totalizado como resultado real.</p>
            </div>
          </div>
        )}
        
        <div className="bg-white shadow-sm border rounded-lg overflow-hidden mb-6">
          <div className="bg-gray-50 border-b p-4 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wide">Identificação do BU</h2>
            
            {validation.hashStatus === 'VERIFIED' ? (
              <span className="inline-flex items-center bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full border border-green-200">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                HASH VERIFICADO
              </span>
            ) : (
              <span className="inline-flex items-center bg-red-100 text-red-800 text-xs font-bold px-2.5 py-1 rounded-full border border-red-200">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                HASH INVÁLIDO
              </span>
            )}
          </div>
          
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 p-3 rounded border">
              <span className="block text-xs text-gray-500 font-bold uppercase mb-1">Estado</span>
              <span className="block text-lg font-bold text-gray-900">{report.stateCode}</span>
            </div>
            <div className="bg-gray-50 p-3 rounded border">
              <span className="block text-xs text-gray-500 font-bold uppercase mb-1">Município</span>
              <span className="block text-lg font-bold text-gray-900">{report.cityCode}</span>
            </div>
            <div className="bg-gray-50 p-3 rounded border">
              <span className="block text-xs text-gray-500 font-bold uppercase mb-1">Zona</span>
              <span className="block text-lg font-bold text-gray-900">{report.zoneCode}</span>
            </div>
            <div className="bg-gray-50 p-3 rounded border">
              <span className="block text-xs text-gray-500 font-bold uppercase mb-1">Seção</span>
              <span className="block text-lg font-bold text-gray-900">{report.sectionCode}</span>
            </div>
          </div>
        </div>

        <div className="bg-white shadow-sm border rounded-lg overflow-hidden mb-6">
          <div className="bg-gray-50 border-b p-4">
            <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wide">Votos Lidos</h2>
          </div>
          
          {Object.entries(votesByOffice).map(([officeName, votes]) => {
            // Sort votes: NOMINAL/LEGENDA first, then BRANCO, NULO
            const sortedVotes = [...votes].sort((a, b) => {
              if (a.voteType === 'BRANCO' || a.voteType === 'NULO') return 1;
              if (b.voteType === 'BRANCO' || b.voteType === 'NULO') return -1;
              return (b.quantity - a.quantity);
            });

            return (
              <div key={officeName} className="p-4 border-b last:border-b-0">
                <h3 className="font-bold text-blue-900 mb-3 uppercase">{officeName}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 rounded-l-lg">Candidato/Partido</th>
                        <th className="px-4 py-2">Tipo</th>
                        <th className="px-4 py-2 text-right rounded-r-lg">Votos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedVotes.map(v => (
                        <tr key={v.id} className="border-b last:border-b-0">
                          <td className="px-4 py-2 font-medium text-gray-900">
                            {v.voteType === 'NOMINAL' ? v.candidateNumber : 
                             v.voteType === 'LEGENDA' ? `Partido ${v.partyNumber}` : '-'}
                          </td>
                          <td className="px-4 py-2 text-gray-600">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                              v.voteType === 'BRANCO' ? 'bg-gray-200 text-gray-700' : 
                              v.voteType === 'NULO' ? 'bg-red-100 text-red-700' : 
                              v.voteType === 'LEGENDA' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-800'
                            }`}>
                              {v.voteType}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-bold text-lg text-gray-800">
                            {v.quantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          
          {Object.keys(votesByOffice).length === 0 && (
             <div className="p-8 text-center text-gray-500">
               Nenhum voto contabilizado neste Boletim.
             </div>
          )}
        </div>

        <ConfirmButton reportId={report.id} />
      </main>
    </div>
  );
}
