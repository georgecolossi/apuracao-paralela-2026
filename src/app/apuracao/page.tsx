'use client';
import { useEffect, useState } from 'react';
import { Activity, Radio, AlertCircle, RefreshCw, Archive, CheckCircle2, AlertTriangle, Users, FileText, Ban } from 'lucide-react';
import { getOfficeDataAggregate, TotalItem } from '@/lib/presentation/apuracaoHelper';
interface TotalsData {
  processedReports: number;
  expectedReports: number;
  totals: TotalItem[];
  election?: { plei: string | null; year: number; name: string };
  round?: { roundNumber: number };
}
export default function ApuracaoPage() {
  const [totals, setTotals] = useState<TotalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activeOffice, setActiveOffice] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'CANDIDATOS' | 'LEGENDA' | 'BRANCOS_NULOS'>('CANDIDATOS');
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
    return getOfficeDataAggregate(totals.election?.plei, totals.round?.roundNumber, officeName, totals.totals);
  };
  const activeData = activeOffice ? getOfficeData(activeOffice) : null;
  const hasLegenda = activeData && activeData.legendas.length > 0;
  useEffect(() => {
    if (activeTab === 'LEGENDA' && !hasLegenda) {
      setActiveTab('CANDIDATOS');
    }
  }, [activeOffice, hasLegenda, activeTab]);
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      <header className="bg-slate-900 border-b-4 border-indigo-600 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Archive className="text-indigo-400 w-6 h-6 hidden sm:block" />
            <div className="flex flex-col">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-tight uppercase leading-none">
                Apuração Paralela — Concórdia
              </h1>
              {totals?.round && (
                <span className="text-xs text-indigo-300 font-bold tracking-widest uppercase mt-1">
                  {totals.round.roundNumber}º Turno
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded bg-slate-800 text-slate-300 text-sm font-medium border border-slate-700">
              {connected ? (
                <><Radio className="w-4 h-4 text-emerald-400 animate-pulse" /> Ao Vivo</>
              ) : (
                <><RefreshCw className="w-4 h-4 text-amber-400 animate-spin" /> Conectando...</>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-6 flex flex-col gap-6">
        <div className="bg-white rounded-xl p-5 md:p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              loading ? 'bg-slate-100 text-slate-400' :
              error ? 'bg-red-100 text-red-600' :
              totals?.processedReports === totals?.expectedReports ? 'bg-emerald-100 text-emerald-600' :
              'bg-amber-100 text-amber-600'
            }`}>
              {loading ? <RefreshCw className="w-6 h-6 animate-spin" /> :
               error ? <AlertCircle className="w-6 h-6" /> :
               totals?.processedReports === totals?.expectedReports ? <CheckCircle2 className="w-6 h-6" /> :
               <AlertTriangle className="w-6 h-6" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                {loading ? 'Carregando dados...' :
                 error ? 'Erro de conexão' :
                 totals?.processedReports === totals?.expectedReports ? 'Apuração Concluída' :
                 'Apuração em Andamento'}
              </h2>
              {totals && (
                <p className="text-sm font-medium text-slate-500">
                  {totals.processedReports} de {totals.expectedReports} urnas processadas
                </p>
              )}
            </div>
          </div>
          {totals && totals.expectedReports > 0 && (
            <div className="flex-1 max-w-xs w-full">
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                <span>Progresso</span>
                <span>{((totals.processedReports / totals.expectedReports) * 100).toFixed(2).replace('.', ',')}%</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-1000 ease-out"
                  style={{ width: `${(totals.processedReports / totals.expectedReports) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
        {loading && !totals && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-10 h-10 animate-spin mb-4" />
            <p className="font-medium">Sincronizando dados...</p>
          </div>
        )}
        {totals && offices.length > 0 && (
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="flex overflow-x-auto scrollbar-hide">
                {offices.map(office => (
                  <button
                    key={office}
                    onClick={() => {
                      setActiveOffice(office);
                    }}
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
            {activeData && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2 flex flex-col gap-4">
                  <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setActiveTab('CANDIDATOS')}
                      className={`flex-1 px-4 py-3 text-sm font-bold uppercase flex items-center justify-center gap-2 transition-colors border-b-2 ${
                        activeTab === 'CANDIDATOS'
                          ? 'text-indigo-700 border-indigo-600 bg-indigo-50/30'
                          : 'text-slate-500 border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      Candidatos
                    </button>
                    {hasLegenda && (
                      <button
                        onClick={() => setActiveTab('LEGENDA')}
                        className={`flex-1 px-4 py-3 text-sm font-bold uppercase flex items-center justify-center gap-2 transition-colors border-b-2 ${
                          activeTab === 'LEGENDA'
                            ? 'text-indigo-700 border-indigo-600 bg-indigo-50/30'
                            : 'text-slate-500 border-transparent hover:bg-slate-50'
                        }`}
                      >
                        <FileText className="w-4 h-4" />
                        Legenda
                      </button>
                    )}
                    <button
                      onClick={() => setActiveTab('BRANCOS_NULOS')}
                      className={`flex-1 px-4 py-3 text-sm font-bold uppercase flex items-center justify-center gap-2 transition-colors border-b-2 ${
                        activeTab === 'BRANCOS_NULOS'
                          ? 'text-indigo-700 border-indigo-600 bg-indigo-50/30'
                          : 'text-slate-500 border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <Ban className="w-4 h-4" />
                      Brancos / Nulos
                    </button>
                  </div>
                  {activeTab === 'CANDIDATOS' && (
                    <div className="flex flex-col gap-3">
                      {activeData.candidates.length === 0 ? (
                        <div className="bg-white p-8 text-center rounded-xl shadow-sm border border-slate-200 text-slate-500">
                          Nenhum voto válido nominal contabilizado para este cargo.
                        </div>
                      ) : (
                        activeData.candidates.map((cand, idx) => {
                          const percent = activeData.totalValidos > 0
                            ? ((cand.quantity / activeData.totalValidos) * 100)
                            : 0;
                          return (
                            <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 relative overflow-hidden group">
                              <div
                                className="absolute left-0 top-0 bottom-0 bg-indigo-50/50 -z-10 transition-all duration-1000 ease-out"
                                style={{ width: `${percent}%` }}
                              />
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-10">
                                <div className="flex-1 pl-3">
                                  <h3 className="text-2xl md:text-3xl font-black text-slate-900 leading-none">
                                    {cand.candidateName}
                                  </h3>
                                  <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mt-1.5 flex items-center gap-2">
                                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">{cand.candidateNumber}</span>
                                    {cand.partyAbbreviation ? (
                                      <span>{cand.partyAbbreviation}</span>
                                    ) : (
                                      <span>Partido {cand.partyNumber}</span>
                                    )}
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
                  )}
                  {activeTab === 'LEGENDA' && (
                    <div className="flex flex-col gap-3">
                      {activeData.legendas.length === 0 ? (
                        <div className="bg-white p-8 text-center rounded-xl shadow-sm border border-slate-200 text-slate-500">
                          Nenhum voto de legenda contabilizado para este cargo.
                        </div>
                      ) : (
                        activeData.legendas.map((leg, idx) => {
                          const percent = activeData.totalValidos > 0
                            ? ((leg.quantity / activeData.totalValidos) * 100)
                            : 0;
                          return (
                            <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-5 relative overflow-hidden group">
                              <div
                                className="absolute left-0 top-0 bottom-0 bg-slate-100/50 -z-10 transition-all duration-1000 ease-out"
                                style={{ width: `${percent}%` }}
                              />
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-400" />
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-10">
                                <div className="flex-1 pl-3">
                                  <h3 className="text-xl md:text-2xl font-black text-slate-800 leading-none">
                                    {leg.partyAbbreviation ? leg.partyAbbreviation : `Partido ${leg.partyNumber}`}
                                  </h3>
                                  <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mt-1.5 flex items-center gap-2">
                                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">{leg.partyNumber}</span>
                                    <span>Voto de Legenda</span>
                                  </p>
                                </div>
                                <div className="flex flex-row sm:flex-col items-end justify-between sm:justify-center border-t sm:border-t-0 pt-3 sm:pt-0 mt-3 sm:mt-0 border-slate-100">
                                  <div className="text-left sm:text-right">
                                    <p className="text-xl md:text-2xl font-black text-slate-700 leading-none">
                                      {leg.quantity.toLocaleString('pt-BR')}
                                    </p>
                                    <p className="text-xs uppercase font-bold text-slate-400 mt-1">votos</p>
                                  </div>
                                  <div className="text-right sm:mt-1">
                                    <p className="text-lg md:text-xl font-bold text-slate-600">
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
                  )}
                  {activeTab === 'BRANCOS_NULOS' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-slate-800 uppercase">Em Branco</h3>
                          <p className="text-sm text-slate-500 mt-1">Votos registrados na tecla Branco.</p>
                        </div>
                        <div className="mt-6 text-right">
                          <span className="text-4xl font-black text-slate-900">{activeData.brancos.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-slate-800 uppercase">Nulos</h3>
                          <p className="text-sm text-slate-500 mt-1">Votos anulados diretamente na urna.</p>
                        </div>
                        <div className="mt-6 text-right">
                          <span className="text-4xl font-black text-slate-900">{activeData.nulos.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                      {activeData.nulosTecnicos > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                          <div>
                            <h3 className="text-lg font-bold text-amber-700 uppercase">Nulos Técnicos</h3>
                            <p className="text-sm text-slate-500 mt-1">Votos nominais atribuídos a candidaturas sem validade ou sub judice.</p>
                          </div>
                          <div className="mt-6 text-right">
                            <span className="text-4xl font-black text-amber-700">{activeData.nulosTecnicos.toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                      )}
                      {activeData.pendentes > 0 && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                          <div>
                            <h3 className="text-lg font-bold text-slate-800 uppercase">Outros / Pendentes</h3>
                            <p className="text-sm text-slate-500 mt-1">Votos nominais que não puderam ser atribuídos a candidatos.</p>
                          </div>
                          <div className="mt-6 text-right">
                            <span className="text-4xl font-black text-slate-900">{activeData.pendentes.toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
                        <span className="text-sm font-bold uppercase text-slate-500">Nulos Total</span>
                        <span className="text-lg font-black text-slate-800">
                          {(activeData.nulos + activeData.nulosTecnicos + activeData.pendentes).toLocaleString('pt-BR')}
                        </span>
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
                    Os percentuais de candidatos e legendas são calculados exclusivamente sobre os votos <strong>válidos</strong>, seguindo a regra da Justiça Eleitoral. Brancos e Nulos não são considerados votos válidos.
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