import { prisma } from '@/lib/db';

export default async function AuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      user: true,
      report: true
    }
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6 text-black">Logs de Auditoria do Sistema</h1>
      
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-200">
          <thead className="bg-gray-100 text-black">
            <tr>
              <th className="py-2 px-4 border-b text-left">Data/Hora</th>
              <th className="py-2 px-4 border-b text-left">Ação</th>
              <th className="py-2 px-4 border-b text-left">Resultado</th>
              <th className="py-2 px-4 border-b text-left">BU ID</th>
              <th className="py-2 px-4 border-b text-left">Usuário</th>
            </tr>
          </thead>
          <tbody className="text-black">
            {logs.map(log => (
              <tr key={log.id} className="border-b">
                <td className="py-2 px-4">{log.createdAt.toLocaleString()}</td>
                <td className="py-2 px-4 font-bold">{log.action}</td>
                <td className="py-2 px-4">{log.result}</td>
                <td className="py-2 px-4 font-mono text-xs">{log.reportId || '-'}</td>
                <td className="py-2 px-4">{log.user?.email || 'Sistema'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
