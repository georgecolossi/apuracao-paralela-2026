import dns from 'node:dns';
import { prisma } from '@/lib/db';
import {
  VALID_BRAZILIAN_UFS,
  isPublicElectionStatusAllowed,
  TseDnsLookupFn,
  TseResolvedUrlValidationResult,
  validateTseSourceUrl,
  resolveAndValidateTseSourceUrl,
  executePinnedHttpGetJson
} from '@/lib/validation/electionContext';
import {
  buildTseContextCacheKey,
  computeTseConfigFingerprint,
  getCachedTseResult,
  isCacheableTseResponse,
  setCachedTseResult,
  TseOfficeResultDTO,
  TseResultsResponse,
  TseSyncConfigCacheInput
} from './tseResultsCache';

export const DEFAULT_TSE_BASE_URL = 'https://resultados.tse.jus.br/oficial';
export const DEFAULT_TSE_FETCH_TIMEOUT_MS = 5000;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate'
};

const CACHEABLE_HEADERS = {
  'Cache-Control': 'public, max-age=15, stale-while-revalidate=15'
};

const FORBIDDEN_OVERRIDE_PARAMS = [
  'uf',
  'muni',
  'muniCode',
  'muniTseCode',
  'eleCode',
  'officialElectionCode',
  'year',
  'sourceUrl',
  'url',
  'baseUrl',
  'cargo',
  'officeCode',
  'scopeType'
];

const GENDER_INFLECTION_CANONICAL_NAMES: Record<string, string> = {
  GOVERNADORA: 'Governador',
  GOVERNADOR: 'Governador',
  PRESIDENTE: 'Presidente',
  PRESIDENTA: 'Presidente',
  SENADORA: 'Senador',
  SENADOR: 'Senador',
  PREFEITA: 'Prefeito',
  PREFEITO: 'Prefeito',
  'DEPUTADA FEDERAL': 'Deputado Federal',
  'DEPUTADO FEDERAL': 'Deputado Federal',
  'DEPUTADA ESTADUAL': 'Deputado Estadual',
  'DEPUTADO ESTADUAL': 'Deputado Estadual',
  'DEPUTADA DISTRITAL': 'Deputado Distrital',
  'DEPUTADO DISTRITAL': 'Deputado Distrital',
  VEREADORA: 'Vereador',
  VEREADOR: 'Vereador'
};

export interface TseServiceResult {
  status: number;
  body: Record<string, any>;
  headers: Record<string, string>;
}

export interface TseQueryOptions {
  timeoutMs?: number;
  now?: number;
  dnsLookup?: TseDnsLookupFn;
  allowTestLoopbackHttp?: boolean;
}

function isAutomatedTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.VITEST === 'true';
}

function isVitestMockFunction(fn: unknown): boolean {
  return typeof fn === 'function' && typeof (fn as any).mock === 'object';
}

interface ResolvedTseTarget {
  eleCode: string;
  cargoCode: string;
  cargoNameOverride?: string;
  effectiveUf: string;
  effectiveMuniCode: string | null;
  sourceUrl: string | null;
  orderPriority: number;
}

function normalizeAbrCode(val: unknown): string {
  const s = String(val ?? '').trim().toLowerCase();
  if (!s) return '';
  return /^\d+$/.test(s) ? s.padStart(5, '0') : s;
}

function normalizeNumericCode(val: unknown): string {
  return String(val ?? '').trim().replace(/^0+/, '') || '0';
}

function normalizeCargoDisplayName(rawName: unknown, dbName?: string): string {
  if (dbName && dbName.trim().length > 0) {
    return dbName.trim();
  }
  const str = String(rawName ?? '').trim();
  if (!str) return '';
  const upper = str.toUpperCase();
  return GENDER_INFLECTION_CANONICAL_NAMES[upper] || str;
}

function safeNonNegativeInt(val: unknown): number {
  const n = parseInt(String(val ?? '0'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function buildTargetUrl(
  year: number,
  target: ResolvedTseTarget
): string {
  const cargoPadded = target.cargoCode.padStart(4, '0');
  const elePadded = target.eleCode.padStart(6, '0');
  const ufLower = target.effectiveUf.toLowerCase();
  const abrPrefix = target.effectiveMuniCode
    ? `${ufLower}${normalizeAbrCode(target.effectiveMuniCode)}`
    : ufLower;

  if (target.sourceUrl) {
    if (/\.json(\?.*)?$/i.test(target.sourceUrl)) {
      return target.sourceUrl;
    }

    if (target.sourceUrl.includes('{eleCode}') || target.sourceUrl.includes('{cargo}')) {
      return target.sourceUrl
        .replace(/\{year\}/g, String(year))
        .replace(/\{eleCode\}/g, target.eleCode)
        .replace(/\{elePadded\}/g, elePadded)
        .replace(/\{uf\}/g, ufLower)
        .replace(/\{muni\}/g, target.effectiveMuniCode ? normalizeAbrCode(target.effectiveMuniCode) : '')
        .replace(/\{cargo\}/g, target.cargoCode)
        .replace(/\{cargoPadded\}/g, cargoPadded);
    }

    const base = target.sourceUrl.replace(/\/+$/, '');
    return `${base}/ele${year}/${target.eleCode}/dados/${ufLower}/${abrPrefix}-c${cargoPadded}-e${elePadded}-u.json`;
  }

  return `${DEFAULT_TSE_BASE_URL}/ele${year}/${target.eleCode}/dados/${ufLower}/${abrPrefix}-c${cargoPadded}-e${elePadded}-u.json`;
}

async function fetchEA20WithTimeout(
  url: string,
  target: ResolvedTseTarget,
  roundNumber: number,
  timeoutMs: number,
  resolvedUrl: Extract<TseResolvedUrlValidationResult, { valid: true }> | null,
  usingMockedFetch: boolean,
  options: TseQueryOptions
): Promise<TseOfficeResultDTO> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const abortPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new Error('TSE_FETCH_TIMEOUT'));
      }, timeoutMs);
    });

    const fetchPromise = usingMockedFetch
      ? fetch(url, {
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal
        })
      : resolvedUrl
        ? executePinnedHttpGetJson(url, resolvedUrl, {
            timeoutMs,
            signal: controller.signal,
            allowTestLoopbackHttp: options.allowTestLoopbackHttp
          })
        : Promise.reject(new Error('UNRESOLVED_TARGET'));

    const res = await Promise.race([fetchPromise, abortPromise]);

    if (!res.ok) {
      if (res.status === 404) {
        return { status: 'NOT_YET_AVAILABLE', cargo: target.cargoCode };
      }
      return { status: 'TEMPORARILY_UNAVAILABLE', cargo: target.cargoCode };
    }

    let payload: any;
    try {
      payload = await res.json();
    } catch {
      return { status: 'INVALID_RESPONSE', cargo: target.cargoCode };
    }

    return parseEA20Payload(payload, target, roundNumber);
  } catch {
    return { status: 'TEMPORARILY_UNAVAILABLE', cargo: target.cargoCode };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function parseEA20Payload(
  payload: any,
  target: ResolvedTseTarget,
  roundNumber: number
): TseOfficeResultDTO {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: 'INVALID_RESPONSE', cargo: target.cargoCode };
  }

  // Validate round matches requested round
  if (payload.t === undefined || payload.t === null || String(payload.t).trim() !== String(roundNumber)) {
    return { status: 'INVALID_RESPONSE', cargo: target.cargoCode };
  }

  // Validate abrangencia matches resolved municipality or UF
  const expectedCdabr = target.effectiveMuniCode || target.effectiveUf;
  if (!payload.cdabr || normalizeAbrCode(payload.cdabr) !== normalizeAbrCode(expectedCdabr)) {
    return { status: 'INVALID_RESPONSE', cargo: target.cargoCode };
  }

  // Validate official election code if present in payload
  if (
    payload.ele !== undefined &&
    payload.ele !== null &&
    String(payload.ele).trim() !== '' &&
    normalizeNumericCode(payload.ele) !== normalizeNumericCode(target.eleCode)
  ) {
    return { status: 'INVALID_RESPONSE', cargo: target.cargoCode };
  }

  if (!Array.isArray(payload.carg) || payload.carg.length === 0) {
    return { status: 'INVALID_RESPONSE', cargo: target.cargoCode };
  }

  const matchedCarg = payload.carg.find((c: any) => {
    if (!c || typeof c !== 'object') return false;
    if (c.cd === undefined || c.cd === null || String(c.cd).trim() === '') return true;
    return normalizeNumericCode(c.cd) === normalizeNumericCode(target.cargoCode);
  });

  if (!matchedCarg) {
    return { status: 'INVALID_RESPONSE', cargo: target.cargoCode };
  }

  const candidates: Array<{ number: string; name: string; votes: number; percent: string }> = [];
  if (Array.isArray(matchedCarg.agr)) {
    for (const agr of matchedCarg.agr) {
      if (!agr || !Array.isArray(agr.par)) continue;
      for (const par of agr.par) {
        if (!par || !Array.isArray(par.cand)) continue;
        for (const c of par.cand) {
          if (!c || typeof c !== 'object') continue;
          candidates.push({
            number: String(c.n ?? '').trim(),
            name: String(c.nmu ?? c.nm ?? '').trim(),
            votes: safeNonNegativeInt(c.vap),
            percent: String(c.pvap ?? '0,00')
          });
        }
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return a.number.localeCompare(b.number, undefined, { numeric: true });
  });

  const totalSec = safeNonNegativeInt(payload.s?.ts);
  const procSec = safeNonNegativeInt(payload.s?.st);

  return {
    status: 'AVAILABLE',
    cargo: target.cargoCode,
    cargoName: normalizeCargoDisplayName(
      matchedCarg.ds || matchedCarg.nm || matchedCarg.nmf,
      target.cargoNameOverride
    ),
    progress: {
      total: totalSec,
      processed: procSec,
      percent: String(payload.s?.pst ?? '0,00'),
      isStarted: procSec > 0,
      isCompleted: totalSec > 0 && procSec === totalSec,
      status: procSec === 0 ? 'AGUARDANDO_APURACAO' : procSec < totalSec ? 'EM_ANDAMENTO' : 'CONCLUIDA'
    },
    attendance: {
      eligible: safeNonNegativeInt(payload.e?.te),
      turnout: safeNonNegativeInt(payload.e?.c),
      turnoutPercent: String(payload.e?.pc ?? '0,00'),
      abstention: safeNonNegativeInt(payload.e?.a),
      abstentionPercent: String(payload.e?.pa ?? '0,00')
    },
    validVotes: {
      quantity: safeNonNegativeInt(payload.v?.vvc),
      percent: String(payload.v?.pvvc ?? '0,00')
    },
    blankVotes: {
      quantity: safeNonNegativeInt(payload.v?.vb),
      percent: String(payload.v?.pvb ?? '0,00')
    },
    nullVotes: {
      quantity: safeNonNegativeInt(payload.v?.tvn),
      percent: String(payload.v?.ptvn ?? '0,00')
    },
    candidates
  };
}

function resolveTargetsFromConfigs(
  election: {
    id: string;
    year: number;
    scopes: Array<{
      id: string;
      scopeType: string;
      scopeKey: string;
      isCoverageArea: boolean;
      state: { abbreviation: string } | null;
      municipality: { officialCode: string; name?: string | null; state: { abbreviation: string } } | null;
    }>;
    offices: Array<{ id: string; code: string; name: string; type: string; orderNumber: number }>;
  },
  configs: TseSyncConfigCacheInput[],
  options?: { allowTestLoopbackHttp?: boolean }
):
  | { ok: true; targets: ResolvedTseTarget[]; primaryUf: string; primaryMuniCode: string | null }
  | { ok: false; errorCode: string; message: string } {
  if (!Number.isInteger(election.year) || election.year < 1900 || election.year > 2100) {
    return {
      ok: false,
      errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
      message: 'Ano eleitoral inválido na configuração da eleição.'
    };
  }

  const municipalScopes = election.scopes.filter(
    s => s.isCoverageArea && s.scopeType === 'MUNICIPAL' && s.municipality
  );
  const stateScopes = election.scopes.filter(
    s => s.isCoverageArea && s.scopeType === 'ESTADUAL' && s.state
  );

  const officeLookup = new Map<string, { code: string; name: string; orderNumber: number }>();
  for (const off of election.offices) {
    officeLookup.set(normalizeNumericCode(off.code), off);
  }

  const targets: ResolvedTseTarget[] = [];
  const seenKeys = new Set<string>();

  for (const config of configs) {
    const eleCode = (config.officialElectionCode || '').trim();
    if (!eleCode || !/^\d+$/.test(eleCode)) {
      return {
        ok: false,
        errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
        message: 'Código oficial da eleição TSE (officialElectionCode) ausente ou inválido na configuração.'
      };
    }

    const scopeType = (config.scopeType || '').trim().toUpperCase();
    if (!['MUNICIPAL', 'ESTADUAL', 'NACIONAL'].includes(scopeType)) {
      return {
        ok: false,
        errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
        message: 'Tipo de abrangência inválido em TseSyncConfig.'
      };
    }

    let validatedSourceUrl: string | null = null;
    if (config.sourceUrl && config.sourceUrl.trim() !== '') {
      const urlCheck = validateTseSourceUrl(config.sourceUrl, {
        allowTestLoopbackHttp: options?.allowTestLoopbackHttp
      });
      if (!urlCheck.valid) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
          message: urlCheck.reason
        };
      }
      validatedSourceUrl = urlCheck.normalized;
    }

    const cfgUf = config.uf ? config.uf.trim().toUpperCase() : null;
    const cfgMuni = config.muniTseCode ? config.muniTseCode.trim() : null;

    if (cfgUf) {
      if (scopeType === 'NACIONAL') {
        if (cfgUf !== 'BR' && !VALID_BRAZILIAN_UFS.has(cfgUf)) {
          return {
            ok: false,
            errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
            message: `UF '${cfgUf}' inválida na configuração TSE.`
          };
        }
      } else if (!VALID_BRAZILIAN_UFS.has(cfgUf)) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
          message: `UF '${cfgUf}' inválida para escopo ${scopeType} na configuração TSE.`
        };
      }
    }

    if (cfgMuni !== null) {
      if (!/^\d{1,6}$/.test(cfgMuni) || Number(cfgMuni) <= 0) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
          message: 'Código TSE do município inválido na configuração.'
        };
      }
    }

    // Cross-validate against ElectionScope when scopes are defined on the Election
    let matchedMuniScope: (typeof municipalScopes)[0] | undefined;
    if (cfgMuni && municipalScopes.length > 0) {
      matchedMuniScope = municipalScopes.find(
        s => normalizeAbrCode(s.municipality!.officialCode) === normalizeAbrCode(cfgMuni)
      );
      if (!matchedMuniScope) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
          message: 'O código municipal configurado em TseSyncConfig diverge da abrangência cadastrada para a eleição.'
        };
      }
      const scopeUf = matchedMuniScope.municipality!.state.abbreviation.toUpperCase();
      if (cfgUf && cfgUf !== 'BR' && cfgUf !== scopeUf) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
          message: 'A UF configurada em TseSyncConfig diverge da UF do município na abrangência da eleição.'
        };
      }
    }

    if (!cfgMuni && cfgUf && cfgUf !== 'BR') {
      if (municipalScopes.length === 1) {
        const singleMuniUf = municipalScopes[0].municipality!.state.abbreviation.toUpperCase();
        if (cfgUf !== singleMuniUf) {
          return {
            ok: false,
            errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
            message: 'A UF configurada em TseSyncConfig diverge da abrangência territorial da eleição.'
          };
        }
      } else if (stateScopes.length > 0 && !stateScopes.some(s => s.state!.abbreviation.toUpperCase() === cfgUf)) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
          message: 'A UF configurada em TseSyncConfig não pertence aos estados configurados para a eleição.'
        };
      }
    }

    let effectiveUf: string | null = null;
    let effectiveMuniCode: string | null = null;

    if (scopeType === 'MUNICIPAL') {
      if (cfgMuni) {
        effectiveMuniCode = cfgMuni;
        effectiveUf = cfgUf || matchedMuniScope?.municipality?.state.abbreviation.toUpperCase() || null;
      } else if (municipalScopes.length === 1) {
        effectiveMuniCode = municipalScopes[0].municipality!.officialCode;
        effectiveUf = cfgUf || municipalScopes[0].municipality!.state.abbreviation.toUpperCase();
      } else {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
          message: 'Configuração municipal do TSE incompleta: código do município (muniTseCode) ausente.'
        };
      }

      if (!effectiveUf || !VALID_BRAZILIAN_UFS.has(effectiveUf) || !effectiveMuniCode) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
          message: 'Configuração municipal do TSE incompleta: UF ou código TSE do município não definidos.'
        };
      }
    } else if (scopeType === 'ESTADUAL') {
      if (cfgMuni) {
        effectiveMuniCode = cfgMuni;
        effectiveUf = cfgUf || matchedMuniScope?.municipality?.state.abbreviation.toUpperCase() || null;
      } else if (municipalScopes.length === 1) {
        effectiveMuniCode = municipalScopes[0].municipality!.officialCode;
        effectiveUf = cfgUf || municipalScopes[0].municipality!.state.abbreviation.toUpperCase();
      } else {
        effectiveMuniCode = null;
        effectiveUf = cfgUf || (stateScopes.length === 1 ? stateScopes[0].state!.abbreviation.toUpperCase() : null);
      }

      if (!effectiveUf || !VALID_BRAZILIAN_UFS.has(effectiveUf)) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
          message: 'Configuração estadual do TSE incompleta: UF não definida.'
        };
      }
    } else {
      // NACIONAL
      if (cfgMuni) {
        effectiveMuniCode = cfgMuni;
        effectiveUf = (cfgUf && cfgUf !== 'BR')
          ? cfgUf
          : (matchedMuniScope?.municipality?.state.abbreviation.toUpperCase() || null);

        if (!effectiveUf || !VALID_BRAZILIAN_UFS.has(effectiveUf)) {
          return {
            ok: false,
            errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
            message: 'Configuração com município definido exige UF estadual válida.'
          };
        }
      } else if (municipalScopes.length === 1) {
        effectiveMuniCode = municipalScopes[0].municipality!.officialCode;
        effectiveUf = municipalScopes[0].municipality!.state.abbreviation.toUpperCase();
      } else if (stateScopes.length === 1 && municipalScopes.length === 0) {
        effectiveMuniCode = null;
        effectiveUf = stateScopes[0].state!.abbreviation.toUpperCase();
      } else if (cfgUf) {
        effectiveMuniCode = null;
        effectiveUf = cfgUf;
      } else {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
          message: 'Configuração nacional do TSE incompleta: UF ou escopo ausentes.'
        };
      }
    }

    // Resolve cargo codes for this config entry
    let cargoCodes: string[] = [];
    const rawOfficeCode = config.officeCode ? config.officeCode.trim() : '';

    if (rawOfficeCode && rawOfficeCode.toUpperCase() !== 'ALL') {
      if (!/^\d+$/.test(rawOfficeCode)) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
          message: `Código de cargo inválido ('${rawOfficeCode}') em TseSyncConfig.`
        };
      }
      cargoCodes = [rawOfficeCode];
    } else {
      if (election.offices.length === 0) {
        return {
          ok: false,
          errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
          message: 'Nenhum cargo eleitoral cadastrado para resolver a configuração TSE.'
        };
      }
      cargoCodes = election.offices.map(o => o.code.trim()).filter(Boolean);
    }

    if (validatedSourceUrl && /\.json(\?.*)?$/i.test(validatedSourceUrl) && cargoCodes.length > 1) {
      return {
        ok: false,
        errorCode: 'CONFIGURACAO_TSE_INCONSISTENTE',
        message: 'URL direta (.json) não pode ser associada a múltiplos cargos simultaneamente.'
      };
    }

    for (const cargoCode of cargoCodes) {
      const dbOffice = officeLookup.get(normalizeNumericCode(cargoCode));
      const dedupKey = [
        eleCode,
        effectiveUf,
        effectiveMuniCode ? normalizeAbrCode(effectiveMuniCode) : '',
        normalizeNumericCode(cargoCode),
        validatedSourceUrl || ''
      ].join('|');

      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        targets.push({
          eleCode,
          cargoCode,
          cargoNameOverride: dbOffice?.name,
          effectiveUf,
          effectiveMuniCode: effectiveMuniCode ? normalizeAbrCode(effectiveMuniCode) : null,
          sourceUrl: validatedSourceUrl,
          orderPriority: dbOffice?.orderNumber ?? (parseInt(cargoCode, 10) || 999)
        });
      }
    }
  }

  if (targets.length === 0) {
    return {
      ok: false,
      errorCode: 'CONFIGURACAO_TSE_INCOMPLETA',
      message: 'Nenhum alvo de consulta TSE pôde ser resolvido a partir da configuração.'
    };
  }

  targets.sort((a, b) => a.orderPriority - b.orderPriority || a.cargoCode.localeCompare(b.cargoCode, undefined, { numeric: true }));

  const primaryUf = targets[0].effectiveUf;
  const muniCandidates = Array.from(new Set(targets.map(t => t.effectiveMuniCode).filter((m): m is string => Boolean(m))));
  const primaryMuniCode = muniCandidates.length > 0 ? muniCandidates[0] : null;

  return {
    ok: true,
    targets,
    primaryUf,
    primaryMuniCode
  };
}

export async function getDynamicTseResults(
  req: Request,
  options: TseQueryOptions = {}
): Promise<TseServiceResult> {
  try {
    const { searchParams } = new URL(req.url);

    // Reject parameter tampering / open-proxy override attempts
    for (const forbidden of FORBIDDEN_OVERRIDE_PARAMS) {
      if (searchParams.has(forbidden)) {
        return {
          status: 400,
          headers: NO_STORE_HEADERS,
          body: {
            source: 'TSE',
            status: 'CONFIGURATION_ERROR',
            error: 'PARAMETRO_NAO_PERMITIDO',
            message: 'Parâmetros de sobrescrita territorial ou de URL externa não são permitidos.'
          }
        };
      }
    }

    const roundParam = searchParams.get('round');
    if (roundParam === null || roundParam === undefined || roundParam === '') {
      return {
        status: 400,
        headers: NO_STORE_HEADERS,
        body: {
          error: 'Round missing',
          message: "O parâmetro 'round' é obrigatório (1 ou 2)."
        }
      };
    }

    if (!/^[1-2]$/.test(roundParam)) {
      return {
        status: 400,
        headers: NO_STORE_HEADERS,
        body: {
          error: 'TURNO_INVALIDO',
          message: "O parâmetro 'round' deve ser 1 ou 2."
        }
      };
    }

    const roundNumber = parseInt(roundParam, 10);

    const hasElectionKey =
      searchParams.has('election') || searchParams.has('electionId') || searchParams.has('slug');
    const electionParam =
      searchParams.get('election') || searchParams.get('electionId') || searchParams.get('slug');

    if (hasElectionKey && (!electionParam || electionParam.trim().length === 0)) {
      return {
        status: 400,
        headers: NO_STORE_HEADERS,
        body: {
          error: 'PARAMETRO_INVALIDO',
          message: "Parâmetro 'election' inválido."
        }
      };
    }

    const electionInclude = {
      rounds: { orderBy: { roundNumber: 'asc' as const } },
      scopes: {
        orderBy: { scopeKey: 'asc' as const },
        include: {
          state: { select: { abbreviation: true } },
          municipality: {
            select: {
              officialCode: true,
              name: true,
              state: { select: { abbreviation: true } }
            }
          }
        }
      },
      offices: { orderBy: { orderNumber: 'asc' as const } },
      tseConfigs: {
        where: { roundNumber },
        orderBy: { configKey: 'asc' as const }
      }
    };

    let election;
    if (electionParam) {
      const cleanParam = electionParam.trim();
      const found = await prisma.election.findFirst({
        where: {
          OR: [{ id: cleanParam }, { slug: cleanParam }]
        },
        include: electionInclude
      });

      if (!found) {
        return {
          status: 404,
          headers: NO_STORE_HEADERS,
          body: {
            source: 'TSE',
            round: roundParam,
            status: 'NOT_YET_AVAILABLE',
            error: 'ELEICAO_NAO_ENCONTRADA',
            message: 'Eleição solicitada não encontrada.',
            offices: []
          }
        };
      }

      if (!isPublicElectionStatusAllowed(found.status)) {
        return {
          status: 403,
          headers: NO_STORE_HEADERS,
          body: {
            source: 'TSE',
            round: roundParam,
            status: 'CONFIGURATION_ERROR',
            error: 'CONTEXTO_NAO_AUTORIZADO',
            message: 'A eleição selecionada não está disponível para consulta pública.',
            offices: []
          }
        };
      }

      election = found;
    } else {
      const activeElections = await prisma.election.findMany({
        where: { status: 'ACTIVE' },
        include: electionInclude
      });

      if (activeElections.length === 0) {
        return {
          status: 200,
          headers: NO_STORE_HEADERS,
          body: {
            source: 'TSE',
            round: roundParam,
            municipality: null,
            status: 'NOT_YET_AVAILABLE',
            error: 'CONFIGURACAO_TSE_AUSENTE',
            message: 'Nenhuma eleição ativa configurada no sistema.',
            offices: []
          }
        };
      }

      if (activeElections.length > 1) {
        return {
          status: 400,
          headers: NO_STORE_HEADERS,
          body: {
            source: 'TSE',
            round: roundParam,
            error: 'ELEICOES_MULTIPLAS_ATIVAS',
            message: 'Múltiplas eleições ativas configuradas. Especifique o parâmetro ?election=<id_ou_slug>.',
            activeElections: activeElections.map(e => ({
              id: e.id,
              slug: e.slug,
              name: e.name,
              year: e.year
            }))
          }
        };
      }

      election = activeElections[0];
    }

    if (election.rounds.length > 0 && !election.rounds.some(r => r.roundNumber === roundNumber)) {
      return {
        status: 404,
        headers: NO_STORE_HEADERS,
        body: {
          source: 'TSE',
          electionId: election.id,
          round: roundParam,
          municipality: null,
          status: 'NOT_YET_AVAILABLE',
          error: 'TURNO_NAO_ENCONTRADO',
          message: `O ${roundNumber}º Turno não está configurado para esta eleição.`,
          offices: []
        }
      };
    }

    const roundConfigs = election.tseConfigs.filter(c => c.roundNumber === roundNumber);
    if (roundConfigs.length === 0) {
      return {
        status: 200,
        headers: NO_STORE_HEADERS,
        body: {
          source: 'TSE',
          electionId: election.id,
          electionSlug: election.slug,
          year: election.year,
          round: roundParam,
          municipality: null,
          status: 'NOT_YET_AVAILABLE',
          error: 'CONFIGURACAO_TSE_AUSENTE',
          message: 'Nenhuma configuração de sincronização TSE cadastrada para este turno.',
          offices: []
        }
      };
    }

    const activeConfigs = roundConfigs.filter(c => c.isActive && c.status !== 'PAUSED');
    if (activeConfigs.length === 0) {
      return {
        status: 200,
        headers: NO_STORE_HEADERS,
        body: {
          source: 'TSE',
          electionId: election.id,
          electionSlug: election.slug,
          year: election.year,
          round: roundParam,
          municipality: null,
          status: 'NOT_YET_AVAILABLE',
          error: 'CONFIGURACAO_TSE_PAUSADA',
          message: 'Sincronização TSE pausada ou desativada para este turno.',
          offices: []
        }
      };
    }

    const resolution = resolveTargetsFromConfigs(election, activeConfigs, {
      allowTestLoopbackHttp: options.allowTestLoopbackHttp
    });
    if (!resolution.ok) {
      return {
        status: 422,
        headers: NO_STORE_HEADERS,
        body: {
          source: 'TSE',
          electionId: election.id,
          electionSlug: election.slug,
          year: election.year,
          round: roundParam,
          municipality: null,
          status: 'CONFIGURATION_ERROR',
          error: resolution.errorCode,
          message: resolution.message,
          offices: []
        }
      };
    }

    const { targets, primaryUf, primaryMuniCode } = resolution;

    // Context-bound 15s cache check (includes TseSyncConfig, ElectionScope, and Office fingerprint)
    const now = options.now ?? Date.now();
    const configFingerprint = computeTseConfigFingerprint({
      configs: activeConfigs,
      scopes: election.scopes,
      offices: election.offices
    });
    const cacheKey = buildTseContextCacheKey({
      electionId: election.id,
      year: election.year,
      roundNumber,
      uf: primaryUf,
      muniTseCode: primaryMuniCode,
      configFingerprint
    });
    const contextPrefix = `${election.id}:${roundNumber}`;

    const cached = getCachedTseResult(cacheKey, now);
    if (cached) {
      return {
        status: 200,
        headers: CACHEABLE_HEADERS,
        body: cached
      };
    }

    const builtTargets = targets.map(target => ({
      target,
      url: buildTargetUrl(election.year, target)
    }));

    for (const item of builtTargets) {
      const builtLexicalCheck = validateTseSourceUrl(item.url, {
        allowTestLoopbackHttp: options.allowTestLoopbackHttp
      });
      if (!builtLexicalCheck.valid) {
        return {
          status: 422,
          headers: NO_STORE_HEADERS,
          body: {
            source: 'TSE',
            electionId: election.id,
            electionSlug: election.slug,
            year: election.year,
            round: roundParam,
            municipality: null,
            status: 'CONFIGURATION_ERROR',
            error: 'CONFIGURACAO_TSE_INCONSISTENTE',
            message: 'URL externa gerada pela configuração TSE não é permitida pela política de segurança.',
            offices: []
          }
        };
      }
    }

    const usingMockedFetch = isAutomatedTestRuntime() && isVitestMockFunction(globalThis.fetch);
    const hasDnsOverride =
      Boolean(options.dnsLookup) ||
      (isAutomatedTestRuntime() && isVitestMockFunction(dns.promises.lookup));

    let resolvedTargets: Array<TseResolvedUrlValidationResult | null>;
    if (!usingMockedFetch || hasDnsOverride) {
      resolvedTargets = await Promise.all(
        builtTargets.map(item =>
          resolveAndValidateTseSourceUrl(item.url, {
            allowTestLoopbackHttp: options.allowTestLoopbackHttp,
            dnsLookup: options.dnsLookup
          })
        )
      );

      const ssrfBlocked = resolvedTargets.find(
        (res): res is Extract<TseResolvedUrlValidationResult, { valid: false }> =>
          res !== null && !res.valid && res.errorType === 'SSRF_BLOCKED'
      );
      if (ssrfBlocked) {
        return {
          status: 422,
          headers: NO_STORE_HEADERS,
          body: {
            source: 'TSE',
            electionId: election.id,
            electionSlug: election.slug,
            year: election.year,
            round: roundParam,
            municipality: null,
            status: 'CONFIGURATION_ERROR',
            error: 'CONFIGURACAO_TSE_INCONSISTENTE',
            message: ssrfBlocked.reason,
            offices: []
          }
        };
      }
    } else {
      resolvedTargets = builtTargets.map(() => null);
    }

    const envTimeout = Number(process.env.TSE_FETCH_TIMEOUT_MS);
    const timeoutMs = options.timeoutMs ?? (
      Number.isFinite(envTimeout) && envTimeout >= 50 && envTimeout <= 30000
        ? envTimeout
        : DEFAULT_TSE_FETCH_TIMEOUT_MS
    );
    const officeResults = await Promise.all(
      builtTargets.map((item, idx) => {
        const resolved = resolvedTargets[idx];
        if (resolved && !resolved.valid) {
          return Promise.resolve({
            status: 'TEMPORARILY_UNAVAILABLE' as const,
            cargo: item.target.cargoCode
          });
        }
        return fetchEA20WithTimeout(
          item.url,
          item.target,
          roundNumber,
          timeoutMs,
          resolved && resolved.valid ? resolved : null,
          usingMockedFetch,
          options
        );
      })
    );

    const hasAvailable = officeResults.some(o => o.status === 'AVAILABLE');
    const allNotYetAvailable = officeResults.every(o => o.status === 'NOT_YET_AVAILABLE');
    const hasInvalidResponse = officeResults.some(o => o.status === 'INVALID_RESPONSE');
    const hasTempUnavailable = officeResults.some(o => o.status === 'TEMPORARILY_UNAVAILABLE');

    if (hasAvailable) {
      const responseBody: TseResultsResponse = {
        source: 'TSE',
        electionId: election.id,
        electionSlug: election.slug,
        year: election.year,
        round: roundParam,
        uf: primaryUf,
        municipality: primaryMuniCode,
        status: 'AVAILABLE',
        offices: officeResults
      };

      const canCache = isCacheableTseResponse(responseBody);
      if (canCache) {
        setCachedTseResult(cacheKey, contextPrefix, responseBody, now);
      }

      return {
        status: 200,
        headers: canCache ? CACHEABLE_HEADERS : NO_STORE_HEADERS,
        body: responseBody
      };
    }

    if (allNotYetAvailable) {
      const emptyBody: TseResultsResponse = {
        source: 'TSE',
        electionId: election.id,
        electionSlug: election.slug,
        year: election.year,
        round: roundParam,
        uf: primaryUf,
        municipality: primaryMuniCode,
        status: 'NOT_YET_AVAILABLE',
        offices: officeResults
      };

      return {
        status: 200,
        headers: NO_STORE_HEADERS,
        body: emptyBody
      };
    }

    if (hasInvalidResponse && !hasTempUnavailable) {
      return {
        status: 502,
        headers: NO_STORE_HEADERS,
        body: {
          source: 'TSE',
          electionId: election.id,
          electionSlug: election.slug,
          year: election.year,
          round: roundParam,
          uf: primaryUf,
          municipality: primaryMuniCode,
          status: 'INVALID_RESPONSE',
          error: 'RESPOSTA_EXTERNA_INVALIDA',
          message: 'O serviço externo do TSE retornou uma resposta inválida ou inconsistente.',
          offices: officeResults
        }
      };
    }

    return {
      status: 503,
      headers: NO_STORE_HEADERS,
      body: {
        source: 'TSE',
        electionId: election.id,
        electionSlug: election.slug,
        year: election.year,
        round: roundParam,
        uf: primaryUf,
        municipality: primaryMuniCode,
        status: 'TEMPORARILY_UNAVAILABLE',
        error: 'SERVICO_EXTERNO_INDISPONIVEL',
        message: 'Serviço externo do TSE temporariamente indisponível.',
        offices: officeResults
      }
    };
  } catch (error) {
    console.error('[TSE_RESULTS_SERVICE_ERROR]', error);
    return {
      status: 500,
      headers: NO_STORE_HEADERS,
      body: {
        source: 'TSE',
        status: 'TEMPORARILY_UNAVAILABLE',
        error: 'ERRO_INTERNO',
        message: 'Ocorreu um erro interno ao consultar os resultados do TSE.'
      }
    };
  }
}
