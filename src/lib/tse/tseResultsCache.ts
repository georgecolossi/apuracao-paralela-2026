import crypto from 'crypto';

export const TSE_CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 500;

export type TseOfficeStatus =
  | 'AVAILABLE'
  | 'NOT_YET_AVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'INVALID_RESPONSE';

export type TseOverallStatus =
  | 'AVAILABLE'
  | 'NOT_YET_AVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'CONFIGURATION_ERROR';

export interface TseCandidateResultDTO {
  number: string;
  name: string;
  votes: number;
  percent: string;
}

export interface TseOfficeResultDTO {
  status: TseOfficeStatus;
  cargo: string;
  cargoName?: string;
  progress?: {
    total: number;
    processed: number;
    percent: string;
    isStarted: boolean;
    isCompleted: boolean;
    status: 'AGUARDANDO_APURACAO' | 'EM_ANDAMENTO' | 'CONCLUIDA';
  };
  attendance?: {
    eligible: number;
    turnout: number;
    turnoutPercent: string;
    abstention: number;
    abstentionPercent: string;
  };
  validVotes?: {
    quantity: number;
    percent: string;
  };
  blankVotes?: {
    quantity: number;
    percent: string;
  };
  nullVotes?: {
    quantity: number;
    percent: string;
  };
  candidates?: TseCandidateResultDTO[];
}

export interface TseResultsResponse {
  source: 'TSE';
  electionId?: string;
  electionSlug?: string;
  year?: number;
  round: string;
  uf?: string;
  municipality: string | null;
  status: TseOverallStatus;
  error?: string;
  message?: string;
  offices: TseOfficeResultDTO[];
}

export interface TseSyncConfigCacheInput {
  id: string;
  configKey: string;
  roundNumber: number;
  officeCode: string | null;
  officialElectionCode: string;
  scopeType: string;
  uf: string | null;
  muniTseCode: string | null;
  sourceUrl: string | null;
  status: string;
  isActive: boolean;
  syncIntervalSeconds: number;
}

export interface TseScopeCacheInput {
  id?: string;
  scopeType: string;
  scopeKey: string;
  isCoverageArea?: boolean;
  state?: { abbreviation: string } | null;
  municipality?: {
    officialCode: string;
    name?: string | null;
    state?: { abbreviation: string } | null;
  } | null;
}

export interface TseOfficeCacheInput {
  id?: string;
  code: string;
  name: string;
  type?: string | null;
  orderNumber: number;
}

export interface TseFingerprintInput {
  configs: TseSyncConfigCacheInput[];
  scopes?: TseScopeCacheInput[];
  offices?: TseOfficeCacheInput[];
}

export interface TseCacheContextKeyParams {
  electionId: string;
  year: number;
  roundNumber: number;
  uf: string;
  muniTseCode: string | null;
  configFingerprint: string;
}

interface CacheEntry {
  key: string;
  contextPrefix: string;
  data: TseResultsResponse;
  cachedAt: number;
}

const resultsCache = new Map<string, CacheEntry>();

/**
 * Computes a deterministic SHA-256 fingerprint over all functional fields of
 * active TseSyncConfig, ElectionScope, and Office records (including cargo codes,
 * display names, and orderNumber ordering) so any configuration or structural update
 * immediately invalidates stale cache entries.
 */
export function computeTseConfigFingerprint(input: TseFingerprintInput): string {
  const normalizedConfigs = [...input.configs]
    .sort((a, b) => a.configKey.localeCompare(b.configKey) || a.id.localeCompare(b.id))
    .map(c => [
      c.id,
      c.configKey,
      c.roundNumber,
      c.officeCode ?? null,
      c.officialElectionCode,
      c.scopeType,
      c.uf ?? null,
      c.muniTseCode ?? null,
      c.sourceUrl ?? null,
      c.status,
      c.isActive,
      c.syncIntervalSeconds
    ]);

  const normalizedScopes = [...(input.scopes ?? [])]
    .sort(
      (a, b) =>
        a.scopeKey.localeCompare(b.scopeKey) ||
        a.scopeType.localeCompare(b.scopeType) ||
        (a.id ?? '').localeCompare(b.id ?? '')
    )
    .map(s => [
      s.id ?? null,
      s.scopeType,
      s.scopeKey,
      s.isCoverageArea ?? true,
      s.state?.abbreviation ?? null,
      s.municipality?.officialCode ?? null,
      s.municipality?.name ?? null,
      s.municipality?.state?.abbreviation ?? null
    ]);

  const normalizedOffices = [...(input.offices ?? [])]
    .sort(
      (a, b) =>
        a.orderNumber - b.orderNumber ||
        a.code.localeCompare(b.code, undefined, { numeric: true }) ||
        a.name.localeCompare(b.name) ||
        (a.id ?? '').localeCompare(b.id ?? '')
    )
    .map(o => [o.id ?? null, o.code, o.name, o.type ?? null, o.orderNumber]);

  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        configs: normalizedConfigs,
        scopes: normalizedScopes,
        offices: normalizedOffices
      })
    )
    .digest('hex');
}

/**
 * Builds a collision-free cache key bound to the effective electoral context
 * (electionId, year, round, uf, municipality code) and complete config fingerprint.
 */
export function buildTseContextCacheKey(params: TseCacheContextKeyParams): string {
  const tuple = [
    params.electionId,
    params.year,
    params.roundNumber,
    params.uf.trim().toUpperCase(),
    params.muniTseCode ? params.muniTseCode.trim() : null,
    params.configFingerprint
  ];

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(tuple))
    .digest('hex');
}

/**
 * Explicit partial/failure cache policy:
 * Only fully valid responses where overall status is 'AVAILABLE' and EVERY office
 * returned status === 'AVAILABLE' are stored in the 15s cache.
 * Partial responses (containing any office with NOT_YET_AVAILABLE / 404,
 * TEMPORARILY_UNAVAILABLE / network/timeout/5xx, or INVALID_RESPONSE) and overall
 * non-AVAILABLE responses bypass cache (Cache-Control: no-store).
 */
export function isCacheableTseResponse(data: TseResultsResponse): boolean {
  if (data.status !== 'AVAILABLE' || !Array.isArray(data.offices) || data.offices.length === 0) {
    return false;
  }

  return data.offices.every(o => o.status === 'AVAILABLE');
}

export function getCachedTseResult(key: string, now: number = Date.now()): TseResultsResponse | null {
  const entry = resultsCache.get(key);
  if (!entry) return null;

  if (now - entry.cachedAt >= TSE_CACHE_TTL_MS) {
    resultsCache.delete(key);
    return null;
  }

  return structuredClone(entry.data);
}

export function setCachedTseResult(
  key: string,
  contextPrefix: string,
  data: TseResultsResponse,
  now: number = Date.now()
): void {
  if (!isCacheableTseResponse(data)) {
    return;
  }

  // Purge stale entries from the same election/round whose configuration changed
  for (const [existingKey, existingEntry] of resultsCache.entries()) {
    if (existingEntry.contextPrefix === contextPrefix && existingKey !== key) {
      resultsCache.delete(existingKey);
    }
  }

  if (!resultsCache.has(key) && resultsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = resultsCache.keys().next().value;
    if (oldestKey) resultsCache.delete(oldestKey);
  }

  resultsCache.set(key, {
    key,
    contextPrefix,
    data: structuredClone(data),
    cachedAt: now
  });
}

export function clearTseResultsCache(): void {
  resultsCache.clear();
}
