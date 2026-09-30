'use client';

import { useEffect, useState } from 'react';

interface TotalItem {
  officeName: string;
  candidateNumber?: string | null;
  partyNumber?: string | null;
  voteType: string;
  quantity: number;
}

interface TotalsData {
  processedReports: number;
  expectedReports: number;
  totals: TotalItem[];
}

export default function ApuracaoPage() {
  const [totals, setTotals] = useState<TotalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activeOffice, setActiveOffice] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    
    const fetchTotals = async () => {
      try {
        const res = await fetch('/api/totals');
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        if (mounted) {
          setTotals(data);
          setLastUpdate(new Date());
          setError(false);
          
          // Set initial active office if none selected
          setActiveOffice(prev => {
            if (!prev && data.totals?.length > 0) {
              const offices = Array.from(new Set(data.totals.map((t: TotalItem) => t.officeName))) as string[];
              if (offices.length > 0) {
                return offices[0];
              }
            }
            return prev;
          });
        }
      } catch (e) {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void fetchTotals();

    const evtSource = new EventSource('/api/realtime');
    evtSource.onopen = () => {
      if (mounted) setConnected(true);
      void fetchTotals();
    };
    evtSource.onerror = () => {
      if (mounted) setConnected(false);
    };
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'BU_PROCESSED') {
          void fetchTotals();
        }
      } catch (e) {
        // ignore parse error
      }
    };

    return () => {
      mounted = false;
      evtSource.close();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-blue-900 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-xl font-semibold text-gray-700">Carregando apuração...</p>
      </div>
    );
  }

  const offices = totals ? Array.from(new Set(totals.totals.map((t: TotalItem) => t.officeName))) : [];

  const getOfficeData = (office: string) => {
    if (!totals) return { candidates: [], brancos: 0, nulos: 0, totalValidos: 0, totalGeral: 0 };
    
    const officeVotes = totals.totals.filter(t => t.officeName === office);
    
    let brancos = 0;
    let nulos = 0;
    let validos = 0;
    
    const candidateMap = new Map<string, { candidateNumber: string, partyNumber: string, quantity: number }>();
    
    for (const v of officeVotes) {
      if (v.voteType === 'BRANCO') {
        brancos += v.quantity;
      } else if (v.voteType === 'NULO') {
        nulos += v.quantity;
      } else if (v.voteType === 'NOMINAL' || v.voteType === 'LEGENDA') {
        validos += v.quantity;
        const key = v.voteType === 'LEGENDA' ? `LEG-${v.partyNumber}` : `NOM-${v.candidateNumber}`;
        const existing = candidateMap.get(key);
        if (existing) {
          existing.quantity += v.quantity;
        } else {
          candidateMap.set(key, {
            candidateNumber: v.voteType === 'LEGENDA' ? `Legenda ${v.partyNumber}` : (v.candidateNumber || '-'),
            partyNumber: v.partyNumber || '-',
            quantity: v.quantity
          });
        }
      }
    }
    
    const totalGeral = validos + brancos + nulos;
    const candidates = Array.from(candidateMap.values()).sort((a, b) => b.quantity - a.quantity);
    
    return { candidates, brancos, nulos, totalValidos: validos, totalGeral };
  };

  const activeData = activeOffice ? getOfficeData(activeOffice) : null;

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <header className="bg-blue-900 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-6 md:py-8 flex flex-col md:flex-row items-center justify-between">
          <div className="text-center md:text-left mb-4 md:mb-0">
            <h1 className="text-2xl md:text-4xl font-extrabold uppercase tracking-tight">Apuração Paralela 2026</h1>
            <p className="text-blue-200 mt-1 font-medium text-sm md:text-base">Acompanhamento independente dos Boletins de Urna</p>
          </div>
          <div className="bg-red-600 text-white px-4 py-2 rounded font-bold uppercase text-sm shadow-sm border border-red-500">
            Resultado Não Oficial
          </div>
        </div>
        <div className="bg-blue-950 px-4 py-3 text-sm text-center text-blue-200">
          Esta é uma apuração paralela independente baseada nos Boletins de Urna coletados pela equipe responsável. Os resultados oficiais são divulgados pela Justiça Eleitoral.
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6 text-center">
            <strong>Não foi possível atualizar os resultados.</strong> O sistema tentará reconectar automaticamente.
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border p-4 md:p-6 mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-center md:text-left">
            <p className="text-sm text-gray-500 uppercase font-semibold">BUs Processados</p>
            <p className="text-3xl font-bold text-gray-900">{totals?.processedReports || 0}</p>
          </div>
          
          <div className="text-center">
            <p className="text-sm text-gray-500 uppercase font-semibold">Última Atualização</p>
            <p className="text-xl font-medium text-gray-900">{lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR') : '--:--:--'}</p>
          </div>
          
          <div className="text-center md:text-right flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className={`font-bold ${connected ? 'text-red-600' : 'text-gray-500'}`}>
              {connected ? 'AO VIVO' : 'Reconectando...'}
            </span>
          </div>
        </div>

        {offices.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-lg shadow-sm border">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h2 className="text-2xl font-bold text-gray-700 mb-2">A apuração ainda não possui Boletins de Urna processados.</h2>
            <p className="text-gray-500">Aguarde o processamento das primeiras seções.</p>
          </div>
        ) : (
          <div>
            <div className="flex overflow-x-auto gap-2 mb-6 pb-2 border-b scrollbar-hide">
              {offices.map(office => (
                <button
                  key={office}
                  onClick={() => setActiveOffice(office)}
                  className={`px-6 py-3 font-bold uppercase rounded-t-lg whitespace-nowrap transition-colors ${
                    activeOffice === office 
                      ? 'bg-blue-900 text-white border-b-4 border-blue-500' 
                      : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-blue-900 border-b-4 border-transparent'
                  }`}
                >
                  {office}
                </button>
              ))}
            </div>

            {activeData && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                  {activeData.candidates.length === 0 ? (
                    <div className="bg-white p-8 text-center rounded-lg shadow-sm border text-gray-500">
                      Nenhum voto válido contabilizado para este cargo.
                    </div>
                  ) : (
                    activeData.candidates.map((cand, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-lg shadow-sm border flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-gray-900">
                            {cand.candidateNumber}
                          </h3>
                          <p className="text-gray-500 font-medium">Partido: {cand.partyNumber}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-extrabold text-blue-900">
                            {cand.quantity.toLocaleString('pt-BR')} <span className="text-sm font-normal text-gray-600">votos</span>
                          </p>
                          <p className="text-lg font-bold text-gray-700">
                            {activeData.totalValidos > 0 ? ((cand.quantity / activeData.totalValidos) * 100).toFixed(2) : '0.00'}%
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-lg shadow-sm border">
                    <h3 className="font-bold text-gray-700 mb-4 uppercase text-sm border-b pb-2">Resumo de Votos</h3>
                    
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-gray-600">Válidos</span>
                      <span className="font-bold text-gray-900">{activeData.totalValidos.toLocaleString('pt-BR')}</span>
                    </div>
                    
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-gray-600">Brancos</span>
                      <span className="font-bold text-gray-900">{activeData.brancos.toLocaleString('pt-BR')}</span>
                    </div>
                    
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-gray-600">Nulos</span>
                      <span className="font-bold text-gray-900">{activeData.nulos.toLocaleString('pt-BR')}</span>
                    </div>

                    <div className="flex justify-between items-center mt-4 pt-3 border-t">
                      <span className="font-bold text-gray-900">Total</span>
                      <span className="font-bold text-blue-900 text-lg">{activeData.totalGeral.toLocaleString('pt-BR')}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
