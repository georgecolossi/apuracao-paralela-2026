'use client';

import { useEffect, useState } from 'react';

export default function ApuracaoPage() {
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchTotals = async () => {
    try {
      const res = await fetch('/api/totals');
      const data = await res.json();
      setTotals(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTotals();

    const evtSource = new EventSource('/api/realtime');
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'BU_PROCESSED') {
        fetchTotals();
      }
    };

    return () => evtSource.close();
  }, []);

  if (loading) return <div className="p-8 text-center">Carregando apuração...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-900 text-white p-6 shadow-md">
        <h1 className="text-3xl font-bold text-center">Apuração Paralela 2026</h1>
        <p className="text-center mt-2 font-light text-blue-200">
          Esta apuração é independente e utiliza exclusivamente os Boletins de Urna processados pela plataforma.
          Os resultados podem permanecer incompletos durante a coleta e não substituem a totalização oficial da Justiça Eleitoral.
        </p>
        <div className="text-center mt-4">
          <a href="/metodologia" className="text-blue-300 font-bold hover:underline">Ver Metodologia</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-8 mt-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border mb-6">
          <h2 className="text-xl font-bold mb-2 text-black">Visão Geral</h2>
          <div className="flex justify-between items-center text-lg">
            <div>
              <span className="text-black font-semibold">BUs Processados:</span>{' '}
              <span className="font-bold text-blue-900">
                {totals?.processedReports || 0} de {totals?.expectedReports || 0} 
                {totals?.expectedReports ? ` (${((totals.processedReports / totals.expectedReports) * 100).toFixed(2)}%)` : ''}
              </span>
            </div>
            <div>
              <span className="text-black font-semibold">Última atualização:</span>{' '}
              <span className="font-medium text-black">{new Date().toLocaleTimeString()}</span>
            </div>
          </div>
        </div>

        {/* Simplificação: Agrupando votos por tipo apenas para demonstração da engine rodando */}
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h2 className="text-xl font-bold mb-4 text-black">Total de Votos (Geral)</h2>
          
          {totals?.totals?.length === 0 ? (
            <p className="text-black font-semibold">Nenhum voto contabilizado ainda.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b bg-gray-50 text-black">
                  <th className="p-3">Cargo</th>
                  <th className="p-3">Tipo de Voto</th>
                  <th className="p-3 text-right">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {totals?.totals?.map((t: any, idx: number) => (
                  <tr key={idx} className="border-b last:border-0 hover:bg-gray-50 transition-colors text-black">
                    <td className="p-3">{t.officeId /* Precisaríamos dar JOIN no officeName */}</td>
                    <td className="p-3">{t.voteType}</td>
                    <td className="p-3 text-right font-mono font-bold">{t._sum.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
