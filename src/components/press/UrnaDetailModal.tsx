'use client';
import { useState, useEffect } from 'react';
import { UrnaDetailDTO } from '@/lib/presentation/pressDto';
import {
  X,
  Copy,
  Check,
  Radio,
  FileText,
  ShieldCheck,
  AlertTriangle,
  Building2,
  Users,
  Vote,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface UrnaDetailModalProps {
  reportId: string | null;
  onClose: () => void;
  teleprompterMode?: boolean;
}

export function UrnaDetailModal({ reportId, onClose }: UrnaDetailModalProps) {
  const [data, setData] = useState<UrnaDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'votos' | 'radio'>('votos');
  const [prompterExpanded, setPrompterExpanded] = useState(false);

  useEffect(() => {
    if (!reportId) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    fetch(`/api/urnas/${reportId}`)
      .then(res => {
        if (!res.ok) throw new Error('Não foi possível carregar os detalhes do boletim.');
        return res.json();
      })
      .then((detail: UrnaDetailDTO) => {
        if (mounted) {
          setData(detail);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (mounted) {
          setError(err.message || 'Erro ao carregar detalhes.');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [reportId]);

  // Tecla ESC fecha o modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!reportId) return null;

  const handleCopyRadio = async () => {
    if (!data?.radioScript) return;
    try {
      await navigator.clipboard.writeText(data.radioScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback para textarea selecionada
      const el = document.getElementById('radio-script-area') as HTMLTextAreaElement | null;
      if (el) {
        el.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto"
    >
      <div
        className={`bg-white text-slate-900 w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col transition-all duration-200 ${
          prompterExpanded ? 'max-w-6xl h-[92vh]' : 'max-w-4xl max-h-[90vh]'
        }`}
      >
        {/* Cabeçalho do Modal */}
        <div className="bg-slate-900 text-white p-4 md:px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="bg-amber-400 text-slate-950 p-2 rounded-xl">
              <Radio className="w-5 h-5" />
            </span>
            <div>
              <h3 id="modal-title" className="text-base md:text-lg font-black tracking-tight flex items-center gap-2">
                Boletim de Urna
                {data && (
                  <span className="text-xs bg-slate-800 text-amber-300 font-bold px-2 py-0.5 rounded-full">
                    Zona {data.territory.zoneCode} / Seção {data.territory.sectionCode}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">
                {data ? `${data.territory.cityName} (${data.territory.stateCode}) — ${data.context.round.roundNumber}º Turno` : 'Carregando...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'radio' && (
              <button
                onClick={() => setPrompterExpanded(!prompterExpanded)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                title={prompterExpanded ? 'Reduzir visualização' : 'Expandir modo leitura'}
              >
                {prompterExpanded ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Abas */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 md:px-6 pt-2 shrink-0">
          <button
            onClick={() => setActiveTab('votos')}
            className={`flex items-center gap-2 px-4 py-2.5 font-bold text-sm border-b-2 transition ${
              activeTab === 'votos'
                ? 'border-indigo-600 text-indigo-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Vote className="w-4 h-4" />
            Votos da Urna
          </button>
          <button
            onClick={() => setActiveTab('radio')}
            className={`flex items-center gap-2 px-4 py-2.5 font-bold text-sm border-b-2 transition ${
              activeTab === 'radio'
                ? 'border-indigo-600 text-indigo-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Radio className="w-4 h-4" />
            Locução para Rádio
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          {loading && (
            <div className="py-12 text-center text-slate-500 font-medium">
              <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              Carregando detalhamento completo da urna...
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {data && !loading && (
            <>
              {/* Painel Superior: Território e Autenticidade */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
                  <div className="text-xs uppercase font-bold text-slate-500 flex items-center gap-1.5 mb-1">
                    <Building2 className="w-3.5 h-3.5" />
                    Local de Votação
                  </div>
                  <div className="text-sm font-black text-slate-900">
                    {data.territory.locationName || 'Local não cadastrado'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Urna nº {data.territory.urnCode || 'S/N'}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
                  <div className="text-xs uppercase font-bold text-slate-500 flex items-center gap-1.5 mb-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Integridade do BU
                  </div>
                  <div className="text-sm font-black text-emerald-700 flex items-center gap-1">
                    {data.integrity.hashStatus === 'VERIFIED' ? 'SHA-512 Verificado' : 'Não Verificado'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {data.timing.timestampType === 'CONFIRMED'
                      ? `Confirmado às ${new Date(data.timing.displayTimestamp).toLocaleTimeString('pt-BR')}`
                      : `Recebido às ${new Date(data.timing.displayTimestamp).toLocaleTimeString('pt-BR')} (Estimado)`}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
                  <div className="text-xs uppercase font-bold text-slate-500 flex items-center gap-1.5 mb-1">
                    <Users className="w-3.5 h-3.5" />
                    Comparecimento
                  </div>
                  {data.attendance && data.attendance.available && data.attendance.apto ? (
                    <div>
                      <div className="text-sm font-black text-slate-900">
                        {data.attendance.comp} de {data.attendance.apto} ({data.attendance.turnoutPercent})
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Abstenção: {data.attendance.falt} ({data.attendance.abstentionPercent})
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic mt-1">
                      Dados de comparecimento não informados no QRBU.
                    </div>
                  )}
                </div>
              </div>

              {/* Conteúdo Aba Votos */}
              {activeTab === 'votos' && (
                <div className="space-y-6">
                  {data.offices.map(off => (
                    <div key={off.officeId} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                      <div className="bg-slate-100 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                        <span className="font-black text-sm text-slate-900 uppercase tracking-tight">
                          {off.officeName}
                        </span>
                        <span className="text-xs text-slate-600 font-bold">
                          {off.summary.validVotes} votos válidos (Total: {off.summary.totalVotes})
                        </span>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {off.candidates.map(cand => (
                          <div key={cand.candidateNumber} className="p-3 px-4 flex items-center justify-between hover:bg-slate-50/80 transition">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs font-black bg-slate-200 text-slate-800 px-2 py-0.5 rounded">
                                {cand.candidateNumber}
                              </span>
                              <div>
                                <span className="font-bold text-sm text-slate-900">{cand.ballotName}</span>
                                {cand.partyAbbreviation && (
                                  <span className="text-xs text-slate-500 ml-1.5">({cand.partyAbbreviation})</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-black text-sm text-slate-900">{cand.votes}</span>
                              <span className="text-xs text-slate-500 font-bold ml-2">({cand.percent})</span>
                            </div>
                          </div>
                        ))}

                        {off.parties.length > 0 && (
                          <div className="bg-slate-50 p-2.5 px-4 text-xs font-bold text-slate-600">
                            Votos de Legenda:
                            {off.parties.map(p => (
                              <span key={p.partyNumber} className="ml-2 font-mono">
                                {p.partyAbbreviation || p.partyNumber}: {p.votes} ({p.percent})
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="bg-slate-50/50 p-3 px-4 flex items-center justify-between text-xs text-slate-600 font-medium">
                          <span>Brancos: <strong className="text-slate-900">{off.summary.blankVotes}</strong></span>
                          <span>Nulos: <strong className="text-slate-900">{off.summary.nullVotes}</strong></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Conteúdo Aba Locução para Rádio */}
              {activeTab === 'radio' && (
                <div className="flex flex-col h-full space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      Script Pré-Formatado para Leitura Oral
                    </span>
                    <button
                      onClick={handleCopyRadio}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition ${
                        copied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
                      }`}
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copiado para o Rádio!' : 'Copiar Texto'}
                    </button>
                  </div>

                  <textarea
                    id="radio-script-area"
                    readOnly
                    value={data.radioScript}
                    className={`w-full p-4 font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-900 text-amber-300 leading-relaxed resize-none transition-all ${
                      prompterExpanded ? 'h-[70vh] text-lg' : 'h-80 text-sm'
                    }`}
                  />
                  <p className="text-[11px] text-slate-500 italic">
                    Dica: Você pode copiar o texto acima e colar diretamente no software de teleprompter da emissora de rádio.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="p-3 px-6 bg-slate-100 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500">
            Pressione <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono">ESC</kbd> para fechar
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
