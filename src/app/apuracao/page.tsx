
'use client';
import { useEffect, useState } from 'react';
import { Activity, Archive, ShieldCheck, AlertCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { getOfficeDataAggregate } from '@/lib/presentation/apuracaoHelper';

function OfficeResultCard({
  officeName,
  candidates,
  validVotes,
  blankVotes,
  nullVotes,
  totalGeral,
  eligible,
  turnout,
  abstention,
  turnoutPercent,
  abstentionPercent,
  progressProcessed,
  progressTotal,
  progressPercent,
  source,
  round,
  isMajoritario,
  expandedKey,
  isExpanded,
  onToggleExpand
}: any) {
  // Sort candidates by votes DESC, then candidateNumber ASC
  const sortedCandidates = [...candidates].sort((a, b) => {
    const votesDiff = (b.quantity ?? b.votes) - (a.quantity ?? a.votes);
    if (votesDiff !== 0) return votesDiff;
    const numA = parseInt(a.candidateNumber ?? a.number) || 0;
    const numB = parseInt(b.candidateNumber ?? b.number) || 0;
    return numA - numB;
  });

  const INITIAL_LIMIT = 5;
  const showExpandControl = sortedCandidates.length > INITIAL_LIMIT;
  const displayedCandidates = isExpanded ? sortedCandidates : sortedCandidates.slice(0, INITIAL_LIMIT);

  // Projection logic
  const coverage = progressTotal > 0 ? progressProcessed / progressTotal : 0;
  const hasProjection = source === 'PARALELA' && isMajoritario && coverage >= 0.25 && progressProcessed < progressTotal;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
      <div className="bg-slate-50 border-b border-slate-200 p-3 md:px-5 flex justify-between items-center flex-wrap gap-4">
        <h3 className="font-black text-slate-800 uppercase tracking-widest text-base md:text-lg">{officeName}</h3>
        <div className={`px-3 py-1.5 rounded-lg border text-right ${source === 'PARALELA' ? 'bg-indigo-50 border-indigo-100 text-indigo-900' : 'bg-emerald-50 border-emerald-100 text-emerald-900'}`}>
          <div className="text-sm font-black">{progressProcessed.toLocaleString('pt-BR')} / {progressTotal.toLocaleString('pt-BR')} {(source === 'TSE' ? 'seções' : 'urnas')}</div>
          {source === 'TSE' && <div className="text-[10px] uppercase font-bold tracking-widest text-center mt-0.5 opacity-80">{progressPercent}% apurado</div>}
        </div>
      </div>
      
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[500px]">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-100">
              <th className="p-3 px-5 text-xs font-bold uppercase text-slate-500 tracking-wider">Candidato</th>
              <th className="p-3 px-5 text-xs font-bold uppercase text-slate-500 tracking-wider text-right w-24">Votos</th>
              <th className="p-3 px-5 text-xs font-bold uppercase text-slate-500 tracking-wider text-right w-24">% Válidos</th>
              {hasProjection && <th className="p-3 px-5 text-xs font-bold uppercase text-indigo-500 tracking-wider text-right w-32">Projeção*</th>}
            </tr>
          </thead>
          <tbody>
            {displayedCandidates.map((c: any) => {
              const v = c.quantity ?? c.votes;
              const num = c.candidateNumber ?? c.number;
              const name = c.candidateName ?? c.name;
              const party = c.partyAbbreviation ?? 'Partido ' + (c.partyNumber ?? '');
              
              const pct = typeof c.percent === 'string' 
                ? c.percent 
                : (validVotes > 0 ? ((v / validVotes) * 100).toFixed(2).replace('.', ',') : '0,00');

              const proj = hasProjection ? Math.round(v * (progressTotal / progressProcessed)) : null;

              return (
                <tr key={num} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 px-5">
                    <div className="font-black text-slate-800 text-base">{name || 'Não identificado'}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{party} - {num}</div>
                  </td>
                  <td className="p-3 px-5 text-right font-black text-slate-700 text-lg">{v.toLocaleString('pt-BR')}</td>
                  <td className="p-3 px-5 text-right font-black text-slate-600 text-lg">{pct}%</td>
                  {hasProjection && (
                    <td className="p-3 px-5 text-right font-black text-indigo-600 text-lg bg-indigo-50/30">
                      ≈ {proj!.toLocaleString('pt-BR')}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showExpandControl && (
        <button 
          onClick={() => onToggleExpand(expandedKey)}
          aria-expanded={isExpanded}
          className="w-full bg-slate-50/50 hover:bg-slate-100 border-t border-slate-100 p-2 text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center justify-center gap-2 transition-colors"
        >
          {isExpanded ? (
            <>Recolher <ChevronUp className="w-4 h-4" /></>
          ) : (
            <>Ver todos ({sortedCandidates.length}) <ChevronDown className="w-4 h-4" /></>
          )}
        </button>
      )}

      <div className="bg-slate-50/80 p-3 md:px-5 border-t border-slate-100 flex flex-col gap-3 flex-1 justify-end">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Válidos:</span>
            <span className="font-black text-slate-800 text-sm">{validVotes.toLocaleString('pt-BR')}</span>
            {totalGeral > 0 && <span className="text-slate-400 font-bold text-[10px]">({((validVotes/totalGeral)*100).toFixed(2).replace(".", ",")}%)</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Brancos:</span>
            <span className="font-black text-slate-800 text-sm">{blankVotes.toLocaleString('pt-BR')}</span>
            {totalGeral > 0 && <span className="text-slate-400 font-bold text-[10px]">({((blankVotes/totalGeral)*100).toFixed(2).replace(".", ",")}%)</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Nulos:</span>
            <span className="font-black text-slate-800 text-sm">{nullVotes.toLocaleString('pt-BR')}</span>
            {totalGeral > 0 && <span className="text-slate-400 font-bold text-[10px]">({((nullVotes/totalGeral)*100).toFixed(2).replace(".", ",")}%)</span>}
          </div>
        </div>
        
        {source === 'TSE' && (
          <>
            <div className="h-px bg-slate-200 w-full" />
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Aptos:</span>
                <span className="font-black text-slate-800 text-sm">{eligible.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Comparec:</span>
                <span className="font-black text-slate-800 text-sm">{turnout.toLocaleString('pt-BR')}</span>
                <span className="text-slate-400 font-bold text-[10px]">({turnoutPercent}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Abstenção:</span>
                <span className="font-black text-slate-800 text-sm">{abstention.toLocaleString('pt-BR')}</span>
                <span className="text-slate-400 font-bold text-[10px]">({abstentionPercent}%)</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ApuracaoDashboard() {
  const [source, setSource] = useState('PARALELA');
  const [round, setRound] = useState(1);
  const [paralela, setParalela] = useState<any>(null);
  const [tse, setTse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Track expanded state by unique context key: `${source}:${round}:${officeName}`
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const handleToggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

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

    if (paralela.coverageConfigured === false) {
      return (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-sm">
          <Archive className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-xl font-black text-slate-700 tracking-tight">Cobertura ainda não configurada</h2>
          <p className="text-slate-500 text-sm mt-2 font-medium">Aguardando configuração das seções do turno para iniciar a apuração paralela.</p>
        </div>
      );
    }

    const p = paralela.processedReports;
    const e = paralela.expectedReports;
    
    // Check if any visible office has projection enabled
    const coverage = e > 0 ? p / e : 0;
    const hasAnyProjection = coverage >= 0.25 && p < e; // Applies only to Majoritario

    return (
      <div className="space-y-6">
        {hasAnyProjection && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 p-4 rounded-xl text-sm flex gap-4 shadow-sm items-start">
            <AlertCircle className="w-5 h-5 shrink-0 text-indigo-600 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="block text-indigo-900 tracking-wide text-xs">PROJEÇÃO COM BASE NAS URNAS APURADAS*</strong>
              <span className="text-[11px] opacity-90">Estimativa matemática baseada nas urnas já apuradas. Não representa resultado oficial nem declaração de vencedor. (Apenas majoritários).</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          {offices.map(office => {
            const data = getOfficeDataAggregate(paralela.election?.plei, round, office, paralela.totals);
            if (data.totalGeral === 0) return null;
            
            const expKey = `PARALELA:${round}:${office}`;
            return (
              <OfficeResultCard
                key={office}
                officeName={office}
                candidates={data.candidates}
                validVotes={data.totalValidos}
                blankVotes={data.brancos}
                nullVotes={data.nulos + data.nulosTecnicos + data.pendentes}
                totalGeral={data.totalGeral}
                progressProcessed={p}
                progressTotal={e}
                progressPercent={e > 0 ? ((p / e) * 100).toFixed(2).replace('.', ',') : '0,00'}
                source="PARALELA"
                round={round}
                isMajoritario={isMajoritario(office)}
                expandedKey={expKey}
                isExpanded={!!expanded[expKey]}
                onToggleExpand={handleToggleExpand}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderTSE = () => {
    if (!tse) return <div className="p-8 text-center text-slate-500 font-bold uppercase tracking-widest">Carregando dados oficiais...</div>;
    
    if (tse.status === 'NOT_YET_AVAILABLE' || (tse.offices && tse.offices.length === 0)) {
      return (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-sm">
          <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-xl font-black text-slate-700 tracking-tight">Resultado oficial ainda não disponível</h2>
          <p className="text-slate-500 text-sm mt-2 font-medium">Os arquivos do TSE para o Turno {round} não foram publicados ou configurados.</p>
        </div>
      );
    }

    if (tse.status === 'TEMPORARILY_UNAVAILABLE') {
      return (
        <div className="bg-red-50 p-12 rounded-2xl border border-red-200 text-center shadow-sm">
          <AlertCircle className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <h2 className="text-xl font-black text-red-800 tracking-tight">TSE Temporariamente Indisponível</h2>
          <p className="text-red-600 text-sm mt-2 font-medium">Não foi possível conectar à base oficial no momento. Tente novamente em breve.</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-6">
        {tse.offices?.map((o: any) => {
          if (o.status !== 'AVAILABLE') return null;
          const expKey = `TSE:${round}:${o.cargoName}`;
          return (
            <OfficeResultCard
              key={o.cargoName}
              officeName={o.cargoName}
              candidates={o.candidates}
              validVotes={o.validVotes.quantity}
              blankVotes={o.blankVotes.quantity}
              nullVotes={o.nullVotes.quantity}
              totalGeral={o.validVotes.quantity + o.blankVotes.quantity + o.nullVotes.quantity}
              eligible={o.attendance.eligible}
              turnout={o.attendance.turnout}
              abstention={o.attendance.abstention}
              turnoutPercent={o.attendance.turnoutPercent}
              abstentionPercent={o.attendance.abstentionPercent}
              progressProcessed={o.progress.processed}
              progressTotal={o.progress.total}
              progressPercent={o.progress.percent}
              source="TSE"
              round={round}
              isMajoritario={isMajoritario(o.cargoName)}
              expandedKey={expKey}
              isExpanded={!!expanded[expKey]}
              onToggleExpand={handleToggleExpand}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20">
      <header className="bg-slate-900 text-white p-3 md:p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <Activity className="text-indigo-400 w-5 h-5" />
              Painel Eleitoral 2026
            </h1>
            <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-0.5 ml-7">
              {process.env.NEXT_PUBLIC_CITY_NAME || 'Concórdia'} / {process.env.NEXT_PUBLIC_STATE_CODE || 'SC'}
            </p>
          </div>
          <div className="flex gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700 self-start md:self-auto">
            <button 
              onClick={() => setRound(1)} 
              className={`px-4 py-1.5 rounded-md font-black text-xs transition-colors uppercase tracking-widest ${round === 1 ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              1º Turno
            </button>
            <button 
              onClick={() => setRound(2)} 
              className={`px-4 py-1.5 rounded-md font-black text-xs transition-colors uppercase tracking-widest ${round === 2 ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              2º Turno
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-3 md:p-5 mt-2">
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <button 
            onClick={() => setSource('PARALELA')}
            className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${source === 'PARALELA' ? 'border-indigo-600 bg-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300'}`}
          >
            <div className={`p-2 rounded-lg ${source === 'PARALELA' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
              <Archive className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className={`font-black uppercase tracking-widest text-sm ${source === 'PARALELA' ? 'text-slate-900' : ''}`}>Apuração Paralela</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fonte independente</div>
            </div>
          </button>
          <button 
            onClick={() => setSource('TSE')}
            className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${source === 'TSE' ? 'border-emerald-500 bg-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300'}`}
          >
            <div className={`p-2 rounded-lg ${source === 'TSE' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className={`font-black uppercase tracking-widest text-sm ${source === 'TSE' ? 'text-slate-900' : ''}`}>Resultado TSE</div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fonte governamental</div>
            </div>
          </button>
        </div>

        {loading && !paralela && !tse && (
          <div className="text-center p-12 text-slate-400 font-bold uppercase tracking-widest animate-pulse flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin" />
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
