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
      <div className="p-8">
        <h1 className="text-xl font-bold">Aviso</h1>
        <p>Este BU está com status: {report.status}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Conferir Boletim de Urna</h1>
      
      {report.isSimulation && (
        <div className="bg-yellow-200 border-l-4 border-yellow-500 text-yellow-800 p-4 mb-4 rounded font-bold uppercase">
          MODO SIMULAÇÃO
        </div>
      )}
      
      <div className="bg-white shadow rounded p-4 mb-6">
        <h2 className="text-lg font-bold mb-2 text-black">Identificação</h2>
        <div className="grid grid-cols-2 gap-4 text-sm text-black">
          <div><span className="text-black font-bold">Estado:</span> {report.stateCode}</div>
          <div><span className="text-black font-bold">Município:</span> {report.cityCode}</div>
          <div><span className="text-black font-bold">Zona:</span> {report.zoneCode}</div>
          <div><span className="text-black font-bold">Seção:</span> {report.sectionCode}</div>
          <div><span className="text-black font-bold">Urna (ID):</span> {report.urnCode}</div>
          <div><span className="text-black font-bold">Hash:</span> {report.hash?.substring(0, 16)}...</div>
        </div>
      </div>

      <div className="bg-white shadow rounded p-4 mb-6">
        <h2 className="text-lg font-bold mb-2 text-black">Votos Extraídos</h2>
        <table className="w-full text-left text-sm text-black">
          <thead className="text-black">
            <tr className="border-b">
              <th className="py-2">Cargo</th>
              <th className="py-2">Tipo</th>
              <th className="py-2 text-right">Quantidade</th>
            </tr>
          </thead>
          <tbody>
            {report.votes.map(v => (
              <tr key={v.id} className="border-b last:border-0 text-black">
                <td className="py-2">{v.office.name}</td>
                <td className="py-2">{v.voteType}</td>
                <td className="py-2 text-right font-mono font-bold">{v.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmButton reportId={report.id} />
    </div>
  );
}
