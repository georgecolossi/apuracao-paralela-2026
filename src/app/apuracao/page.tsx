'use client';

import { useEffect, useState } from 'react';
import { Activity, Radio, AlertCircle, RefreshCw, Archive, CheckCircle2, AlertTriangle, Users } from 'lucide-react';

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
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchTotals();

    const evtSource = new EventSource('/api/realtime');
    
    evtSource.onopen = () => {
      if (mounted) setConnected(true);
      fetchTotals();
    };

    evtSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'BU_PROCESSED') {
          fetchTotals();
        }
      } catch {}
    };

    evtSource.onerror = () => {
      if (mounted) {
        setConnected(false);
        setError(true);
      }
    };

    return () => {
      mounted = false;
      evtSource.close();
    };
  }, []);

  const offices = totals?.totals ? Array.from(new Set(totals.totals.map(t => t.officeName))) : [];

  const getOfficeData = (officeName: string) => {
    if (!totals) return null;
    
    const officeVotes = totals.totals.filter(t => t.officeName === officeName);
    
    let validos = 0;
    let brancos = 0;
    let nulos = 0;
    
    const candidateMap = new Map<string, { candidateNumber: string; partyNumber: string; quantity: number }>();

    for (const v of officeVotes) {
      if (v.voteType === 'BRANCO') brancos += v.quantity;
      else if (v.voteType === 'NULO') nulos += v.quantity;
      else if (v.voteType === 'NOMINAL' || v.voteType === 'LEGENDA') {
        validos += v.quantity;
        const key = v.voteType === 'LEGENDA' ? `LEG_${v.partyNumber}` : `NOM_${v.candidateNumber}`;
        
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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      {/* Header Profissional / Jornalístico */}
      <header className="bg-slate-900 border-b-4 border-indigo-600 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Archive className="text-indigo-400 w-6 h-6 hidden sm:block" />
            <h1 className="text-xl md:text-2xl font-black text-white tracking-tight uppercase">
              Apuração Paralela — Concórdia e Região
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded bg-slate-800 text-slate-300 text-sm font-medium border border-slate-700">
              {connected ? (
                <><Radio className="w-4 h-4 text-emerald-400 animate-pulse" /> Ao Vivo</>
              ) : (
                <><RefreshCw className="w-4 h-4 text-amber-400 animate-spin" /> Conectando...</>
              )}
            </div>
            <div className="bg-red-600/90 text-white px-3 py-1.5 rounded text-xs md:text-sm font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span className="hidden sm:inline">Resultado</span> Não Oficial
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-6 md:py-8 flex flex-col gap-6">
        
        {/* Status Bar */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch justify-between">
          <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-indigo-50 p-3 rounded-lg text-indigo-600">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">Urnas Apuradas (BUs)</p>
              <p className="text-2xl md:text-3xl font-black text-slate-900 leading-none mt-1">
                {totals?.processedReports || 0}
              </p>
            </div>
          </div>

          <div className="flex-1 bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-slate-50 p-3 rounded-lg text-slate-600">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">Última Atualização</p>
              <p className="text-xl md:text-2xl font-bold text-slate-900 leading-none mt-1">
                {lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR') : '--:--:--'}
              </p>
            </div>
          </div>
          
          {/* Mobile Connection Status */}
          <div className="md:hidden bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-3 justify-center">
            {connected ? (
              <><Radio className="w-5 h-5 text-emerald-500 animate-pulse" /> <span className="font-bold text-emerald-700">Conectado (Ao Vivo)</span></>
            ) : (
              <><RefreshCw className="w-5 h-5 text-amber-500 animate-spin" /> <span className="font-bold text-amber-700">Reconectando...</span></>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
            <div>
              <p className="font-bold">Aviso de Conexão</p>
              <p className="text-sm mt-1 text-red-700">A conexão em tempo real foi perdida. O sistema está tentando reconectar automaticamente para buscar novos resultados.</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="font-medium">Carregando dados da apuração...</p>
          </div>
        ) : offices.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-xl shadow-sm border border-slate-200 flex flex-col items-center">
            <div className="bg-slate-50 p-4 rounded-full mb-4">
              <Archive className="w-10 h-10 text-slate-400" />
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-slate-800 mb-2">A apuração ainda não iniciou</h2>
            <p className="text-slate-500 max-w-md mx-auto">Nenhum Boletim de Urna foi processado e confirmado no sistema até o momento. Aguarde os primeiros resultados.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            
            {/* Seletor de Cargos (Tabs) */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="flex overflow-x-auto scrollbar-hide">
                {offices.map(office => (
                  <button
                    key={office}
                    onClick={() => setActiveOffice(office)}
                    className={`flex-1 min-w-[140px] px-4 py-4 font-bold text-sm uppercase tracking-wide transition-colors border-b-2 outline-none focus-visible:bg-slate-50 ${
                      activeOffice === office 
                        ? 'bg-indigo-50/50 text-indigo-700 border-indigo-600' 
                        : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {office}
                  </button>
                ))}
              </div>
            </div>

            {/* View do Cargo Selecionado */}
            {activeData && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                
                {/* Lista de Candidatos */}
                <div className="lg:col-span-2 flex flex-col gap-3">
                  <h2 className="text-lg font-bold uppercase tracking-tight text-slate-800 mb-1 flex items-center gap-2">
                    <Users className="w-5 h-5 text-slate-400" />
                    Votos Nominais e Legenda
                  </h2>
                  
                  {activeData.candidates.length === 0 ? (
                    <div className="bg-white p-8 text-center rounded-xl shadow-sm border border-slate-200 text-slate-500">
                      Nenhum voto válido contabilizado para este cargo.
                    </div>
                  ) : (
                    activeData.candidates.map((cand, idx) => {
                      const percent = activeData.totalValidos > 0 
                        ? ((cand.quantity / activeData.totalValidos) * 100) 
                        : 0;
                        
                      return (
                        <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 relative overflow-hidden group">
                          {/* Barra de progresso de fundo sutil */}
                          <div 
                            className="absolute left-0 top-0 bottom-0 bg-indigo-50/50 -z-10 transition-all duration-1000 ease-out" 
                            style={{ width: `${percent}%` }}
                          />
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />
                          
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-10">
                            <div className="flex-1 pl-3">
                              <h3 className="text-2xl md:text-3xl font-black text-slate-900 leading-none">
                                {cand.candidateNumber}
                              </h3>
                              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mt-1.5">
                                Partido {cand.partyNumber}
                              </p>
                            </div>
                            
                            <div className="flex flex-row sm:flex-col items-end justify-between sm:justify-center border-t sm:border-t-0 pt-3 sm:pt-0 mt-3 sm:mt-0 border-slate-100">
                              <div className="text-left sm:text-right">
                                <p className="text-2xl md:text-3xl font-black text-indigo-700 leading-none">
                                  {cand.quantity.toLocaleString('pt-BR')}
                                </p>
                                <p className="text-xs uppercase font-bold text-slate-400 mt-1">votos</p>
                              </div>
                              <div className="text-right sm:mt-1">
                                <p className="text-xl md:text-2xl font-bold text-slate-800">
                                  {percent.toFixed(2).replace('.', ',')}%
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Sidebar - Resumo Matemático */}
                <div className="flex flex-col gap-3 lg:sticky lg:top-24">
                  <h2 className="text-lg font-bold uppercase tracking-tight text-slate-800 mb-1 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-slate-400" />
                    Composição dos Votos
                  </h2>
                  
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-5 flex flex-col gap-4">
                      
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold uppercase text-slate-500">Válidos</span>
                        <span className="text-lg font-black text-slate-800">{activeData.totalValidos.toLocaleString('pt-BR')}</span>
                      </div>
                      
                      <div className="h-px bg-slate-100" />
                      
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold uppercase text-slate-500">Brancos</span>
                        <span className="text-lg font-black text-slate-800">{activeData.brancos.toLocaleString('pt-BR')}</span>
                      </div>
                      
                      <div className="h-px bg-slate-100" />
                      
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold uppercase text-slate-500">Nulos</span>
                        <span className="text-lg font-black text-slate-800">{activeData.nulos.toLocaleString('pt-BR')}</span>
                      </div>
                      
                    </div>
                    
                    <div className="bg-slate-50 p-5 border-t border-slate-200">
                      <div className="flex justify-between items-end">
                        <div>
                          <span className="block text-xs font-bold uppercase text-slate-400 mb-1">Total Processado</span>
                          <span className="text-sm font-bold text-slate-600">Neste cargo</span>
                        </div>
                        <span className="text-3xl font-black text-indigo-700 leading-none">
                          {activeData.totalGeral.toLocaleString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-slate-100 p-4 rounded-xl text-xs text-slate-500 mt-2 border border-slate-200">
                    Os percentuais de candidatos são calculados exclusivamente sobre os votos <strong>válidos</strong>, seguindo a regra da Justiça Eleitoral. Brancos e Nulos não são considerados votos válidos.
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
