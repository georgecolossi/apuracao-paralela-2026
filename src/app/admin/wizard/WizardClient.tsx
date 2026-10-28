'use client';

import { useState, useEffect, useId } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Save,
  Play,
  Upload,
  Plus,
  Trash2,
  Building,
  Vote,
  Users,
  Layers,
  MapPin,
  Calendar,
  FileCheck,
  RefreshCw,
  Info,
  Clock,
  ShieldCheck
} from 'lucide-react';
import { validateAdminConfirmation, getConfirmationAliases } from '@/lib/normalization';

interface StateOption {
  id: string;
  name: string;
  abbreviation: string;
}

interface PartyOption {
  id: string;
  officialIdentifier: string;
  name: string;
  abbreviation: string;
}

interface DraftSummary {
  id: string;
  name: string;
  year: number;
  type: string;
  status: string;
  updatedAt: string;
  _count?: {
    rounds: number;
    offices: number;
    scopes: number;
  };
}

interface WizardState {
  electionId?: string;
  name: string;
  year: number;
  type: 'GENERAL' | 'MUNICIPAL' | 'SUPPLEMENTARY' | 'CONSULTA';
  description: string;
  plei: string;
  scopes: Array<{
    scopeType: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL';
    stateAbbreviation: string;
    municipalityOfficialCode: string;
    municipalityName: string;
  }>;
  rounds: Array<{
    roundNumber: number;
    plei: string;
    date: string;
  }>;
  offices: Array<{
    code: string;
    name: string;
    type: 'MAJORITARIO' | 'PROPORCIONAL';
    maxVotesPerVoter: number;
  }>;
  parties: Array<{
    officialIdentifier: string;
    name: string;
    abbreviation: string;
  }>;
  candidates: Array<{
    officeCode: string;
    candidateNumber: string;
    name: string;
    ballotName: string;
    partyNumber: string;
  }>;
  coverage: Array<{
    roundNumber?: number;
    municipalityOfficialCode: string;
    zoneNumber: string;
    sectionNumber: string;
    expectedBUs: number;
    isAggregated: boolean;
    aggregatedIntoSec: string;
  }>;
  operators: Array<{
    email: string;
    name: string;
    initialPassword?: string;
  }>;
}

const DEFAULT_STATE: WizardState = {
  name: '',
  year: new Date().getFullYear(),
  type: 'MUNICIPAL',
  description: '',
  plei: '',
  scopes: [
    {
      scopeType: 'MUNICIPAL',
      stateAbbreviation: 'SC',
      municipalityOfficialCode: '',
      municipalityName: ''
    }
  ],
  rounds: [
    { roundNumber: 1, plei: '', date: '' },
    { roundNumber: 2, plei: '', date: '' }
  ],
  offices: [
    { code: '11', name: 'Prefeito', type: 'MAJORITARIO', maxVotesPerVoter: 1 },
    { code: '13', name: 'Vereador', type: 'PROPORCIONAL', maxVotesPerVoter: 1 }
  ],
  parties: [],
  candidates: [],
  coverage: [],
  operators: []
};

const BRAZILIAN_UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

export default function WizardClient({ initialElectionId }: { initialElectionId?: string }) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [formData, setFormData] = useState<WizardState>(DEFAULT_STATE);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [activating, setActivating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal de ativação
  const [showActivateModal, setShowActivateModal] = useState<boolean>(false);
  const [confirmationInput, setConfirmationInput] = useState<string>('');
  const [allowDeactivateCurrent, setAllowDeactivateCurrent] = useState<boolean>(false);
  const [conflictActiveElection, setConflictActiveElection] = useState<{ activeElectionId: string; activeElectionName: string; activeElectionYear: number } | null>(null);

  // Importação externa
  const [importJsonText, setImportJsonText] = useState<string>('');
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<any>(null);

  // Obter CSRF Token e Carregar Metadados
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        // 1. Obter CSRF Token
        const csrfRes = await fetch('/api/csrf-token');
        if (csrfRes.ok) {
          const csrfData = await csrfRes.json();
          setCsrfToken(csrfData.csrfToken || '');
        }

        // 2. Carregar metadados do wizard
        const url = initialElectionId
          ? `/api/admin/wizard?electionId=${encodeURIComponent(initialElectionId)}`
          : '/api/admin/wizard';

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setDrafts(data.drafts || []);

          if (data.election) {
            const el = data.election;
            setFormData({
              electionId: el.id,
              name: el.name || '',
              year: el.year || new Date().getFullYear(),
              type: el.type || 'MUNICIPAL',
              description: el.description || '',
              plei: el.plei || '',
              scopes: (el.scopes || []).map((s: any) => ({
                scopeType: s.scopeType,
                stateAbbreviation: s.state?.abbreviation || 'SC',
                municipalityOfficialCode: s.municipality?.officialCode || '',
                municipalityName: s.municipality?.name || ''
              })),
              rounds: (el.rounds || []).map((r: any) => ({
                roundNumber: r.roundNumber,
                plei: r.plei || '',
                date: r.date ? r.date.split('T')[0] : ''
              })),
              offices: (el.offices || []).map((o: any) => ({
                code: o.code,
                name: o.name,
                type: o.type,
                maxVotesPerVoter: o.maxVotesPerVoter || 1
              })),
              parties: [],
              candidates: (el.offices || []).flatMap((o: any) =>
                (o.candidates || []).map((c: any) => ({
                  officeCode: o.code,
                  candidateNumber: c.candidateNumber,
                  name: c.name,
                  ballotName: c.ballotName,
                  partyNumber: c.party?.officialIdentifier || ''
                }))
              ),
              coverage: (el.rounds?.[0]?.coverage || []).map((cov: any) => ({
                municipalityOfficialCode: cov.pollingSection?.zone?.municipality?.officialCode || '',
                zoneNumber: cov.pollingSection?.zone?.zoneNumber || '',
                sectionNumber: cov.pollingSection?.sectionNumber || '',
                expectedBUs: cov.expectedBUs || 1,
                isAggregated: cov.pollingSection?.isAggregated || false,
                aggregatedIntoSec: cov.pollingSection?.aggregatedIntoSec || ''
              })),
              operators: []
            });
          }
        }
      } catch (err: any) {
        setErrorMsg('Erro ao carregar dados do assistente: ' + err.message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [initialElectionId]);

  // Carregar rascunho selecionado
  const handleLoadDraft = async (draftId: string) => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/admin/wizard?electionId=${encodeURIComponent(draftId)}`);
      if (!res.ok) throw new Error('Não foi possível carregar o rascunho.');
      const data = await res.json();
      if (data.election) {
        const el = data.election;
        setFormData({
          electionId: el.id,
          name: el.name || '',
          year: el.year || new Date().getFullYear(),
          type: el.type || 'MUNICIPAL',
          description: el.description || '',
          plei: el.plei || '',
          scopes: (el.scopes || []).map((s: any) => ({
            scopeType: s.scopeType,
            stateAbbreviation: s.state?.abbreviation || 'SC',
            municipalityOfficialCode: s.municipality?.officialCode || '',
            municipalityName: s.municipality?.name || ''
          })),
          rounds: (el.rounds || []).map((r: any) => ({
            roundNumber: r.roundNumber,
            plei: r.plei || '',
            date: r.date ? r.date.split('T')[0] : ''
          })),
          offices: (el.offices || []).map((o: any) => ({
            code: o.code,
            name: o.name,
            type: o.type,
            maxVotesPerVoter: o.maxVotesPerVoter || 1
          })),
          parties: [],
          candidates: (el.offices || []).flatMap((o: any) =>
            (o.candidates || []).map((c: any) => ({
              officeCode: o.code,
              candidateNumber: c.candidateNumber,
              name: c.name,
              ballotName: c.ballotName,
              partyNumber: c.party?.officialIdentifier || ''
            }))
          ),
          coverage: (el.rounds?.[0]?.coverage || []).map((cov: any) => ({
            municipalityOfficialCode: cov.pollingSection?.zone?.municipality?.officialCode || '',
            zoneNumber: cov.pollingSection?.zone?.zoneNumber || '',
            sectionNumber: cov.pollingSection?.sectionNumber || '',
            expectedBUs: cov.expectedBUs || 1,
            isAggregated: cov.pollingSection?.isAggregated || false,
            aggregatedIntoSec: cov.pollingSection?.aggregatedIntoSec || ''
          })),
          operators: []
        });
        setSuccessMsg(`Rascunho "${el.name}" carregado com sucesso.`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao carregar rascunho.');
    } finally {
      setLoading(false);
    }
  };

  // Salvar Rascunho
  const handleSave = async (status: string = 'DRAFT') => {
    try {
      setSaving(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const res = await fetch('/api/admin/wizard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          ...formData,
          status
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Erro ao salvar eleição.');
      }

      setFormData(prev => ({ ...prev, electionId: data.electionId }));
      setSuccessMsg(data.message || 'Dados gravados com sucesso!');

      // Atualizar lista de rascunhos
      const reloadDrafts = await fetch('/api/admin/wizard');
      if (reloadDrafts.ok) {
        const d = await reloadDrafts.json();
        setDrafts(d.drafts || []);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao salvar configuração.');
    } finally {
      setSaving(false);
    }
  };

  // Ativar Eleição
  const handleActivate = async () => {
    if (!formData.electionId) {
      setErrorMsg('Salve o rascunho da eleição antes de ativá-la.');
      return;
    }

    try {
      setActivating(true);
      setErrorMsg(null);

      const res = await fetch('/api/admin/wizard/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          electionId: formData.electionId,
          confirmationText: confirmationInput,
          allowDeactivateCurrent
        })
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'ACTIVE_ELECTION_CONFLICT') {
          setConflictActiveElection(data.details);
          throw new Error(data.message);
        }
        throw new Error(data.message || data.error || 'Erro ao ativar a eleição.');
      }

      setShowActivateModal(false);
      setSuccessMsg(data.message || 'Eleição ativada com sucesso!');
      setTimeout(() => {
        router.push('/admin');
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha na ativação da eleição.');
    } finally {
      setActivating(false);
    }
  };

  // Processar importação externa
  const handleImportJson = async () => {
    try {
      setImportLoading(true);
      setErrorMsg(null);

      let parsed;
      try {
        parsed = JSON.parse(importJsonText);
      } catch {
        throw new Error('O conteúdo informado não é um JSON válido.');
      }

      const res = await fetch('/api/admin/wizard/import-tse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(parsed)
      });

      const result = await res.json();
      if (!res.ok || !result.valid) {
        throw new Error(result.errors?.[0] || 'O arquivo fornecido não é compatível com os formatos aceitos.');
      }

      setImportResult(result);
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao processar arquivo.');
    } finally {
      setImportLoading(false);
    }
  };

  // Aplicar dados da importação no formulário
  const applyImportedData = () => {
    if (!importResult?.data) return;

    const d = importResult.data;
    setFormData(prev => ({
      ...prev,
      name: d.election?.name || prev.name,
      year: d.election?.year || prev.year,
      type: d.election?.type || prev.type,
      plei: d.election?.plei || prev.plei,
      offices: d.offices?.length ? d.offices : prev.offices,
      parties: d.parties?.length ? d.parties : prev.parties,
      candidates: d.candidates?.length ? d.candidates : prev.candidates,
      rounds: d.rounds?.length ? d.rounds : prev.rounds,
      coverage: d.coverage?.length ? d.coverage : prev.coverage,
      scopes: d.scopes?.length ? d.scopes : prev.scopes
    }));

    setSuccessMsg('Dados importados com sucesso! Revise os campos nas abas correspondentes.');
    setImportResult(null);
    setImportJsonText('');
  };

  // Passos do Wizard
  const steps = [
    { num: 1, title: 'Identificação & Tipo', icon: Building },
    { num: 2, title: 'Abrangência Geográfica', icon: MapPin },
    { num: 3, title: 'Turnos & Cargos', icon: Vote },
    { num: 4, title: 'Candidatos & Partidos', icon: Users },
    { num: 5, title: 'Malha & Cobertura', icon: Layers },
    { num: 6, title: 'Operadores de Campo', icon: ShieldCheck },
    { num: 7, title: 'Revisão & Ativação', icon: FileCheck }
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border border-slate-200">
        <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
        <p className="text-slate-600 font-medium">Carregando parâmetros do assistente de configuração...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      {/* Header & Seletor de Rascunho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-wider mb-1">
            <Sparkles className="w-4 h-4" />
            Assistente Universal de Configuração 2.0
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            {formData.electionId ? `Editando: ${formData.name || 'Nova Eleição'}` : 'Cadastrar Nova Eleição'}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Configure pleitos municipais, gerais ou consultas populares sem editar código ou banco.
          </p>
        </div>

        {drafts.length > 0 && (
          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
            <Clock className="w-4 h-4 text-slate-500 ml-2" />
            <select
              aria-label="Selecionar rascunho salvo"
              className="bg-transparent text-sm font-semibold text-slate-700 outline-none pr-3"
              onChange={(e) => {
                if (e.target.value) handleLoadDraft(e.target.value);
              }}
              defaultValue=""
            >
              <option value="" disabled>Retomar rascunho anterior...</option>
              {drafts.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.year}) — {d.type}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{errorMsg}</div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{successMsg}</div>
        </div>
      )}

      {/* Barra de Progresso dos Passos */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between min-w-[640px]">
          {steps.map((st) => {
            const isActive = currentStep === st.num;
            const isCompleted = currentStep > st.num;
            const Icon = st.icon;

            return (
              <button
                key={st.num}
                type="button"
                onClick={() => setCurrentStep(st.num)}
                className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-2xl transition-all ${
                  isActive
                    ? 'text-indigo-600 font-bold'
                    : isCompleted
                    ? 'text-emerald-700 hover:text-slate-900'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                    : isCompleted
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-400'
                }`}>
                  {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
                </div>
                <span className="text-xs whitespace-nowrap">{st.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conteúdo do Passo Atual */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm">
        {/* PASSO 1: IDENTIFICAÇÃO E TIPO */}
        {currentStep === 1 && (
          <fieldset className="space-y-6">
            <legend className="text-lg font-black uppercase tracking-wide text-slate-800 mb-2">
              Passo 1: Tipo e Identificação do Pleito
            </legend>
            <p className="text-slate-500 text-sm mb-6">
              Defina a modalidade eleitoral e o ano de realização.
            </p>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Modalidade Eleitoral
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { id: 'MUNICIPAL', title: 'Municipal', desc: 'Prefeito e Vereadores' },
                  { id: 'GENERAL', title: 'Eleições Gerais', desc: 'Presidente, Gov., Deputados e Senadores' },
                  { id: 'SUPPLEMENTARY', title: 'Suplementar', desc: 'Nova eleição fora do calendário ordinário' },
                  { id: 'CONSULTA', title: 'Consulta Popular', desc: 'Plebiscito ou Referendo' }
                ].map((t) => {
                  const isSelected = formData.type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, type: t.id as any })}
                      className={`p-4 rounded-2xl border text-left transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-600/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <span className={`block font-bold text-sm ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
                        {t.title}
                      </span>
                      <span className="block text-xs text-slate-500 mt-1 leading-snug">
                        {t.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="election-name" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Nome Oficial do Pleito *
                </label>
                <input
                  id="election-name"
                  type="text"
                  required
                  placeholder="Ex.: Eleição Municipal 2024 - Florianópolis"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-sm"
                />
              </div>

              <div>
                <label htmlFor="election-year" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Ano da Eleição *
                </label>
                <input
                  id="election-year"
                  type="number"
                  required
                  min="1900"
                  max="2100"
                  value={formData.year}
                  onChange={(e) => setFormData({ ...formData, year: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="election-plei" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Código do Pleito TSE (Opcional)
                </label>
                <input
                  id="election-plei"
                  type="text"
                  placeholder="Ex.: 6258, 2110"
                  value={formData.plei}
                  onChange={(e) => setFormData({ ...formData, plei: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-sm"
                />
              </div>

              <div>
                <label htmlFor="election-desc" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Descrição / Notas Internas
                </label>
                <input
                  id="election-desc"
                  type="text"
                  placeholder="Ex.: Configuração piloto para apuração paralela"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-sm"
                />
              </div>
            </div>
          </fieldset>
        )}

        {/* PASSO 2: ABRANGÊNCIA GEOGRÁFICA */}
        {currentStep === 2 && (
          <fieldset className="space-y-6">
            <legend className="text-lg font-black uppercase tracking-wide text-slate-800 mb-2">
              Passo 2: Abrangência Geográfica e Municípios
            </legend>
            <p className="text-slate-500 text-sm mb-6">
              Defina a cobertura territorial da eleição. Suporta cobertura municipal única ou múltiplos municípios.
            </p>

            <div className="space-y-4">
              {formData.scopes.map((sc, idx) => (
                <div key={idx} className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Escopo #{idx + 1}
                    </span>
                    {formData.scopes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formData.scopes.filter((_, i) => i !== idx);
                          setFormData({ ...formData, scopes: updated });
                        }}
                        className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1 font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remover Escopo
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                        Tipo de Escopo
                      </label>
                      <select
                        value={sc.scopeType}
                        onChange={(e) => {
                          const updated = [...formData.scopes];
                          updated[idx].scopeType = e.target.value as any;
                          setFormData({ ...formData, scopes: updated });
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white"
                      >
                        <option value="MUNICIPAL">Municipal</option>
                        <option value="ESTADUAL">Estadual</option>
                        <option value="NACIONAL">Nacional (Brasil)</option>
                      </select>
                    </div>

                    {sc.scopeType !== 'NACIONAL' && (
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                          Estado (UF)
                        </label>
                        <select
                          value={sc.stateAbbreviation}
                          onChange={(e) => {
                            const updated = [...formData.scopes];
                            updated[idx].stateAbbreviation = e.target.value;
                            setFormData({ ...formData, scopes: updated });
                          }}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white"
                        >
                          {BRAZILIAN_UFS.map(uf => (
                            <option key={uf} value={uf}>{uf}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {sc.scopeType === 'MUNICIPAL' && (
                      <>
                        <div>
                          <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                            Código TSE Município *
                          </label>
                          <input
                            type="text"
                            placeholder="Ex.: 80837"
                            value={sc.municipalityOfficialCode}
                            onChange={(e) => {
                              const updated = [...formData.scopes];
                              updated[idx].municipalityOfficialCode = e.target.value;
                              setFormData({ ...formData, scopes: updated });
                            }}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                            Nome do Município
                          </label>
                          <input
                            type="text"
                            placeholder="Ex.: Florianópolis"
                            value={sc.municipalityName}
                            onChange={(e) => {
                              const updated = [...formData.scopes];
                              updated[idx].municipalityName = e.target.value;
                              setFormData({ ...formData, scopes: updated });
                            }}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  setFormData({
                    ...formData,
                    scopes: [
                      ...formData.scopes,
                      {
                        scopeType: 'MUNICIPAL',
                        stateAbbreviation: 'SC',
                        municipalityOfficialCode: '',
                        municipalityName: ''
                      }
                    ]
                  });
                }}
                className="flex items-center gap-2 text-sm font-bold text-indigo-600 hover:text-indigo-800 p-2"
              >
                <Plus className="w-4 h-4" />
                Adicionar Outro Município / Escopo
              </button>
            </div>
          </fieldset>
        )}

        {/* PASSO 3: TURNOS E CARGOS */}
        {currentStep === 3 && (
          <fieldset className="space-y-6">
            <legend className="text-lg font-black uppercase tracking-wide text-slate-800 mb-2">
              Passo 3: Turnos e Cargos em Disputa
            </legend>
            <p className="text-slate-500 text-sm mb-6">
              Configure se o pleito terá 1º e 2º turnos e quais cargos serão votados.
            </p>

            {/* Turnos */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Turnos</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {formData.rounds.map((r, idx) => (
                  <div key={r.roundNumber} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-800 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-indigo-600" />
                        {r.roundNumber}º Turno
                      </span>
                      {r.roundNumber === 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              rounds: formData.rounds.filter(rnd => rnd.roundNumber !== 2)
                            });
                          }}
                          className="text-xs text-red-600 font-semibold"
                        >
                          Remover 2º Turno
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="block text-slate-500 mb-1">Data de Realização</label>
                        <input
                          type="date"
                          value={r.date}
                          onChange={(e) => {
                            const updated = [...formData.rounds];
                            updated[idx].date = e.target.value;
                            setFormData({ ...formData, rounds: updated });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1">Código Pleito TSE</label>
                        <input
                          type="text"
                          placeholder="Ex: 6258"
                          value={r.plei}
                          onChange={(e) => {
                            const updated = [...formData.rounds];
                            updated[idx].plei = e.target.value;
                            setFormData({ ...formData, rounds: updated });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {formData.rounds.length === 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({
                        ...formData,
                        rounds: [
                          ...formData.rounds,
                          { roundNumber: 2, plei: '', date: '' }
                        ]
                      });
                    }}
                    className="p-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-indigo-400 text-slate-500 hover:text-indigo-600 flex flex-col items-center justify-center gap-1 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-xs font-bold uppercase">Habilitar 2º Turno</span>
                  </button>
                )}
              </div>
            </div>

            {/* Cargos */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Cargos Eletivos</h3>
                <button
                  type="button"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      offices: [
                        ...formData.offices,
                        { code: String(formData.offices.length + 1), name: '', type: 'MAJORITARIO', maxVotesPerVoter: 1 }
                      ]
                    });
                  }}
                  className="text-xs text-indigo-600 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Cargo
                </button>
              </div>

              <div className="space-y-3">
                {formData.offices.map((off, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-center gap-3">
                    <div className="w-full sm:w-24">
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Código TSE</label>
                      <input
                        type="text"
                        placeholder="Ex: 11"
                        value={off.code}
                        onChange={(e) => {
                          const updated = [...formData.offices];
                          updated[idx].code = e.target.value;
                          setFormData({ ...formData, offices: updated });
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium bg-white"
                      />
                    </div>

                    <div className="flex-1 w-full">
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Nome do Cargo</label>
                      <input
                        type="text"
                        placeholder="Ex: Prefeito, Vereador"
                        value={off.name}
                        onChange={(e) => {
                          const updated = [...formData.offices];
                          updated[idx].name = e.target.value;
                          setFormData({ ...formData, offices: updated });
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium bg-white"
                      />
                    </div>

                    <div className="w-full sm:w-36">
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Sistema</label>
                      <select
                        value={off.type}
                        onChange={(e) => {
                          const updated = [...formData.offices];
                          updated[idx].type = e.target.value as any;
                          setFormData({ ...formData, offices: updated });
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium bg-white"
                      >
                        <option value="MAJORITARIO">Majoritário</option>
                        <option value="PROPORCIONAL">Proporcional</option>
                      </select>
                    </div>

                    {formData.offices.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formData.offices.filter((_, i) => i !== idx);
                          setFormData({ ...formData, offices: updated });
                        }}
                        className="text-red-500 hover:text-red-700 p-2 sm:mt-4"
                        title="Remover Cargo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </fieldset>
        )}

        {/* PASSO 4: CANDIDATOS E PARTIDOS */}
        {currentStep === 4 && (
          <fieldset className="space-y-6">
            <legend className="text-lg font-black uppercase tracking-wide text-slate-800 mb-2">
              Passo 4: Catálogo de Candidatos e Partidos
            </legend>
            <p className="text-slate-500 text-sm mb-6">
              Insira os concorrentes manualmente ou faça a importação validada de arquivos JSON do TSE.
            </p>

            {/* Seletor de Modo: Manual ou Importação */}
            <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <span className="font-bold text-sm text-indigo-950 block">Deseja importar do TSE ou arquivo oficial?</span>
                <span className="text-xs text-indigo-700">Evite digitação manual carregando JSON de candidatos ou pleito.</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setImportResult(null)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50"
                >
                  Importar JSON
                </button>
              </div>
            </div>

            {/* Área de Importação */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <label className="block text-xs font-bold uppercase text-slate-700">
                Cole o conteúdo JSON oficial do TSE ou arquivo de configuração
              </label>
              <textarea
                rows={4}
                placeholder='Cole aqui o JSON (ex: {"candidatos": [{"nr": "13", "nm": "Candidato A", "cargo": "11"}]})'
                value={importJsonText}
                onChange={(e) => setImportJsonText(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  disabled={!importJsonText.trim() || importLoading}
                  onClick={handleImportJson}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"
                >
                  {importLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Validar Dados Externos
                </button>

                {importResult && (
                  <button
                    type="button"
                    onClick={applyImportedData}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aplicar {importResult.summary.candidatesCount} Candidatos Validados
                  </button>
                )}
              </div>

              {importResult && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Estrutura validada com sucesso ({importResult.format}):
                  </div>
                  <p>
                    {importResult.summary.officesCount} cargos, {importResult.summary.candidatesCount} candidatos, {importResult.summary.partiesCount} legendas partidárias detectadas.
                  </p>
                </div>
              )}
            </div>

            {/* Lista Manual de Candidatos */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Candidatos Cadastrados ({formData.candidates.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      candidates: [
                        ...formData.candidates,
                        {
                          officeCode: formData.offices[0]?.code || '11',
                          candidateNumber: '',
                          name: '',
                          ballotName: '',
                          partyNumber: ''
                        }
                      ]
                    });
                  }}
                  className="text-xs text-indigo-600 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Novo Candidato
                </button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {formData.candidates.map((cand, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-5 gap-2 items-center text-xs">
                    <div>
                      <label className="block text-[10px] text-slate-500">Cargo</label>
                      <select
                        value={cand.officeCode}
                        onChange={(e) => {
                          const updated = [...formData.candidates];
                          updated[idx].officeCode = e.target.value;
                          setFormData({ ...formData, candidates: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      >
                        {formData.offices.map(o => (
                          <option key={o.code} value={o.code}>{o.name} ({o.code})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">Número *</label>
                      <input
                        type="text"
                        placeholder="Ex: 13, 22"
                        value={cand.candidateNumber}
                        onChange={(e) => {
                          const updated = [...formData.candidates];
                          updated[idx].candidateNumber = e.target.value;
                          setFormData({ ...formData, candidates: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">Nome na Urna</label>
                      <input
                        type="text"
                        placeholder="Nome Urna"
                        value={cand.ballotName}
                        onChange={(e) => {
                          const updated = [...formData.candidates];
                          updated[idx].ballotName = e.target.value;
                          setFormData({ ...formData, candidates: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">Partido (Nº)</label>
                      <input
                        type="text"
                        placeholder="Ex: 13, 22"
                        value={cand.partyNumber}
                        onChange={(e) => {
                          const updated = [...formData.candidates];
                          updated[idx].partyNumber = e.target.value;
                          setFormData({ ...formData, candidates: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      />
                    </div>

                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formData.candidates.filter((_, i) => i !== idx);
                          setFormData({ ...formData, candidates: updated });
                        }}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </fieldset>
        )}

        {/* PASSO 5: MALHA E COBERTURA */}
        {currentStep === 5 && (
          <fieldset className="space-y-6">
            <legend className="text-lg font-black uppercase tracking-wide text-slate-800 mb-2">
              Passo 5: Malha de Seções Eleitorais e Cobertura Esperada
            </legend>
            <p className="text-slate-500 text-sm mb-4">
              Informe as seções onde haverá coleta de Boletins de Urna e defina seções agregadas.
            </p>

            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Nota de Integridade:</strong> O cadastro da malha define a expectativa de cobertura (status: <code>Cadastrada — validação pendente</code>). A homologação oficial requer verificação documental posterior.
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Seções Mapeadas ({formData.coverage.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const muniCode = formData.scopes[0]?.municipalityOfficialCode || '80837';
                    setFormData({
                      ...formData,
                      coverage: [
                        ...formData.coverage,
                        {
                          municipalityOfficialCode: muniCode,
                          zoneNumber: '1',
                          sectionNumber: String(formData.coverage.length + 1),
                          expectedBUs: 1,
                          isAggregated: false,
                          aggregatedIntoSec: ''
                        }
                      ]
                    });
                  }}
                  className="text-xs text-indigo-600 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Seção
                </button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {formData.coverage.map((sec, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-7 gap-2 items-center text-xs">
                    <div>
                      <label className="block text-[10px] text-slate-500">Muni. TSE</label>
                      <input
                        type="text"
                        value={sec.municipalityOfficialCode}
                        onChange={(e) => {
                          const updated = [...formData.coverage];
                          updated[idx].municipalityOfficialCode = e.target.value;
                          setFormData({ ...formData, coverage: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">Turno</label>
                      <select
                        value={sec.roundNumber ?? ''}
                        onChange={(e) => {
                          const updated = [...formData.coverage];
                          updated[idx].roundNumber = e.target.value ? Number(e.target.value) : undefined;
                          setFormData({ ...formData, coverage: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      >
                        <option value="">Ambos</option>
                        {formData.rounds.map(r => (
                          <option key={r.roundNumber} value={r.roundNumber}>{r.roundNumber}º Turno</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">Zona</label>
                      <input
                        type="text"
                        value={sec.zoneNumber}
                        onChange={(e) => {
                          const updated = [...formData.coverage];
                          updated[idx].zoneNumber = e.target.value;
                          setFormData({ ...formData, coverage: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">Seção</label>
                      <input
                        type="text"
                        value={sec.sectionNumber}
                        onChange={(e) => {
                          const updated = [...formData.coverage];
                          updated[idx].sectionNumber = e.target.value;
                          setFormData({ ...formData, coverage: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">Urnas</label>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        value={sec.expectedBUs}
                        onChange={(e) => {
                          const updated = [...formData.coverage];
                          updated[idx].expectedBUs = Number(e.target.value);
                          setFormData({ ...formData, coverage: updated });
                        }}
                        className="w-full px-2 py-1 rounded border bg-white"
                      />
                    </div>

                    <div className="flex items-center gap-1.5 mt-3 sm:mt-0">
                      <input
                        type="checkbox"
                        id={`agg-${idx}`}
                        checked={sec.isAggregated}
                        onChange={(e) => {
                          const updated = [...formData.coverage];
                          updated[idx].isAggregated = e.target.checked;
                          if (e.target.checked) updated[idx].expectedBUs = 0;
                          setFormData({ ...formData, coverage: updated });
                        }}
                      />
                      <label htmlFor={`agg-${idx}`} className="text-[11px] text-slate-600">Agregada</label>
                    </div>

                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formData.coverage.filter((_, i) => i !== idx);
                          setFormData({ ...formData, coverage: updated });
                        }}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </fieldset>
        )}

        {/* PASSO 6: OPERADORES DE CAMPO */}
        {currentStep === 6 && (
          <fieldset className="space-y-6">
            <legend className="text-lg font-black uppercase tracking-wide text-slate-800 mb-2">
              Passo 6: Operadores de Campo e Acesso ao Scanner
            </legend>
            <p className="text-slate-500 text-sm mb-6">
              Associe ou cadastre operadores (papel OPERATOR) autorizados a enviar Boletins de Urna para esta apuração.
            </p>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Operadores Vinculados ({formData.operators.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      operators: [
                        ...formData.operators,
                        { email: '', name: '' }
                      ]
                    });
                  }}
                  className="text-xs text-indigo-600 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Convidar Operador
                </button>
              </div>

              <div className="space-y-2">
                {formData.operators.map((op, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center gap-3 text-xs">
                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500">E-mail do Operador *</label>
                      <input
                        type="email"
                        placeholder="operador@exemplo.com"
                        value={op.email}
                        onChange={(e) => {
                          const updated = [...formData.operators];
                          updated[idx].email = e.target.value;
                          setFormData({ ...formData, operators: updated });
                        }}
                        className="w-full px-2 py-1.5 rounded border bg-white"
                      />
                    </div>

                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500">Nome de Identificação</label>
                      <input
                        type="text"
                        placeholder="Nome do Operador"
                        value={op.name}
                        onChange={(e) => {
                          const updated = [...formData.operators];
                          updated[idx].name = e.target.value;
                          setFormData({ ...formData, operators: updated });
                        }}
                        className="w-full px-2 py-1.5 rounded border bg-white"
                      />
                    </div>

                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500">Senha Inicial (Opcional - Mín. 8 caracteres)</label>
                      <input
                        type="password"
                        placeholder="Deixe vazio para conta inativa"
                        value={op.initialPassword || ''}
                        onChange={(e) => {
                          const updated = [...formData.operators];
                          updated[idx].initialPassword = e.target.value;
                          setFormData({ ...formData, operators: updated });
                        }}
                        className="w-full px-2 py-1.5 rounded border bg-white"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const updated = formData.operators.filter((_, i) => i !== idx);
                        setFormData({ ...formData, operators: updated });
                      }}
                      className="text-red-500 hover:text-red-700 p-1 self-end sm:self-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </fieldset>
        )}

        {/* PASSO 7: REVISÃO GERAL E ATIVAÇÃO */}
        {currentStep === 7 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-black uppercase tracking-wide text-slate-800 mb-1">
                Passo 7: Revisão Geral e Prontidão Operacional
              </h2>
              <p className="text-slate-500 text-sm">
                Confira os parâmetros cadastrados antes de salvar o rascunho ou ativar o pleito.
              </p>
            </div>

            {/* Checklist de Validação */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Eleição</span>
                <span className="font-bold text-slate-900 block truncate">{formData.name || 'Sem nome'}</span>
                <span className="text-xs text-slate-500">{formData.year} • {formData.type}</span>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Abrangência</span>
                <span className="font-bold text-slate-900 block">{formData.scopes.length} Escopo(s)</span>
                <span className="text-xs text-slate-500">{formData.scopes[0]?.scopeType || 'Nenhum'}</span>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Cargos & Candidatos</span>
                <span className="font-bold text-slate-900 block">{formData.offices.length} Cargos</span>
                <span className="text-xs text-slate-500">{formData.candidates.length} Candidatos</span>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Malha Eleitoral</span>
                <span className="font-bold text-slate-900 block">{formData.coverage.length} Seções</span>
                <span className="text-xs text-amber-700 font-semibold">Validação Pendente</span>
              </div>
            </div>

            {/* Alerta de Prontidão */}
            {(!formData.name || formData.scopes.length === 0 || formData.offices.length === 0) ? (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Preencha o nome da eleição, abrangência e cargos para poder ativá-la operacionalmente.</span>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Configuração consistente! A eleição pode ser ativada ou salva como rascunho.</span>
              </div>
            )}
          </div>
        )}

        {/* Rodapé de Ações de Navegação */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 mt-8 border-t border-slate-100">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={() => setCurrentStep(prev => prev - 1)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </button>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave('DRAFT')}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-2 transition-colors"
            >
              <Save className="w-4 h-4 text-slate-600" />
              {saving ? 'Gravando...' : 'Salvar Rascunho'}
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {currentStep < 7 ? (
              <button
                type="button"
                onClick={() => setCurrentStep(prev => prev + 1)}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition-colors"
              >
                Próximo Passo
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!formData.electionId || saving || activating}
                onClick={() => {
                  setConfirmationInput('');
                  setShowActivateModal(true);
                }}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-emerald-200 transition-colors"
              >
                <Play className="w-4 h-4" />
                Ativar Pleito Eleitoral
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Confirmação para Ativação Contextual */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-3xl p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Ativação Operacional de Eleição</h3>
                <p className="text-slate-500 text-xs mt-1">
                  Ao ativar, esta eleição e seu 1º Turno passarão ao status <code>ACTIVE</code>. Qualquer eleição anterior em andamento será finalizada contextualmente.
                </p>
              </div>
            </div>

            {conflictActiveElection && (
              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Conflito: Eleição Concorrente Ativa
                </div>
                <p>
                  A eleição <strong>"{conflictActiveElection.activeElectionName}" ({conflictActiveElection.activeElectionYear})</strong> está ativa no momento.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="allow-deactivate"
                    checked={allowDeactivateCurrent}
                    onChange={(e) => setAllowDeactivateCurrent(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="allow-deactivate" className="font-semibold text-slate-800 cursor-pointer">
                    Autorizo pausar/arquivar a eleição anterior para ativar esta
                  </label>
                </div>
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-2">
              <p>Para confirmar, digite exatamente a frase abaixo:</p>
              <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono text-center font-bold text-slate-900">
                ATIVAR ELEIÇÃO
              </div>
              <input
                type="text"
                placeholder="Digite a frase de confirmação..."
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowActivateModal(false);
                  setConflictActiveElection(null);
                  setAllowDeactivateCurrent(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={!validateAdminConfirmation(confirmationInput, 'ATIVAR ELEIÇÃO') || (conflictActiveElection !== null && !allowDeactivateCurrent) || activating}
                onClick={handleActivate}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white flex items-center gap-1.5 transition-colors"
              >
                {activating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Confirmar Ativação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
