import Link from 'next/link';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const totalBUs = await prisma.ballotReport.count({ where: { isSimulation: false } });
  const processedBUs = await prisma.ballotReport.count({ where: { status: 'PROCESSADO', isSimulation: false } });
  const pendingBUs = await prisma.ballotReport.count({ where: { status: 'PENDENTE_CONFIRMACAO', isSimulation: false } });
  const duplicateBUs = await prisma.ballotReport.count({ where: { status: 'DUPLICADO', isSimulation: false } });

  const activeOperators = await prisma.user.count({ where: { isActive: true } });

  return (
    <div className="p-8 max-w-4xl mx-auto text-black">
      <h1 className="text-3xl font-bold mb-6">Painel Administrativo</h1>
      
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white p-4 shadow rounded border">
          <h3 className="font-semibold text-gray-700">Status Operacional</h3>
          <p className="mt-2 text-sm">Parser 2026: <span className="font-bold text-red-600">SCHEMA_2026_UNAVAILABLE</span></p>
          <p className="text-sm">Banco de Dados: <span className="font-bold text-green-600">ONLINE</span></p>
          <p className="text-sm">Realtime (SSE): <span className="font-bold text-yellow-600">LOCAL (Aguardando Pub/Sub)</span></p>
          <p className="text-sm mt-2">Operadores Ativos: <strong>{activeOperators}</strong></p>
        </div>

        <div className="bg-white p-4 shadow rounded border">
          <h3 className="font-semibold text-gray-700">Estatísticas de BUs (Reais)</h3>
          <ul className="mt-2 space-y-1 text-sm">
            <li>Recebidos: <strong>{totalBUs}</strong></li>
            <li>Processados: <strong>{processedBUs}</strong></li>
            <li>Pendentes: <strong>{pendingBUs}</strong></li>
            <li>Duplicados/Erros: <strong>{duplicateBUs}</strong></li>
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link href="/admin/scanner" className="bg-blue-600 text-white p-4 rounded text-center hover:bg-blue-700 font-bold block">
          Abrir Scanner de BU
        </Link>
        <Link href="/admin/conferencia" className="bg-indigo-600 text-white p-4 rounded text-center hover:bg-indigo-700 font-bold block">
          Conferência Global
        </Link>
        <Link href="/admin/recalcular" className="bg-purple-600 text-white p-4 rounded text-center hover:bg-purple-700 font-bold block">
          Recalcular Totalização
        </Link>
        <Link href="/admin/audit" className="bg-gray-800 text-white p-4 rounded text-center hover:bg-gray-900 font-bold block">
          Logs de Auditoria
        </Link>
        <Link href="/api/export?format=csv" target="_blank" className="bg-green-600 text-white p-4 rounded text-center hover:bg-green-700 font-bold block">
          Exportar Base (CSV)
        </Link>
      </div>
    </div>
  );
}
