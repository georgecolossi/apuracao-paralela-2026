import { prisma } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ConferenciaGlobal() {
  const reports = await prisma.ballotReport.findMany({
    orderBy: { createdAt: 'desc' },
    include: { operator: true }
  });

  return (
    <div className="p-8 max-w-6xl mx-auto text-black">
      <h1 className="text-2xl font-bold mb-4">Conferência Global de BUs</h1>
      
      <div className="bg-white p-6 rounded shadow border">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="p-2">Data/Hora</th>
              <th className="p-2">Município</th>
              <th className="p-2">Zona/Sec/Urna</th>
              <th className="p-2">Operador</th>
              <th className="p-2">Modo</th>
              <th className="p-2">Status</th>
              <th className="p-2">Ação</th>
            </tr>
          </thead>
          <tbody>
            {reports.map(rep => (
              <tr key={rep.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{rep.createdAt.toLocaleString('pt-BR')}</td>
                <td className="p-2">{rep.cityCode} ({rep.stateCode})</td>
                <td className="p-2">{rep.zoneCode} / {rep.sectionCode} / {rep.urnCode}</td>
                <td className="p-2">{rep.operator?.name || 'Sistema'}</td>
                <td className="p-2">{rep.isSimulation ? 'SIMULAÇÃO' : 'REAL'}</td>
                <td className="p-2 font-bold">{rep.status}</td>
                <td className="p-2">
                  <Link href={`/admin/conferir/${rep.id}`} className="text-blue-600 hover:underline">
                    Inspecionar
                  </Link>
                </td>
              </tr>
            ))}
            {reports.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-500">Nenhum BU no sistema.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
