'use client';
import { useEffect, useState, useMemo } from 'react';
import { Activity, Archive, ShieldCheck, AlertCircle, RefreshCw, ChevronDown, ChevronUp, Layers, CheckCircle2 } from 'lucide-react';
import { getOfficeDataAggregate } from '@/lib/presentation/apuracaoHelper';

function OfficeResultCard({
  officeName,
  officeType,
  candidates,
  legendas,
  validVotes,
  validNominais,
  validLegenda,
  blankVotes,
  nullVotes,
  totalGeral,
  eligible,
  turnout,
  abstention,
  turnoutPercent,
  abstentionPercent,
  attendance,
  progressProcessed,
  progressTotal,
  progressPercent,
  source,
  round,
  isMajoritario,
  isProvisional,
  projectionData,
  expandedKey,
  isExpanded,
  onToggleExpand
}: any) {
  // Ordena candidatos: maior quantidade de votos primeiro; desempate por número do candidato crescente
  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      const votesDiff = (b.quantity ?? b.votes ?? 0) - (a.quantity ?? a.votes ?? 0);
      if (votesDiff !== 0) return votesDiff;
      const numA = parseInt(a.candidateNumber ?? a.number, 10) || 0;
      const numB = parseInt(b.candidateNumber ?? b.number, 10) || 0;
      return numA - numB;
    });
  }, [candidates]);

  const INITIAL_LIMIT = 6;
  const showExpandControl = sortedCandidates.length > INITIAL_LIMIT;
  const displayedCandidates = isExpanded ? sortedCandidates : sortedCandidates.slice(0, INITIAL_LIMIT);

  // Projeção matemática: somente para cargos majoritários e com condições atendidas
  const hasProjection = Boolean(
    source === 'PARALELA' &&
    isMajoritario &&
    projectionData?.hasProjection &&
    progressProcessed >= 1 &&
    progressTotal > 0
  );

  const totalApurados = validVotes + blankVotes + nullVotes;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
      {/* Cabeçalho do Cargo */}
      <div className="bg-slate-50 border-b border-slate-200 p-3 md:px-5 flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h3 className="font-black text-slate-800 uppercase tracking-widest text-base md:text-lg">
            {officeName}
          </h3>
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
            isMajoritario ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'
          }`}>
            {isMajoritario ? 'Majoritário' : 'Proporcional'}
          </span>
        </div>

        <div className={`px-3 py-1.5 rounded-lg border text-right ${
          source === 'PARALELA' ? 'bg-indigo-50 border-indigo-100 text-indigo-900' : 'bg-emerald-50 border-emerald-100 text-emerald-900'
        }`}>
          {isProvisional ? (
            <div>
              <div className="text-sm font-black text-indigo-950">
                {progressProcessed.toLocaleString('pt-BR')} urnas apuradas
              </div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-amber-700 mt-0.5">
                Regime provisório dinâmico
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm font-black">
                {progressProcessed.toLocaleString('pt-BR')} / {progressTotal.toLocaleString('pt-BR')} {source === 'TSE' ? 'seções' : 'urnas'}
              </div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-right mt-0.5 opacity-80">
                {progressPercent}% apurado
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Alerta de Urnas Zeradas no Cargo */}
      {source === 'PARALELA' && progressProcessed === 0 && (
        <div className="bg-slate-50 border-b border-slate-200 px-3 md:px-5 py-2.5 text-xs font-semibold text-slate-600 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
          <span>Apuração aguardando confirmação dos primeiros Boletins de Urna para este cargo. Candidatos exibidos desde zero votos.</span>
        </div>
      )}

      {/* Tabela de Candidatos */}
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[500px]">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-100">
              <th className="p-3 px-5 text-xs font-bold uppercase text-slate-500 tracking-wider">Candidato</th>
              <th className="p-3 px-5 text-xs font-bold uppercase text-slate-500 tracking-wider text-right w-28">Votos</th>
              <th className="p-3 px-5 text-xs font-bold uppercase text-slate-500 tracking-wider text-right w-28">% Válidos</th>
              {hasProjection && (
                <th className="p-3 px-5 text-xs font-bold uppercase text-indigo-600 tracking-wider text-right w-36">
                  Projeção*
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {displayedCandidates.map((c: any) => {
              const v = c.quantity ?? c.votes ?? 0;
              const num = c.candidateNumber ?? c.number;
              const name = c.candidateName ?? c.name;
              const party = c.partyAbbreviation || (c.partyNumber ? 'Partido ' + c.partyNumber : '');

              const pct = typeof c.percent === 'string'
                ? c.percent
                : (validVotes > 0 ? ((v / validVotes) * 100).toFixed(2).replace('.', ',') : '0,00');

              const candidateProj = hasProjection && projectionData?.candidates?.find(
                (p: any) => String(p.candidateNumber) === String(num)
              );

              return (
                <tr key={num} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 px-5">
                    <div className="font-black text-slate-800 text-base">{name || 'Não identificado'}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">
                      {party ? `${party} - ` : ''}{num}
                    </div>
                  </td>
                  <td className="p-3 px-5 text-right font-black text-slate-700 text-lg">
                    {v.toLocaleString('pt-BR')}
                  </td>
                  <td className="p-3 px-5 text-right font-black text-slate-600 text-lg">
                    {pct}%
                  </td>
                  {hasProjection && (
                    <td className="p-3 px-5 text-right font-black text-indigo-600 text-lg bg-indigo-50/30">
                      ≈ {(candidateProj?.projectedVotes ?? Math.round(v * (progressTotal / progressProcessed))).toLocaleString('pt-BR')}
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

      {/* Votos de Legenda (apenas para cargos proporcionais com legenda registrada) */}
      {!isMajoritario && legendas && legendas.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/40 p-3 md:px-5">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            Votos de Legenda Partidária (Válidos):
          </div>
          <div className="flex flex-wrap gap-2">
            {legendas.map((l: any) => (
              <span key={l.partyNumber} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 shadow-2xs">
                <strong>{l.partyAbbreviation || `Partido ${l.partyNumber}`}:</strong> {l.quantity.toLocaleString('pt-BR')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rodapé com Totalizadores e Comparecimento */}
      <div className="bg-slate-50/80 p-3 md:px-5 border-t border-slate-100 flex flex-col gap-3 flex-1 justify-end">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Votos Válidos:</span>
            <span className="font-black text-slate-800 text-sm">{validVotes.toLocaleString('pt-BR')}</span>
            {!isMajoritario && validLegenda > 0 && (
              <span className="text-slate-500 text-[10px]">
                (Nominais: {validNominais.toLocaleString('pt-BR')} | Legenda: {validLegenda.toLocaleString('pt-BR')})
              </span>
            )}
            {totalApurados > 0 ? (
              <span className="text-slate-400 font-bold text-[10px]">
                ({((validVotes / totalApurados) * 100).toFixed(2).replace('.', ',')}%)
              </span>
            ) : (
              <span className="text-slate-400 font-bold text-[10px]">(0,00%)</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Brancos:</span>
            <span className="font-black text-slate-800 text-sm">{blankVotes.toLocaleString('pt-BR')}</span>
            {totalApurados > 0 ? (
              <span className="text-slate-400 font-bold text-[10px]">
                ({((blankVotes / totalApurados) * 100).toFixed(2).replace('.', ',')}%)
              </span>
            ) : (
              <span className="text-slate-400 font-bold text-[10px]">(0,00%)</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Nulos:</span>
            <span className="font-black text-slate-800 text-sm">{nullVotes.toLocaleString('pt-BR')}</span>
            {totalApurados > 0 ? (
              <span className="text-slate-400 font-bold text-[10px]">
                ({((nullVotes / totalApurados) * 100).toFixed(2).replace('.', ',')}%)
              </span>
            ) : (
              <span className="text-slate-400 font-bold text-[10px]">(0,00%)</span>
            )}
          </div>
        </div>
        
        <div className="h-px bg-slate-200 w-full" />

        {/* Comparecimento e Abstenção */}
        {source === 'TSE' ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Aptos:</span>
              <span className="font-black text-slate-800 text-sm">{eligible ? eligible.toLocaleString('pt-BR') : '0'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Comparecimento:</span>
              <span className="font-black text-slate-800 text-sm">{turnout ? turnout.toLocaleString('pt-BR') : '0'}</span>
              <span className="text-slate-400 font-bold text-[10px]">({turnoutPercent ?? '0,00'}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Abstenção:</span>
              <span className="font-black text-slate-800 text-sm">{abstention ? abstention.toLocaleString('pt-BR') : '0'}</span>
              <span className="text-slate-400 font-bold text-[10px]">({abstentionPercent ?? '0,00'}%)</span>
            </div>
          </div>
        ) : (
          attendance && attendance.available && attendance.eligible > 0 ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Eleitores Aptos:</span>
                <span className="font-black text-slate-800 text-sm">{attendance.eligible.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Comparecimento:</span>
                <span className="font-black text-slate-800 text-sm">{attendance.turnout.toLocaleString('pt-BR')}</span>
                <span className="text-slate-400 font-bold text-[10px]">({attendance.turnoutPercent}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Abstenções:</span>
                <span className="font-black text-slate-800 text-sm">{attendance.abstention.toLocaleString('pt-BR')}</span>
                <span className="text-slate-400 font-bold text-[10px]">({attendance.abstentionPercent}%)</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider">Comparecimento / Abstenções:</span>
                <span className="font-medium text-slate-400 text-xs italic">Aguardando dados oficiais dos BUs processados</span>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default function ApuracaoDashboard() {
  const [source, setSource] = useState<'PARALELA' | 'TSE'>('PARALELA');
  const [round, setRound] = useState<number>(1);
  const [roundInitialized, setRoundInitialized] = useState<boolean>(false);
  const [electionParam, setElectionParam] = useState<string>('');
  const [paralela, setParalela] = useState<any>(null);
  const [tse, setTse] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const handleToggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Inicializa parâmetros a partir da URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      const r = search.get('round');
      const el = search.get('election') || search.get('electionId') || search.get('slug') || '';
      if (r) {
        setRound(parseInt(r, 10) || 1);
        setRoundInitialized(true);
      }
      if (el) {
        setElectionParam(el);
      }
    }
  }, []);

  // Busca dados periódicos sem cache indevido
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const fetchData = async () => {
      try {
        const queryParams = new URLSearchParams();
        if (round) queryParams.set('round', String(round));
        if (electionParam) queryParams.set('election', electionParam);

        const qs = queryParams.toString();
        const [pRes, tRes] = await Promise.all([
          fetch(`/api/totals?${qs}`, { cache: 'no-store' }),
          fetch(`/api/tse-results?${qs}`, { cache: 'no-store' }).catch(() => null)
        ]);

        const pData = pRes.ok ? await pRes.json() : null;
        const tData = tRes && tRes.ok ? await tRes.json() : null;

        if (mounted) {
          if (pData) {
            setParalela(pData);
            // Se o turno não foi explicitamente fixado na URL, sincroniza com o turno retornado pela API
            if (!roundInitialized && pData.round?.roundNumber) {
              setRound(pData.round.roundNumber);
              setRoundInitialized(true);
            }
          }
          if (tData) setTse(tData);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [round, electionParam, roundInitialized]);

  // Lista dinâmica de cargos
  const officesList = useMemo(() => {
    if (paralela?.offices && Array.isArray(paralela.offices) && paralela.offices.length > 0) {
      return paralela.offices;
    }
    // Fallback: deriva cargos dos totais
    if (paralela?.totals && Array.isArray(paralela.totals)) {
      const uniqueNames = Array.from(new Set(paralela.totals.map((t: any) => t.officeName))).filter(Boolean);
      return uniqueNames.map((name: any) => ({
        id: name,
        name,
        code: '',
        type: ['Presidente', 'Governador', 'Senador', 'Prefeito'].includes(name) ? 'MAJORITARIO' : 'PROPORCIONAL'
      }));
    }
    return [];
  }, [paralela]);

  // Localização geográfica do escopo
  const locationLabel = useMemo(() => {
    const scope = paralela?.election?.scope;
    if (scope?.municipality?.name) {
      return `${scope.municipality.name} / ${scope.state?.uf || ''}`;
    }
    if (scope?.state?.name) {
      return `${scope.state.name} (${scope.state.uf}) — Âmbito Estadual`;
    }
    if (scope?.type === 'NACIONAL') {
      return 'Brasil — Âmbito Nacional';
    }
    return `${process.env.NEXT_PUBLIC_CITY_NAME || 'Eleição Municipal / Geral'} / ${process.env.NEXT_PUBLIC_STATE_CODE || 'BR'}`;
  }, [paralela]);

  const renderParalela = () => {
    if (!paralela || !paralela.totals) {
      return (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-sm">
          <Archive className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-xl font-black text-slate-700 tracking-tight">Sem dados eleitorais locais</h2>
          <p className="text-slate-500 text-sm mt-2 font-medium">Nenhum dado ou configuração encontrado para esta consulta.</p>
        </div>
      );
    }

    const p = paralela.processedReports || 0;
    const e = paralela.expectedReports || 0;
    const isProvisional = Boolean(paralela.isProvisional);
    const hasProjection = Boolean(paralela.projections && Object.values(paralela.projections).some((proj: any) => proj?.hasProjection));

    return (
      <div className="space-y-6">
        {/* Banner de Projeção Matemática Condicionada */}
        {hasProjection && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 p-4 rounded-xl text-sm flex gap-4 shadow-sm items-start">
            <AlertCircle className="w-5 h-5 shrink-0 text-indigo-600 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="block text-indigo-950 tracking-wide text-xs uppercase font-black">
                PROJEÇÃO MATEMÁTICA COM BASE NAS URNAS APURADAS*
              </strong>
              <span className="text-[11px] opacity-90 block mt-0.5">
                Estimativa calculada proporcionalmente com base em {p} de {e} urnas apuradas ({e > 0 ? ((p / e) * 100).toFixed(1).replace('.', ',') : '0'}% da malha).
                Não representa resultado oficial do TSE nem declaração definitiva de vencedor. Válida exclusivamente para cargos majoritários.
              </span>
            </div>
          </div>
        )}

        {/* Banner de Cobertura Provisória */}
        {isProvisional && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-xl text-sm flex gap-4 shadow-sm items-start">
            <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="block text-amber-950 tracking-wide text-xs uppercase font-black">
                COBERTURA EM REGIME PROVISÓRIO DINÂMICO
              </strong>
              <span className="text-[11px] opacity-90 block mt-0.5">
                Seções eleitorais cadastradas dinamicamente via coleta presencial de QRBUs ({paralela.dynamicallyRegisteredSections || p} seções recebidas). Total oficial esperado aguarda homologação da malha territorial.
              </span>
            </div>
          </div>
        )}

        {/* Lista de Cargos */}
        <div className="grid grid-cols-1 gap-6">
          {officesList.map((office: any) => {
            const officeName = office.name;
            const isMajoritario = office.type === 'MAJORITARIO';
            const data = getOfficeDataAggregate(paralela.election?.plei, round, officeName, paralela.totals);
            const expKey = `PARALELA:${round}:${officeName}`;
            const officeProjection = paralela.projections?.[officeName];

            return (
              <OfficeResultCard
                key={officeName}
                officeName={officeName}
                officeType={office.type}
                candidates={data.candidates}
                legendas={data.legendas}
                validVotes={data.totalValidos}
                validNominais={data.validosNominais || 0}
                validLegenda={data.validosLegenda || 0}
                blankVotes={data.brancos}
                nullVotes={data.nulos + data.nulosTecnicos + data.pendentes}
                totalGeral={data.totalGeral}
                attendance={paralela.attendance}
                progressProcessed={p}
                progressTotal={e}
                progressPercent={e > 0 ? ((p / e) * 100).toFixed(2).replace('.', ',') : '0,00'}
                source="PARALELA"
                round={round}
                isMajoritario={isMajoritario}
                isProvisional={isProvisional}
                projectionData={officeProjection}
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
    if (!tse) {
      return (
        <div className="p-8 text-center text-slate-500 font-bold uppercase tracking-widest">
          Carregando dados oficiais do TSE...
        </div>
      );
    }
    
    if (tse.status === 'NOT_YET_AVAILABLE' || (tse.offices && tse.offices.length === 0)) {
      return (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-sm">
          <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-xl font-black text-slate-700 tracking-tight">Resultado oficial ainda não disponível</h2>
          <p className="text-slate-500 text-sm mt-2 font-medium">Os arquivos do TSE para esta consulta não foram publicados ou sincronizados.</p>
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
              officeType="MAJORITARIO"
              candidates={o.candidates}
              legendas={[]}
              validVotes={o.validVotes.quantity}
              validNominais={o.validVotes.quantity}
              validLegenda={0}
              blankVotes={o.blankVotes.quantity}
              nullVotes={o.nullVotes.quantity}
              totalGeral={o.validVotes.quantity + o.blankVotes.quantity + o.nullVotes.quantity}
              eligible={o.attendance?.eligible}
              turnout={o.attendance?.turnout}
              abstention={o.attendance?.abstention}
              turnoutPercent={o.attendance?.turnoutPercent}
              abstentionPercent={o.attendance?.abstentionPercent}
              progressProcessed={o.progress?.processed || 0}
              progressTotal={o.progress?.total || 0}
              progressPercent={o.progress?.percent || '0,00'}
              source="TSE"
              round={round}
              isMajoritario={true}
              expandedKey={expKey}
              isExpanded={!!expanded[expKey]}
              onToggleExpand={handleToggleExpand}
            />
          );
        })}
      </div>
    );
  };

  // Turnos disponíveis na eleição
  const rounds = paralela?.election?.rounds || [
    { roundNumber: 1, status: 'PLANNED' },
    { roundNumber: 2, status: 'PLANNED' }
  ];

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20">
      {/* Header Fixo */}
      <header className="bg-slate-900 text-white p-3 md:p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <Activity className="text-indigo-400 w-5 h-5 shrink-0" />
              {paralela?.election?.name || 'Painel de Apuração Paralela'}
            </h1>
            <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-0.5 ml-7">
              {locationLabel}
            </p>
          </div>

          {/* Seletor Dinâmico de Turnos */}
          <div className="flex gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700 self-start md:self-auto">
            {rounds.map((r: any) => (
              <button 
                key={r.roundNumber}
                onClick={() => setRound(r.roundNumber)} 
                className={`px-4 py-1.5 rounded-md font-black text-xs transition-colors uppercase tracking-widest flex items-center gap-1.5 ${
                  round === r.roundNumber ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>{r.roundNumber}º Turno</span>
                {r.status === 'ACTIVE' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Turno Ativo" />
                )}
                {r.status === 'FINISHED' && (
                  <span title="Turno Encerrado"><CheckCircle2 className="w-3 h-3 text-slate-400" /></span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-4xl mx-auto p-3 md:p-5 mt-2">
        {/* Toggle Apuração Paralela vs TSE */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <button 
            onClick={() => setSource('PARALELA')}
            className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
              source === 'PARALELA' ? 'border-indigo-600 bg-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300'
            }`}
          >
            <div className={`p-2 rounded-lg ${source === 'PARALELA' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
              <Archive className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className={`font-black uppercase tracking-widest text-sm ${source === 'PARALELA' ? 'text-slate-900' : ''}`}>
                Apuração Paralela
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Auditoria Cidadã Independente
              </div>
            </div>
          </button>

          <button 
            onClick={() => setSource('TSE')}
            className={`flex-1 p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
              source === 'TSE' ? 'border-emerald-500 bg-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300'
            }`}
          >
            <div className={`p-2 rounded-lg ${source === 'TSE' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className={`font-black uppercase tracking-widest text-sm ${source === 'TSE' ? 'text-slate-900' : ''}`}>
                Resultado TSE
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Dados Oficiais Publicados
              </div>
            </div>
          </button>
        </div>

        {/* Loading Spinner */}
        {loading && !paralela && !tse && (
          <div className="text-center p-12 text-slate-400 font-bold uppercase tracking-widest animate-pulse flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin" />
            Carregando painel eleitoral...
          </div>
        )}

        {/* Painel Renderizado */}
        {(!loading || paralela || tse) && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {source === 'PARALELA' ? renderParalela() : renderTSE()}
          </div>
        )}
      </main>
    </div>
  );
}
