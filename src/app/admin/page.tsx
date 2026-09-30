import Link from 'next/link';
import { prisma } from '@/lib/db';

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
    <div className="min-h-screen bg-gray-100 font-sans">
      <header className="bg-blue-900 text-white shadow-md p-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight">Apuração Paralela 2026</h1>
            <p className="text-blue-200 text-sm font-medium">Painel do Operador</p>
          </div>
          <div>
            <a href="/apuracao" target="_blank" rel="noreferrer" className="text-sm bg-blue-800 hover:bg-blue-700 px-3 py-1 rounded text-white border border-blue-700">
              Ver Painel Público
            </a>
          </div>
        </div>
      </header>

      <main className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Link href="/admin/scanner" className="md:col-span-3 bg-blue-600 text-white p-6 rounded-lg text-center hover:bg-blue-700 font-bold block shadow-md transition transform hover:-translate-y-1">
            <h2 className="text-2xl uppercase tracking-widest mb-1">LER BOLETIM DE URNA</h2>
            <p className="text-blue-200 font-normal">Acessar o scanner e coletar QR Codes</p>
          </Link>
          
          <div className="bg-white p-6 shadow-sm rounded-lg border">
            <h3 className="font-semibold text-gray-500 uppercase text-xs tracking-wider mb-4">Status do Sistema</h3>
            <div className="flex items-center mb-2">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span className="text-sm font-bold text-gray-800">Motor de Apuração Ativo</span>
            </div>
            <div className="flex items-center mb-2">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span className="text-sm font-bold text-gray-800">Banco de Dados Conectado</span>
            </div>
            <div className="flex items-center mt-4">
              <span className="text-sm text-gray-600">Operadores Ativos:</span>
              <span className="font-bold text-gray-900 ml-2">{activeOperators}</span>
            </div>
          </div>

          <div className="md:col-span-2 bg-white p-6 shadow-sm rounded-lg border">
            <h3 className="font-semibold text-gray-500 uppercase text-xs tracking-wider mb-4">Estatísticas de Boletins (Reais)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-3xl font-bold text-gray-900">{totalBUs}</p>
                <p className="text-xs text-gray-500 uppercase font-semibold mt-1">Lidos</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-green-600">{processedBUs}</p>
                <p className="text-xs text-gray-500 uppercase font-semibold mt-1">Processados</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-yellow-600">{pendingBUs}</p>
                <p className="text-xs text-gray-500 uppercase font-semibold mt-1">Pendentes</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-red-600">{duplicateBUs}</p>
                <p className="text-xs text-gray-500 uppercase font-semibold mt-1">Duplicados</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 shadow-sm rounded-lg border mb-8">
          <h3 className="font-semibold text-gray-500 uppercase text-xs tracking-wider mb-4 border-b pb-2">Últimos Boletins Lidos</h3>
          
          {recentBUs.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Nenhum boletim lido ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-500 bg-gray-50">
                    <th className="p-2">Horário</th>
                    <th className="p-2">Localização (Mun/Zona/Seção)</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBUs.map(bu => (
                    <tr key={bu.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-2 text-gray-800">{new Date(bu.createdAt).toLocaleTimeString('pt-BR')}</td>
                      <td className="p-2 font-medium text-gray-900">
                        {bu.cityCode} / {bu.zoneCode} / {bu.sectionCode}
                      </td>
                      <td className="p-2">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                          bu.status === 'PROCESSADO' ? 'bg-green-100 text-green-800' :
                          bu.status === 'DUPLICADO' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {bu.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link href="/admin/conferencia" className="bg-gray-100 text-gray-800 border p-3 rounded text-center hover:bg-gray-200 font-bold text-sm block">
            Conferência Global
          </Link>
          <Link href="/admin/recalcular" className="bg-gray-100 text-gray-800 border p-3 rounded text-center hover:bg-gray-200 font-bold text-sm block">
            Recalcular Apuração
          </Link>
          <Link href="/admin/audit" className="bg-gray-100 text-gray-800 border p-3 rounded text-center hover:bg-gray-200 font-bold text-sm block">
            Logs de Auditoria
          </Link>
          <Link href="/api/export?format=csv" target="_blank" className="bg-gray-100 text-gray-800 border p-3 rounded text-center hover:bg-gray-200 font-bold text-sm block">
            Exportar CSV
          </Link>
        </div>
      </main>
    </div>
  );
}
