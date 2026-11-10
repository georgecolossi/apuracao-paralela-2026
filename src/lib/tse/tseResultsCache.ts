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
 * active TseSyncConfig records so any configuration update invalidates stale cache entries.
 */
export function computeTseConfigFingerprint(configs: TseSyncConfigCacheInput[]): string {
  const normalized = [...configs]
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

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

/**
 * Builds a collision-free cache key bound to the effective electoral context
 * (electionId, year, round, uf, municipality code) and config fingerprint.
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

export function isCacheableTseResponse(data: TseResultsResponse): boolean {
  if (data.status !== 'AVAILABLE' || !Array.isArray(data.offices) || data.offices.length === 0) {
    return false;
  }

  const hasAvailableOffice = data.offices.some(o => o.status === 'AVAILABLE');
  const hasExternalFailure = data.offices.some(
    o => o.status === 'TEMPORARILY_UNAVAILABLE' || o.status === 'INVALID_RESPONSE'
  );

  return hasAvailableOffice && !hasExternalFailure;
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
