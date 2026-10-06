'use client';
import { useEffect, useState } from 'react';
import { Activity, Archive, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { getOfficeDataAggregate } from '@/lib/presentation/apuracaoHelper';

export default function ApuracaoDashboard() {
  const [source, setSource] = useState('PARALELA');
  const [round, setRound] = useState(1);
  const [paralela, setParalela] = useState<any>(null);
  const [tse, setTse] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const fetchData = async () => {
      try {
        const [pRes, tRes] = await Promise.all([
          fetch('/api/totals?round=' + round),
          fetch('/api/tse-results?round=' + round)
        ]);
        
        const pData = pRes.ok ? await pRes.json() : null;
        const tData = tRes.ok ? await tRes.json() : null;

        if (mounted) {
          if (pData) setParalela(pData);
          if (tData) setTse(tData);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    const iv = setInterval(fetchData, 15000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, [round]);

  const offices = ['Presidente', 'Governador', 'Senador', 'Deputado Federal', 'Deputado Estadual'];
  const isMajoritario = (n: string) => ['Presidente', 'Governador', 'Senador'].includes(n);

  const renderParalela = () => {
    if (!paralela || !paralela.totals) return <div className="p-8 text-center text-slate-500 font-bold uppercase tracking-widest">Sem dados no sistema local</div>;
    const p = paralela.processedReports;
    const e = paralela.expectedReports;
    const coverage = e > 0 ? p / e : 0;
    const showProj = coverage >= 0.25 && p < e;

    return (
      <div className="space-y-6">
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between shadow-sm gap-4">
          <div>
            <h2 className="font-black text-slate-800 flex items-center gap-2 text-xl tracking-tight uppercase">
              <Archive className="w-6 h-6 text-indigo-500" />
              Apuração Independente (Tempo Real)
            </h2>
            <p className="text-sm text-slate-500 font-medium">Dados contabilizados pela apuração paralela baseada nos BUs auditados.</p>
          </div>
          <div className="bg-indigo-50 px-6 py-3 rounded-xl border border-indigo-100 text-center md:text-right">
            <div className="text-3xl font-black text-indigo-900 tracking-tighter">{p} / {e}</div>
            <div className="text-[10px] uppercase font-bold text-indigo-600 tracking-widest">Urnas Processadas</div>
          </div>
        </div>

        {offices.map(office => {
          const data = getOfficeDataAggregate(paralela.election?.plei, round, office, paralela.totals);
          if (data.totalGeral === 0) return null;
          return (
            <div key={office} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-slate-50 border-b border-slate-200 p-4 md:px-6">
                <h3 className="font-black text-slate-800 uppercase tracking-widest text-lg">{office}</h3>
              </div>
              <div className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100">
                      <th className="p-4 px-6 text-xs font-bold uppercase text-slate-500 tracking-wider">Candidato</th>
                      <th className="p-4 px-6 text-xs font-bold uppercase text-slate-500 tracking-wider text-right">Votos</th>
                      <th className="p-4 px-6 text-xs font-bold uppercase text-slate-500 tracking-wider text-right">% Válidos</th>
                      {isMajoritario(office) && <th className="p-4 px-6 text-xs font-bold uppercase text-indigo-500 tracking-wider text-right">Projeção*</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.candidates.map((c: any) => {
                      const pct = data.totalValidos > 0 ? ((c.quantity / data.totalValidos) * 100) : 0;
                      // Projeção: extrapolação linear simples
                      const proj = showProj ? Math.round(c.quantity * (e / p)) : null;
                      return (
                        <tr key={c.candidateNumber} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                          <td className="p-4 px-6">
                            <div className="font-black text-slate-800 text-lg">{c.candidateName || 'Não identificado'}</div>
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-0.5">{c.partyAbbreviation || 'Partido ' + c.partyNumber} - {c.candidateNumber}</div>
                          </td>
                          <td className="p-4 px-6 text-right font-black text-slate-700 text-xl">{c.quantity.toLocaleString('pt-BR')}</td>
                          <td className="p-4 px-6 text-right font-black text-slate-600 text-xl">{pct.toFixed(2).replace('.', ',')}%</td>
                          {isMajoritario(office) && (
                            <td className="p-4 px-6 text-right font-black text-indigo-600 text-xl bg-indigo-50/30">
                              {showProj ? proj!.toLocaleString('pt-BR') : '-'}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bg-slate-50/80 p-4 md:px-6 border-t border-slate-100 flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Válidos:</span>
                  <span className="font-black text-slate-800 text-base">{data.totalValidos.toLocaleString('pt-BR')}</span>
                  <span className="text-slate-400 font-bold text-xs">({data.totalGeral > 0 ? ((data.totalValidos/data.totalGeral)*100).toFixed(2).replace(".", ",") : "0,00"}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Brancos:</span>
                  <span className="font-black text-slate-800 text-base">{data.brancos.toLocaleString('pt-BR')}</span>
                  <span className="text-slate-400 font-bold text-xs">({data.totalGeral > 0 ? ((data.brancos/data.totalGeral)*100).toFixed(2).replace(".", ",") : "0,00"}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Nulos:</span>
                  <span className="font-black text-slate-800 text-base">{(data.nulos + data.nulosTecnicos + data.pendentes).toLocaleString('pt-BR')}</span>
                  <span className="text-slate-400 font-bold text-xs">({data.totalGeral > 0 ? (((data.nulos+data.nulosTecnicos+data.pendentes)/data.totalGeral)*100).toFixed(2).replace(".", ",") : "0,00"}%)</span>
                </div>
              </div>
            </div>
          );
        })}
        {showProj && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 p-4 md:p-5 rounded-2xl text-sm flex gap-4 shadow-sm items-start">
            <AlertCircle className="w-6 h-6 shrink-0 text-indigo-600 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="block mb-1 text-indigo-900 tracking-wide">PROJEÇÃO COM BASE NAS URNAS APURADAS</strong>
              Estimativa matemática baseada nas urnas já apuradas. Não representa resultado oficial nem declaração de vencedor.
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTSE = () => {
    if (!tse) return <div className="p-8 text-center text-slate-500 font-bold uppercase tracking-widest">Carregando dados oficiais...</div>;
    
    if (tse.status === 'NOT_YET_AVAILABLE' || (tse.offices && tse.offices.length === 0)) {
      return (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-sm">
          <ShieldCheck className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-slate-700 tracking-tight">Resultado oficial ainda não disponível</h2>
          <p className="text-slate-500 mt-2 font-medium">Os arquivos do TSE para o Turno {round} não foram publicados ou configurados.</p>
        </div>
      );
    }

    if (tse.status === 'TEMPORARILY_UNAVAILABLE') {
      return (
        <div className="bg-red-50 p-12 rounded-2xl border border-red-200 text-center shadow-sm">
          <AlertCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-red-800 tracking-tight">TSE Temporariamente Indisponível</h2>
          <p className="text-red-600 mt-2 font-medium">Não foi possível conectar à base oficial no momento. Tente novamente em breve.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="bg-emerald-50 border border-emerald-200 p-4 md:p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between shadow-sm gap-4">
          <div>
            <h2 className="font-black text-emerald-900 flex items-center gap-2 text-xl tracking-tight uppercase">
              <ShieldCheck className="w-6 h-6" />
              Fonte Oficial: Tribunal Superior Eleitoral
            </h2>
            <p className="text-sm text-emerald-700 font-medium">Espelho direto dos arquivos abertos do TSE (EA20).</p>
          </div>
        </div>

        {tse.offices?.map((o: any) => {
          if (o.status !== 'AVAILABLE') return null;
          return (
            <div key={o.cargo} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-slate-50 border-b border-slate-200 p-4 md:px-6 flex justify-between items-center flex-wrap gap-4">
                <h3 className="font-black text-slate-800 uppercase tracking-widest text-lg">{o.cargoName}</h3>
                <div className="bg-emerald-100 px-4 py-2 rounded-lg border border-emerald-200 text-right">
                  <div className="text-sm font-black text-emerald-900">{o.progress.processed} / {o.progress.total} seções</div>
                  <div className="text-[10px] uppercase font-bold text-emerald-700 tracking-widest text-center mt-0.5">{o.progress.percent}% apurado</div>
                </div>
              </div>
              <div className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[500px]">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100">
                      <th className="p-4 px-6 text-xs font-bold uppercase text-slate-500 tracking-wider">Candidato</th>
                      <th className="p-4 px-6 text-xs font-bold uppercase text-slate-500 tracking-wider text-right">Votos</th>
                      <th className="p-4 px-6 text-xs font-bold uppercase text-slate-500 tracking-wider text-right">% Válidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.candidates?.map((c: any) => (
                      <tr key={c.number} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 px-6 font-black text-slate-800 text-lg">
                          {c.name} <span className="text-slate-400 font-normal text-sm ml-2">- {c.number}</span>
                        </td>
                        <td className="p-4 px-6 text-right font-black text-slate-700 text-xl">{c.votes.toLocaleString('pt-BR')}</td>
                        <td className="p-4 px-6 text-right font-black text-slate-600 text-xl">{c.percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-slate-50/80 p-4 md:px-6 border-t border-slate-100 flex flex-col gap-4">
                <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Válidos:</span>
                    <span className="font-black text-slate-800 text-base">{o.validVotes.quantity.toLocaleString('pt-BR')}</span>
                    <span className="text-slate-400 font-bold text-xs">({o.validVotes.percent}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Brancos:</span>
                    <span className="font-black text-slate-800 text-base">{o.blankVotes.quantity.toLocaleString('pt-BR')}</span>
                    <span className="text-slate-400 font-bold text-xs">({o.blankVotes.percent}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Nulos:</span>
                    <span className="font-black text-slate-800 text-base">{o.nullVotes.quantity.toLocaleString('pt-BR')}</span>
                    <span className="text-slate-400 font-bold text-xs">({o.nullVotes.percent}%)</span>
                  </div>
                </div>
                <div className="h-px bg-slate-200 w-full" />
                <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Aptos:</span>
                    <span className="font-black text-slate-800 text-base">{o.attendance.eligible.toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Comparecimento:</span>
                    <span className="font-black text-slate-800 text-base">{o.attendance.turnout.toLocaleString('pt-BR')}</span>
                    <span className="text-slate-400 font-bold text-xs">({o.attendance.turnoutPercent}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">Abstenção:</span>
                    <span className="font-black text-slate-800 text-base">{o.attendance.abstention.toLocaleString('pt-BR')}</span>
                    <span className="text-slate-400 font-bold text-xs">({o.attendance.abstentionPercent}%)</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20">
      <header className="bg-slate-900 text-white p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
              <Activity className="text-indigo-400 w-7 h-7" />
              Painel Eleitoral 2026
            </h1>
            <p className="text-sm text-slate-400 font-bold tracking-widest uppercase mt-0.5 ml-10">Concórdia / SC</p>
          </div>
          <div className="flex gap-2 bg-slate-800 p-1.5 rounded-xl border border-slate-700">
            <button 
              onClick={() => setRound(1)} 
              className={`px-6 py-2.5 rounded-lg font-black text-sm transition-colors uppercase tracking-widest ${round === 1 ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              1º Turno
            </button>
            <button 
              onClick={() => setRound(2)} 
              className={`px-6 py-2.5 rounded-lg font-black text-sm transition-colors uppercase tracking-widest ${round === 2 ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              2º Turno
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-6 mt-2">
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <button 
            onClick={() => setSource('PARALELA')}
            className={`flex-1 p-5 rounded-2xl border-2 transition-all flex items-center gap-4 ${source === 'PARALELA' ? 'border-indigo-600 bg-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300'}`}
          >
            <div className={`p-3 rounded-full ${source === 'PARALELA' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
              <Archive className="w-6 h-6" />
            </div>
            <div className="text-left">
              <div className={`font-black uppercase tracking-widest ${source === 'PARALELA' ? 'text-slate-900' : ''}`}>Apuração Paralela</div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">Fonte independente local</div>
            </div>
          </button>
          <button 
            onClick={() => setSource('TSE')}
            className={`flex-1 p-5 rounded-2xl border-2 transition-all flex items-center gap-4 ${source === 'TSE' ? 'border-emerald-500 bg-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300'}`}
          >
            <div className={`p-3 rounded-full ${source === 'TSE' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="text-left">
              <div className={`font-black uppercase tracking-widest ${source === 'TSE' ? 'text-slate-900' : ''}`}>Resultado Oficial TSE</div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">Fonte governamental</div>
            </div>
          </button>
        </div>

        {loading && !paralela && !tse && (
          <div className="text-center p-12 text-slate-400 font-bold uppercase tracking-widest animate-pulse flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 animate-spin" />
            Carregando painel...
          </div>
        )}
        
        {(!loading || paralela || tse) && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {source === 'PARALELA' ? renderParalela() : renderTSE()}
          </div>
        )}
      </main>
    </div>
  );
}
