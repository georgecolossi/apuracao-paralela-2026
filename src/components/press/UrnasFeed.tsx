'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { UrnaFeedItemDTO, UrnaFeedResponse } from '@/lib/presentation/pressDto';
import { UrnaDetailModal } from './UrnaDetailModal';
import {
  Search,
  RefreshCw,
  SlidersHorizontal,
  Building2,
  Clock,
  ShieldCheck,
  ChevronRight,
  Radio,
  FileText,
  AlertCircle,
  Eye,
  Sun,
  Moon,
  Copy,
  Check
} from 'lucide-react';

interface UrnasFeedProps {
  initialRound?: number;
  electionParam?: string;
}

export function UrnasFeed({ initialRound, electionParam }: UrnasFeedProps) {
  const [items, setItems] = useState<UrnaFeedItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<UrnaFeedResponse['context']>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Filtros
  const [round, setRound] = useState<number | undefined>(initialRound);
  const [zoneInput, setZoneInput] = useState('');
  const [sectionInput, setSectionInput] = useState('');
  const [appliedZone, setAppliedZone] = useState<string | null>(null);
  const [appliedSection, setAppliedSection] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);

  // Modos Visuais
  const [teleprompterMode, setTeleprompterMode] = useState(false);

  // Modal de Detalhe
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [quickCopiedId, setQuickCopiedId] = useState<string | null>(null);

  // Polling ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Função para buscar a primeira página ou atualizar o topo
  const fetchTopFeed = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (round) params.set('round', String(round));
      if (electionParam) params.set('election', electionParam);
      if (appliedZone) params.set('zone', appliedZone);
      if (appliedSection) params.set('section', appliedSection);
      params.set('limit', '20');

      const res = await fetch(`/api/urnas?${params.toString()}`);
      const data: UrnaFeedResponse = await res.json();

      if (!res.ok) {
        throw new Error((data as any).message || 'Erro ao consultar feed de urnas.');
      }

      setContext(data.context);
      setItems(data.items);
      setNextCursor(data.pagination.nextCursor);
      setHasMore(data.pagination.hasMore);
    } catch (err: any) {
      if (!isBackground) {
        setError(err.message || 'Falha na conexão com o servidor.');
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [round, electionParam, appliedZone, appliedSection]);

  // Função para carregar mais páginas via cursor
  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);

    try {
      const params = new URLSearchParams();
      if (round) params.set('round', String(round));
      if (electionParam) params.set('election', electionParam);
      if (appliedZone) params.set('zone', appliedZone);
      if (appliedSection) params.set('section', appliedSection);
      params.set('cursor', nextCursor);
      params.set('limit', '20');

      const res = await fetch(`/api/urnas?${params.toString()}`);
      const data: UrnaFeedResponse = await res.json();

      if (!res.ok) {
        throw new Error((data as any).message || 'Erro ao carregar mais urnas.');
      }

      // Concatena sem duplicar IDs
      setItems(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        const newItems = data.items.filter(i => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });

      setNextCursor(data.pagination.nextCursor);
      setHasMore(data.pagination.hasMore);
    } catch (err: any) {
      alert(err.message || 'Não foi possível carregar a próxima página.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Efeito de busca inicial e alteração de filtros
  useEffect(() => {
    fetchTopFeed();
  }, [fetchTopFeed]);

  // Efeito de Polling com Page Visibility API
  useEffect(() => {
    const startPolling = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(() => {
        if (!document.hidden) {
          fetchTopFeed(true);
        }
      }, 10000); // 10 segundos
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (pollingRef.current) clearInterval(pollingRef.current);
      } else {
        fetchTopFeed(true);
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchTopFeed]);

  // Submissão de Filtros
  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setFilterError(null);

    // Validação estrita antes de submeter
    if (zoneInput !== '' && !/^\d{1,4}$/.test(zoneInput)) {
      setFilterError('Zona eleitoral deve conter de 1 a 4 dígitos sem espaços.');
      return;
    }
    if (sectionInput !== '' && !/^\d{1,4}$/.test(sectionInput)) {
      setFilterError('Seção eleitoral deve conter de 1 a 4 dígitos sem espaços.');
      return;
    }

    setAppliedZone(zoneInput === '' ? null : zoneInput);
    setAppliedSection(sectionInput === '' ? null : sectionInput);
  };

  const handleClearFilters = () => {
    setZoneInput('');
    setSectionInput('');
    setFilterError(null);
    setAppliedZone(null);
    setAppliedSection(null);
  };

  const handleQuickCopy = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/urnas/${id}`);
      if (!res.ok) throw new Error();
      const detail = await res.json();
      if (detail.radioScript) {
        await navigator.clipboard.writeText(detail.radioScript);
        setQuickCopiedId(id);
        setTimeout(() => setQuickCopiedId(null), 2500);
      }
    } catch {
      setSelectedReportId(id);
    }
  };

  return (
    <div className={`transition-colors duration-200 ${teleprompterMode ? 'bg-slate-950 text-amber-200' : 'bg-slate-50 text-slate-900'}`}>
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-8 space-y-6">
        {/* Barra Superior de Controles e Teleprompter */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2.5">
              <span className="p-2 bg-amber-400 text-slate-950 rounded-xl">
                <Radio className="w-5 h-5" />
              </span>
              Últimas Urnas Apuradas
            </h1>
            <p className="text-xs md:text-sm text-slate-500 font-medium mt-0.5">
              {context?.election ? `${context.election.name} — ${context.round?.roundNumber || 1}º Turno` : 'Feed em Tempo Real para Imprensa e Rádios'}
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            {/* Seletor de Turno */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setRound(1)}
                className={`px-3 py-1.5 rounded-lg transition ${
                  round === 1 || (!round && context?.round?.roundNumber === 1)
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1º Turno
              </button>
              <button
                type="button"
                onClick={() => setRound(2)}
                className={`px-3 py-1.5 rounded-lg transition ${
                  round === 2 || context?.round?.roundNumber === 2
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                2º Turno
              </button>
            </div>

            {/* Alternar Modo Teleprompter */}
            <button
              type="button"
              onClick={() => setTeleprompterMode(!teleprompterMode)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition border ${
                teleprompterMode
                  ? 'bg-amber-400 text-slate-950 border-amber-500 shadow-sm'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
              title="Ativar/Desativar modo de alta legibilidade para estúdio"
            >
              {teleprompterMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span className="hidden md:inline">{teleprompterMode ? 'Modo Padrão' : 'Teleprompter'}</span>
            </button>

            {/* Atualizar */}
            <button
              type="button"
              onClick={() => fetchTopFeed(false)}
              disabled={loading}
              className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
              title="Atualizar feed agora"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Barra de Pesquisa e Filtros */}
        <form onSubmit={handleApplyFilters} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Filtrar por Zona (ex: 9 ou 0009)"
                value={zoneInput}
                onChange={e => {
                  setZoneInput(e.target.value);
                  setFilterError(null);
                }}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="relative flex-1 w-full">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                <SlidersHorizontal className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Filtrar por Seção (ex: 13 ou 0013)"
                value={sectionInput}
                onChange={e => {
                  setSectionInput(e.target.value);
                  setFilterError(null);
                }}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="submit"
                className="flex-1 sm:flex-initial px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition"
              >
                Filtrar
              </button>
              {(appliedZone || appliedSection || zoneInput || sectionInput) && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          {filterError && (
            <div className="text-xs text-red-600 font-bold flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {filterError}
            </div>
          )}

          {(appliedZone || appliedSection) && (
            <div className="flex items-center gap-2 pt-1 text-xs text-slate-600">
              <span className="font-bold text-slate-400">Filtros ativos:</span>
              {appliedZone && (
                <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                  Zona {appliedZone}
                </span>
              )}
              {appliedSection && (
                <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                  Seção {appliedSection}
                </span>
              )}
            </div>
          )}
        </form>

        {/* Indicador de Erro Geral */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
            <div>
              <strong className="block font-bold">Erro ao consultar boletins</strong>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Lista Cronológica de Boletins de Urna */}
        {loading && items.length === 0 ? (
          <div className="py-16 text-center text-slate-400 font-medium">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Buscando últimas urnas processadas...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center shadow-sm">
            <Radio className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-black text-slate-800 tracking-tight">Nenhuma urna encontrada</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Nenhum Boletim de Urna processado corresponde aos critérios selecionados ou a apuração deste turno ainda não iniciou.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => {
              const formattedDate = new Date(item.timing.displayTimestamp).toLocaleTimeString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedReportId(item.id)}
                  className={`group p-4 md:p-5 rounded-2xl border cursor-pointer transition-all duration-150 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm hover:shadow-md ${
                    teleprompterMode
                      ? 'bg-slate-900 border-slate-800 hover:border-amber-400/50'
                      : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50'
                  }`}
                >
                  {/* Bloco 1: Território e Local */}
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`p-3 rounded-xl shrink-0 transition ${
                        teleprompterMode ? 'bg-slate-800 text-amber-300' : 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100'
                      }`}
                    >
                      <Building2 className="w-5 h-5" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-base font-black tracking-tight ${teleprompterMode ? 'text-amber-200' : 'text-slate-900'}`}>
                          Zona {item.territory.zoneCode} — Seção {item.territory.sectionCode}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {item.territory.cityName} ({item.territory.stateCode})
                        </span>
                      </div>

                      <p className={`text-xs mt-1 ${teleprompterMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        {item.territory.locationName || 'Local de votação não cadastrado'}
                        {item.territory.urnCode && ` • Urna nº ${item.territory.urnCode}`}
                      </p>
                    </div>
                  </div>

                  {/* Bloco 2: Total de Votos, Horário e Botões */}
                  <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                    <div className="text-left md:text-right">
                      <div className={`text-sm font-black ${teleprompterMode ? 'text-amber-300' : 'text-slate-900'}`}>
                        {item.summary.totalVotes} votos apurados
                      </div>
                      <div className={`text-[11px] flex items-center md:justify-end gap-1 ${teleprompterMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Clock className="w-3 h-3" />
                        <span>{formattedDate}</span>
                        {item.timing.timestampType === 'RECEIVED_FALLBACK' && (
                          <span className="text-[10px] text-amber-600 font-bold">(Estimado)</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Botão Rápido Copiar Rádio */}
                      <button
                        type="button"
                        onClick={(e) => handleQuickCopy(item.id, e)}
                        className={`p-2.5 rounded-xl border transition ${
                          quickCopiedId === item.id
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : teleprompterMode
                            ? 'bg-slate-800 text-amber-300 border-slate-700 hover:bg-slate-700'
                            : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200'
                        }`}
                        title="Copiar texto de locução para rádio em 1 clique"
                      >
                        {quickCopiedId === item.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedReportId(item.id)}
                        className={`p-2.5 rounded-xl border transition ${
                          teleprompterMode
                            ? 'bg-amber-400 text-slate-950 border-amber-500 font-bold'
                            : 'bg-slate-900 text-white hover:bg-indigo-700 border-slate-900'
                        }`}
                        title="Ver votos e detalhes completos"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Botão de Paginação (Cursor Keyset) */}
        {hasMore && (
          <div className="text-center pt-4">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-6 py-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-black text-xs uppercase tracking-wider rounded-xl shadow-sm hover:shadow transition disabled:opacity-50"
            >
              {loadingMore ? 'Carregando mais urnas...' : 'Carregar Urnas Anteriores'}
            </button>
          </div>
        )}
      </div>

      {/* Modal de Detalhe Completo do Boletim */}
      <UrnaDetailModal
        reportId={selectedReportId}
        onClose={() => setSelectedReportId(null)}
        teleprompterMode={teleprompterMode}
      />
    </div>
  );
}
