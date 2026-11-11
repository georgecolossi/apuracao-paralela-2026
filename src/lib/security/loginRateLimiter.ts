import net from 'node:net';

export const DEFAULT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR = 5;
export const DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP = 20;
export const DEFAULT_MAX_TRACKED_RATE_LIMIT_ENTRIES = 10_000;
export const DEFAULT_OVERFLOW_SLOTS_PER_SCOPE = 256;

export type IpResolutionStatus =
  | 'TRUSTED_PROXY_IP'
  | 'PROXY_NOT_TRUSTED'
  | 'MISSING_HEADER'
  | 'MALFORMED_CHAIN'
  | 'INSUFFICIENT_HOPS';

export type LoginRateLimitScope = 'PAIR' | 'IP' | 'ACCOUNT';

interface RateLimitBucketEntry {
  identityKey: string;
  scope: LoginRateLimitScope;
  epochId: number;
  failures: number;
  pending: number;
  resetAt: number;
}

interface LoginRateLimitState {
  primary: Map<string, RateLimitBucketEntry>;
  overflow: Record<LoginRateLimitScope, Array<RateLimitBucketEntry | null>>;
  retiring: Map<number, RateLimitBucketEntry>;
  nextEpochId: number;
}

interface TargetBucketSpec {
  scope: LoginRateLimitScope;
  identityKey: string;
  limit: number;
  resetOnSuccess: boolean;
}

interface ReservedBucketSlot {
  scope: LoginRateLimitScope;
  identityKey: string;
  mapKind: 'primary' | 'overflow';
  overflowSlotIndex: number;
  epochId: number;
  limit: number;
  resetOnSuccess: boolean;
}

export interface LoginRateLimitConfig {
  windowMs: number;
  maxAttemptsPerPair: number;
  maxAttemptsPerIp: number;
  trustedProxyHops: number;
  maxStoreEntries: number;
  maxOverflowSlotsPerScope: number;
}

export interface LoginRateLimitOptions {
  now?: number;
  config?: Partial<LoginRateLimitConfig>;
}

export interface LoginClientIpResolution {
  ip: string | null;
  trustedProxyResolved: boolean;
  resolutionStatus: IpResolutionStatus;
}

export interface LoginRateLimitReservation {
  allowed: boolean;
  retryAfterSeconds: number;
  blockedScope?: LoginRateLimitScope;
  clientIp: string | null;
  trustedProxyResolved: boolean;
  ipResolutionStatus: IpResolutionStatus;
  capacitySaturated: boolean;
  overflowExhausted: boolean;
  settled: boolean;
  acquiredNow: number;
  acquiredWithCustomNow: boolean;
  windowMs: number;
  slots: ReservedBucketSlot[];
}

export interface LoginFailureCommitResult {
  blocked: boolean;
  newlyBlocked: boolean;
  retryAfterSeconds: number;
  pairOrAccountCount: number;
  ipCount: number;
}

export interface LoginRateLimitDiagnostics {
  primarySize: number;
  overflowSize: number;
  overflowByScope: Record<LoginRateLimitScope, number>;
  retiringSize: number;
  activeBlockedCount: number;
  totalPendingCount: number;
}

export interface LoginRateLimitEntryState {
  active: {
    location: 'primary' | 'overflow';
    overflowSlotIndex: number;
    epochId: number;
    failures: number;
    pending: number;
    resetAt: number;
  } | null;
  retiring: Array<{
    epochId: number;
    failures: number;
    pending: number;
    resetAt: number;
  }>;
}

const globalForRateLimiter = globalThis as unknown as {
  loginRateLimitState?: LoginRateLimitState;
};

function createEmptyOverflowTables(): Record<LoginRateLimitScope, Array<RateLimitBucketEntry | null>> {
  return {
    PAIR: new Array<RateLimitBucketEntry | null>(DEFAULT_OVERFLOW_SLOTS_PER_SCOPE).fill(null),
    IP: new Array<RateLimitBucketEntry | null>(DEFAULT_OVERFLOW_SLOTS_PER_SCOPE).fill(null),
    ACCOUNT: new Array<RateLimitBucketEntry | null>(DEFAULT_OVERFLOW_SLOTS_PER_SCOPE).fill(null),
  };
}

function getRateLimitState(): LoginRateLimitState {
  const existing = globalForRateLimiter.loginRateLimitState;
  if (
    !existing ||
    !(existing.primary instanceof Map) ||
    !(existing.retiring instanceof Map) ||
    !existing.overflow ||
    !Array.isArray(existing.overflow.PAIR) ||
    !Array.isArray(existing.overflow.IP) ||
    !Array.isArray(existing.overflow.ACCOUNT)
  ) {
    globalForRateLimiter.loginRateLimitState = {
      primary: new Map<string, RateLimitBucketEntry>(),
      overflow: createEmptyOverflowTables(),
      retiring: new Map<number, RateLimitBucketEntry>(),
      nextEpochId: 1,
    };
  }
  return globalForRateLimiter.loginRateLimitState!;
}

function parsePositiveIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw || raw.trim() === '') return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/**
 * Lê `LOGIN_TRUSTED_PROXY_HOPS` de forma fail-closed: valores malformados,
 * negativos ou fora de faixa retornam 0 (proxies não confiáveis).
 */
export function parseTrustedProxyHops(raw: string | undefined): number {
  if (!raw || raw.trim() === '') return 0;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) return 0;
  return parsed;
}

/**
 * Lê a configuração ativa de rate limiting e confiança de proxy reverso a partir do ambiente.
 */
export function getLoginRateLimitConfig(): LoginRateLimitConfig {
  return {
    windowMs: parsePositiveIntEnv(
      process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
      DEFAULT_LOGIN_WINDOW_MS,
      1000,
      24 * 60 * 60 * 1000
    ),
    maxAttemptsPerPair: parsePositiveIntEnv(
      process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_PAIR,
      DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR,
      1,
      1000
    ),
    maxAttemptsPerIp: parsePositiveIntEnv(
      process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_IP,
      DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP,
      1,
      10_000
    ),
    trustedProxyHops: parseTrustedProxyHops(process.env.LOGIN_TRUSTED_PROXY_HOPS),
    maxStoreEntries: DEFAULT_MAX_TRACKED_RATE_LIMIT_ENTRIES,
    maxOverflowSlotsPerScope: DEFAULT_OVERFLOW_SLOTS_PER_SCOPE,
  };
}

function getEffectiveConfig(options?: LoginRateLimitOptions): LoginRateLimitConfig {
  const base = getLoginRateLimitConfig();
  const merged = { ...base, ...options?.config };
  const clampedOverflow = Math.max(
    1,
    Math.min(DEFAULT_OVERFLOW_SLOTS_PER_SCOPE, Math.trunc(merged.maxOverflowSlotsPerScope))
  );
  return {
    ...merged,
    maxStoreEntries: Math.max(1, Math.trunc(merged.maxStoreEntries)),
    maxOverflowSlotsPerScope: clampedOverflow,
  };
}

/**
 * Normaliza e valida estritamente um candidato de IP (IPv4, IPv4:porta, [IPv6],
 * [IPv6]:porta ou ::ffff:IPv4) via net.isIP(). Rejeita strings com caracteres
 * extras após `]` ou portas fora de 1..65535.
 */
export function normalizeIpCandidate(raw: string): string | null {
  let clean = raw.trim();
  if (!clean) return null;

  if (clean.includes('[') || clean.includes(']')) {
    const bracketMatch = clean.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
    if (!bracketMatch) return null;
    if (bracketMatch[2] !== undefined) {
      const port = Number.parseInt(bracketMatch[2], 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    }
    clean = bracketMatch[1];
  } else {
    const ipv4PortMatch = clean.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
    if (ipv4PortMatch) {
      const port = Number.parseInt(ipv4PortMatch[2], 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      clean = ipv4PortMatch[1];
    }
  }

  if (clean.toLowerCase().startsWith('::ffff:')) {
    const mapped = clean.slice(7);
    if (net.isIPv4(mapped)) {
      clean = mapped;
    }
  }

  return net.isIP(clean) !== 0 ? clean : null;
}

/**
 * Resolve o IP real do cliente SOMENTE quando `trustedProxyHops >= 1` e o sufixo
 * confiável de `X-Forwarded-For` é posicionalmente válido da direita para a esquerda.
 * Nunca filtra elementos inválidos antes de indexar e nunca fabrica IP sintético
 * compartilhado quando o IP não é verificável (`ip: null`).
 */
export function resolveLoginClientIp(
  req: Pick<Request, 'headers'> | Request | null | undefined,
  trustedProxyHops = getLoginRateLimitConfig().trustedProxyHops
): LoginClientIpResolution {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops <= 0 || trustedProxyHops > 10) {
    return { ip: null, trustedProxyResolved: false, resolutionStatus: 'PROXY_NOT_TRUSTED' };
  }

  const xffRaw =
    req && typeof req === 'object' && req.headers && typeof req.headers.get === 'function'
      ? req.headers.get('x-forwarded-for')
      : null;

  if (!xffRaw || xffRaw.trim() === '') {
    return { ip: null, trustedProxyResolved: false, resolutionStatus: 'MISSING_HEADER' };
  }

  const rawSegments = xffRaw.split(',');
  const targetIndex = rawSegments.length - trustedProxyHops;
  if (targetIndex < 0) {
    return { ip: null, trustedProxyResolved: false, resolutionStatus: 'INSUFFICIENT_HOPS' };
  }

  let resolvedClientIp: string | null = null;
  for (let i = targetIndex; i < rawSegments.length; i++) {
    const parsedIp = normalizeIpCandidate(rawSegments[i]);
    if (!parsedIp) {
      return { ip: null, trustedProxyResolved: false, resolutionStatus: 'MALFORMED_CHAIN' };
    }
    if (i === targetIndex) {
      resolvedClientIp = parsedIp;
    }
  }

  if (!resolvedClientIp) {
    return { ip: null, trustedProxyResolved: false, resolutionStatus: 'MALFORMED_CHAIN' };
  }

  return {
    ip: resolvedClientIp,
    trustedProxyResolved: true,
    resolutionStatus: 'TRUSTED_PROXY_IP',
  };
}

function hashFnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function buildIpBucketKey(clientIp: string): string {
  return `ip:${clientIp}`;
}

export function buildPairBucketKey(clientIp: string, normalizedAccount: string): string {
  return `pair:${clientIp}:${normalizedAccount}`;
}

export function buildAccountBucketKey(normalizedAccount: string): string {
  return `acct:${normalizedAccount}`;
}

function buildTargetBuckets(clientIp: string | null, normalizedAccount: string, cfg: LoginRateLimitConfig): TargetBucketSpec[] {
  if (clientIp !== null) {
    return [
      {
        scope: 'PAIR',
        identityKey: buildPairBucketKey(clientIp, normalizedAccount),
        limit: cfg.maxAttemptsPerPair,
        resetOnSuccess: true,
      },
      {
        scope: 'IP',
        identityKey: buildIpBucketKey(clientIp),
        limit: cfg.maxAttemptsPerIp,
        resetOnSuccess: false,
      },
    ];
  }

  return [
    {
      scope: 'ACCOUNT',
      identityKey: buildAccountBucketKey(normalizedAccount),
      limit: cfg.maxAttemptsPerPair,
      resetOnSuccess: true,
    },
  ];
}

function getBucketLimitByScope(scope: LoginRateLimitScope, cfg: LoginRateLimitConfig): number {
  return scope === 'IP' ? cfg.maxAttemptsPerIp : cfg.maxAttemptsPerPair;
}

function isEntryBlocked(entry: RateLimitBucketEntry, cfg: LoginRateLimitConfig): boolean {
  return entry.failures >= getBucketLimitByScope(entry.scope, cfg);
}

/**
 * Trata entrada expirada preservando gerações com reservas pendentes na tabela
 * `retiring` (mesmo epochId e mesmos contadores, nunca sobrescritas) e limpando
 * definitivamente entradas expiradas ociosas (`pending === 0`).
 */
function retireOrPurgeIfExpired(
  state: LoginRateLimitState,
  entry: RateLimitBucketEntry,
  now: number
): boolean {
  if (now < entry.resetAt) return false;
  if (entry.pending > 0) {
    state.retiring.set(entry.epochId, entry);
  }
  return true;
}

function purgeOrRetireExpiredInPrimary(state: LoginRateLimitState, now: number): void {
  for (const [key, entry] of state.primary.entries()) {
    if (retireOrPurgeIfExpired(state, entry, now)) {
      state.primary.delete(key);
    }
  }
}

function ensurePrimaryCapacityForInsert(
  state: LoginRateLimitState,
  now: number,
  cfg: LoginRateLimitConfig
): boolean {
  if (state.primary.size < cfg.maxStoreEntries) return true;

  purgeOrRetireExpiredInPrimary(state, now);
  if (state.primary.size < cfg.maxStoreEntries) return true;

  for (const [candidateKey, entry] of state.primary.entries()) {
    if (entry.pending === 0 && !isEntryBlocked(entry, cfg)) {
      state.primary.delete(candidateKey);
      if (state.primary.size < cfg.maxStoreEntries) return true;
    }
  }

  return state.primary.size < cfg.maxStoreEntries;
}

function refreshPrimaryLruOrder(state: LoginRateLimitState, key: string, entry: RateLimitBucketEntry): void {
  state.primary.delete(key);
  state.primary.set(key, entry);
}

interface OverflowLookupResult {
  matchedEntry: RateLimitBucketEntry | null;
  matchedSlotIndex: number;
  firstEmptySlotIndex: number | null;
}

/**
 * Busca exata por `identityKey` no overflow do escopo via endereçamento aberto
 * com sondagem linear circular até `maxOverflowSlotsPerScope` (padrão 256).
 * Preserva identidade integral da chave e nunca agrega chaves distintas.
 */
function lookupOverflowByIdentity(
  state: LoginRateLimitState,
  scope: LoginRateLimitScope,
  identityKey: string,
  now: number,
  maxSlots: number
): OverflowLookupResult {
  const table = state.overflow[scope];
  const start = hashFnv1a(identityKey) % maxSlots;
  let firstEmptySlotIndex: number | null = null;

  for (let offset = 0; offset < maxSlots; offset++) {
    const idx = (start + offset) % maxSlots;
    const slot = table[idx];
    if (!slot) {
      if (firstEmptySlotIndex === null) firstEmptySlotIndex = idx;
      continue;
    }

    if (retireOrPurgeIfExpired(state, slot, now)) {
      table[idx] = null;
      if (firstEmptySlotIndex === null) firstEmptySlotIndex = idx;
      continue;
    }

    if (slot.identityKey === identityKey) {
      return {
        matchedEntry: slot,
        matchedSlotIndex: idx,
        firstEmptySlotIndex,
      };
    }
  }

  return {
    matchedEntry: null,
    matchedSlotIndex: -1,
    firstEmptySlotIndex,
  };
}

function locateActiveTargetEntry(
  state: LoginRateLimitState,
  target: TargetBucketSpec,
  now: number,
  cfg: LoginRateLimitConfig
):
  | { mapKind: 'primary'; entry: RateLimitBucketEntry; overflowSlotIndex: -1 }
  | { mapKind: 'overflow'; entry: RateLimitBucketEntry; overflowSlotIndex: number }
  | { mapKind: 'none'; firstEmptyOverflowSlotIndex: number | null } {
  const pEntry = state.primary.get(target.identityKey);
  if (pEntry) {
    if (!retireOrPurgeIfExpired(state, pEntry, now)) {
      return { mapKind: 'primary', entry: pEntry, overflowSlotIndex: -1 };
    }
    state.primary.delete(target.identityKey);
  }

  const ovfLookup = lookupOverflowByIdentity(
    state,
    target.scope,
    target.identityKey,
    now,
    cfg.maxOverflowSlotsPerScope
  );
  if (ovfLookup.matchedEntry) {
    return {
      mapKind: 'overflow',
      entry: ovfLookup.matchedEntry,
      overflowSlotIndex: ovfLookup.matchedSlotIndex,
    };
  }

  return { mapKind: 'none', firstEmptyOverflowSlotIndex: ovfLookup.firstEmptySlotIndex };
}

function findEvictableOrMinResetOverflow(
  table: Array<RateLimitBucketEntry | null>,
  identityKey: string,
  maxSlots: number,
  cfg: LoginRateLimitConfig,
  now: number
): { evictIndex: number | null; minResetAt: number } {
  const start = hashFnv1a(identityKey) % maxSlots;
  let evictIndex: number | null = null;
  let oldestEvictReset = Infinity;
  let minActiveReset = now + cfg.windowMs;
  let foundActive = false;

  for (let offset = 0; offset < maxSlots; offset++) {
    const idx = (start + offset) % maxSlots;
    const slot = table[idx];
    if (!slot) continue;

    if (!foundActive || slot.resetAt < minActiveReset) {
      minActiveReset = slot.resetAt;
      foundActive = true;
    }

    if (slot.pending === 0 && !isEntryBlocked(slot, cfg)) {
      if (slot.resetAt < oldestEvictReset) {
        oldestEvictReset = slot.resetAt;
        evictIndex = idx;
      }
    }
  }

  return { evictIndex, minResetAt: minActiveReset };
}

function locateEntryForSettlement(
  state: LoginRateLimitState,
  slot: ReservedBucketSlot
): { source: 'retiring' | 'primary' | 'overflow'; entry: RateLimitBucketEntry } | null {
  const retired = state.retiring.get(slot.epochId);
  if (retired && retired.identityKey === slot.identityKey) {
    return { source: 'retiring', entry: retired };
  }

  if (slot.mapKind === 'primary') {
    const pEntry = state.primary.get(slot.identityKey);
    if (pEntry && pEntry.epochId === slot.epochId) {
      return { source: 'primary', entry: pEntry };
    }
    return null;
  }

  const table = state.overflow[slot.scope];
  const oEntry = table[slot.overflowSlotIndex];
  if (oEntry && oEntry.epochId === slot.epochId && oEntry.identityKey === slot.identityKey) {
    return { source: 'overflow', entry: oEntry };
  }
  return null;
}

function removeEntryFromStorage(
  state: LoginRateLimitState,
  source: 'retiring' | 'primary' | 'overflow',
  slot: ReservedBucketSlot
): void {
  if (source === 'retiring') {
    state.retiring.delete(slot.epochId);
  } else if (source === 'primary') {
    const cur = state.primary.get(slot.identityKey);
    if (cur && cur.epochId === slot.epochId) {
      state.primary.delete(slot.identityKey);
    }
  } else {
    const table = state.overflow[slot.scope];
    const cur = table[slot.overflowSlotIndex];
    if (cur && cur.epochId === slot.epochId && cur.identityKey === slot.identityKey) {
      table[slot.overflowSlotIndex] = null;
    }
  }
}

function rollbackReservedSlots(state: LoginRateLimitState, slots: ReservedBucketSlot[], now: number): void {
  for (const slot of slots) {
    const found = locateEntryForSettlement(state, slot);
    if (!found) continue;
    found.entry.pending = Math.max(0, found.entry.pending - 1);
    if (found.entry.pending === 0 && (found.entry.failures === 0 || now >= found.entry.resetAt || found.source === 'retiring')) {
      removeEntryFromStorage(state, found.source, slot);
    }
  }
}

/**
 * Verifica e reserva atomicamente capacidade de tentativa ANTES das operações
 * assíncronas de banco e bcrypt, isolando identidades no overflow e gerações
 * expiradas com reservas ainda em voo (`retiring`).
 */
export function acquireLoginRateLimitReservation(
  req: Pick<Request, 'headers'> | Request | null | undefined,
  normalizedAccount: string,
  options?: LoginRateLimitOptions
): LoginRateLimitReservation {
  const now = options?.now ?? Date.now();
  const acquiredWithCustomNow = options?.now !== undefined;
  const cfg = getEffectiveConfig(options);
  const ipResolution = resolveLoginClientIp(req, cfg.trustedProxyHops);
  const state = getRateLimitState();
  const targets = buildTargetBuckets(ipResolution.ip, normalizedAccount, cfg);

  // Fase 1: leitura e retirada/limpeza segura de janelas expiradas
  for (const target of targets) {
    const located = locateActiveTargetEntry(state, target, now, cfg);
    if (located.mapKind !== 'none' && located.entry.failures + located.entry.pending >= target.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((located.entry.resetAt - now) / 1000)),
        blockedScope: target.scope,
        clientIp: ipResolution.ip,
        trustedProxyResolved: ipResolution.trustedProxyResolved,
        ipResolutionStatus: ipResolution.resolutionStatus,
        capacitySaturated: located.mapKind === 'overflow' || state.primary.size >= cfg.maxStoreEntries,
        overflowExhausted: false,
        settled: true,
        acquiredNow: now,
        acquiredWithCustomNow,
        windowMs: cfg.windowMs,
        slots: [],
      };
    }
  }

  // Fase 2: alocação atômica síncrona de reserva com preservação integral de identidade
  let capacitySaturated = false;
  const reservedSlots: ReservedBucketSlot[] = [];

  for (const target of targets) {
    const located = locateActiveTargetEntry(state, target, now, cfg);
    if (located.mapKind === 'primary') {
      located.entry.pending += 1;
      refreshPrimaryLruOrder(state, target.identityKey, located.entry);
      reservedSlots.push({
        scope: target.scope,
        identityKey: target.identityKey,
        mapKind: 'primary',
        overflowSlotIndex: -1,
        epochId: located.entry.epochId,
        limit: target.limit,
        resetOnSuccess: target.resetOnSuccess,
      });
      continue;
    }

    if (located.mapKind === 'overflow') {
      capacitySaturated = true;
      located.entry.pending += 1;
      reservedSlots.push({
        scope: target.scope,
        identityKey: target.identityKey,
        mapKind: 'overflow',
        overflowSlotIndex: located.overflowSlotIndex,
        epochId: located.entry.epochId,
        limit: target.limit,
        resetOnSuccess: target.resetOnSuccess,
      });
      continue;
    }

    const canUsePrimary = ensurePrimaryCapacityForInsert(state, now, cfg);
    if (canUsePrimary) {
      const created: RateLimitBucketEntry = {
        identityKey: target.identityKey,
        scope: target.scope,
        epochId: state.nextEpochId++,
        failures: 0,
        pending: 1,
        resetAt: now + cfg.windowMs,
      };
      state.primary.set(target.identityKey, created);
      reservedSlots.push({
        scope: target.scope,
        identityKey: target.identityKey,
        mapKind: 'primary',
        overflowSlotIndex: -1,
        epochId: created.epochId,
        limit: target.limit,
        resetOnSuccess: target.resetOnSuccess,
      });
      continue;
    }

    // Store primária 100% ocupada por bloqueios/reservas ativas -> usa overflow por endereçamento aberto
    capacitySaturated = true;
    const table = state.overflow[target.scope];
    let targetSlotIndex = located.firstEmptyOverflowSlotIndex;
    let minActiveResetAt = now + cfg.windowMs;

    if (targetSlotIndex === null) {
      const reclaimScan = findEvictableOrMinResetOverflow(
        table,
        target.identityKey,
        cfg.maxOverflowSlotsPerScope,
        cfg,
        now
      );
      targetSlotIndex = reclaimScan.evictIndex;
      minActiveResetAt = reclaimScan.minResetAt;
    }

    if (targetSlotIndex === null) {
      // Overflow do escopo 100% ocupado exclusivamente com bloqueios/reservas ativas:
      // política fail-closed explícita sem reaproveitar contador de outra identidade.
      rollbackReservedSlots(state, reservedSlots, now);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((minActiveResetAt - now) / 1000)),
        blockedScope: target.scope,
        clientIp: ipResolution.ip,
        trustedProxyResolved: ipResolution.trustedProxyResolved,
        ipResolutionStatus: ipResolution.resolutionStatus,
        capacitySaturated: true,
        overflowExhausted: true,
        settled: true,
        acquiredNow: now,
        acquiredWithCustomNow,
        windowMs: cfg.windowMs,
        slots: [],
      };
    }

    const createdOvf: RateLimitBucketEntry = {
      identityKey: target.identityKey,
      scope: target.scope,
      epochId: state.nextEpochId++,
      failures: 0,
      pending: 1,
      resetAt: now + cfg.windowMs,
    };
    table[targetSlotIndex] = createdOvf;
    reservedSlots.push({
      scope: target.scope,
      identityKey: target.identityKey,
      mapKind: 'overflow',
      overflowSlotIndex: targetSlotIndex,
      epochId: createdOvf.epochId,
      limit: target.limit,
      resetOnSuccess: target.resetOnSuccess,
    });
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    clientIp: ipResolution.ip,
    trustedProxyResolved: ipResolution.trustedProxyResolved,
    ipResolutionStatus: ipResolution.resolutionStatus,
    capacitySaturated,
    overflowExhausted: false,
    settled: false,
    acquiredNow: now,
    acquiredWithCustomNow,
    windowMs: cfg.windowMs,
    slots: reservedSlots,
  };
}

/**
 * Converte uma reserva ativa em falha contabilizada na sua geração (`epochId`).
 * Reservas de gerações expiradas não contaminam novas gerações e são limpas ao zerar `pending`.
 */
export function commitLoginFailure(
  reservation: LoginRateLimitReservation,
  now?: number
): LoginFailureCommitResult {
  if (reservation.settled) {
    return { blocked: false, newlyBlocked: false, retryAfterSeconds: 0, pairOrAccountCount: 0, ipCount: 0 };
  }
  reservation.settled = true;

  const settleNow = now ?? (reservation.acquiredWithCustomNow ? reservation.acquiredNow : Date.now());
  const state = getRateLimitState();
  let blocked = false;
  let newlyBlocked = false;
  let retryAfterMs = 0;
  let pairOrAccountCount = 0;
  let ipCount = 0;

  for (const slot of reservation.slots) {
    const located = locateEntryForSettlement(state, slot);
    if (!located) continue;

    const { source, entry } = located;
    entry.pending = Math.max(0, entry.pending - 1);
    const prevFailures = entry.failures;
    entry.failures += 1;

    const isStillActiveGeneration = source !== 'retiring' && settleNow < entry.resetAt;
    if (isStillActiveGeneration) {
      if (entry.failures >= slot.limit) {
        blocked = true;
        retryAfterMs = Math.max(retryAfterMs, entry.resetAt - settleNow);
        if (prevFailures < slot.limit) {
          newlyBlocked = true;
        }
      }
      if (source === 'primary') {
        refreshPrimaryLruOrder(state, slot.identityKey, entry);
      }
    } else if (entry.pending === 0) {
      removeEntryFromStorage(state, source, slot);
    }

    if (slot.scope === 'IP') {
      ipCount = entry.failures;
    } else {
      pairOrAccountCount = entry.failures;
    }
  }

  return {
    blocked,
    newlyBlocked,
    retryAfterSeconds: blocked ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : 0,
    pairOrAccountCount,
    ipCount,
  };
}

/**
 * Conclui uma reserva após autenticação válida: zera falhas apenas da mesma
 * identidade e da mesma geração (`epochId`), nunca afetando outra identidade
 * colidente nem nova geração ativa.
 */
export function commitLoginSuccess(reservation: LoginRateLimitReservation, now?: number): void {
  if (reservation.settled) return;
  reservation.settled = true;

  const settleNow = now ?? (reservation.acquiredWithCustomNow ? reservation.acquiredNow : Date.now());
  const state = getRateLimitState();

  for (const slot of reservation.slots) {
    const located = locateEntryForSettlement(state, slot);
    if (!located) continue;

    const { source, entry } = located;
    entry.pending = Math.max(0, entry.pending - 1);
    if (slot.resetOnSuccess) {
      entry.failures = 0;
    }

    const expiredOrRetired = source === 'retiring' || settleNow >= entry.resetAt;
    if (entry.pending === 0 && (entry.failures === 0 || expiredOrRetired)) {
      removeEntryFromStorage(state, source, slot);
    }
  }
}

/**
 * Libera reservas pendentes em caso de erro inesperado (exceção de banco/bcrypt),
 * de forma estritamente idempotente e isolada por geração (`epochId`).
 */
export function releaseLoginRateLimitReservation(reservation: LoginRateLimitReservation, now?: number): void {
  if (reservation.settled) return;
  reservation.settled = true;

  const settleNow = now ?? (reservation.acquiredWithCustomNow ? reservation.acquiredNow : Date.now());
  const state = getRateLimitState();

  for (const slot of reservation.slots) {
    const located = locateEntryForSettlement(state, slot);
    if (!located) continue;

    const { source, entry } = located;
    entry.pending = Math.max(0, entry.pending - 1);

    const expiredOrRetired = source === 'retiring' || settleNow >= entry.resetAt;
    if (entry.pending === 0 && (entry.failures === 0 || expiredOrRetired)) {
      removeEntryFromStorage(state, source, slot);
    }
  }
}

/**
 * Retorna contadores diagnósticos da store em memória (sem expor identidades sensíveis).
 */
export function getLoginRateLimitDiagnostics(options?: LoginRateLimitOptions): LoginRateLimitDiagnostics {
  const now = options?.now ?? Date.now();
  const cfg = getEffectiveConfig(options);
  const state = getRateLimitState();

  let activeBlockedCount = 0;
  let totalPendingCount = 0;

  for (const entry of state.primary.values()) {
    totalPendingCount += entry.pending;
    if (now < entry.resetAt && isEntryBlocked(entry, cfg)) {
      activeBlockedCount += 1;
    }
  }

  const overflowByScope: Record<LoginRateLimitScope, number> = { PAIR: 0, IP: 0, ACCOUNT: 0 };
  let overflowSize = 0;

  for (const scope of ['PAIR', 'IP', 'ACCOUNT'] as const) {
    for (const slot of state.overflow[scope]) {
      if (!slot) continue;
      overflowByScope[scope] += 1;
      overflowSize += 1;
      totalPendingCount += slot.pending;
      if (now < slot.resetAt && isEntryBlocked(slot, cfg)) {
        activeBlockedCount += 1;
      }
    }
  }

  for (const entry of state.retiring.values()) {
    totalPendingCount += entry.pending;
  }

  return {
    primarySize: state.primary.size,
    overflowSize,
    overflowByScope,
    retiringSize: state.retiring.size,
    activeBlockedCount,
    totalPendingCount,
  };
}

/**
 * Inspeciona estado ativo e gerações aposentadas de uma identidade específica para auditoria em testes.
 */
export function getLoginRateLimitEntryState(
  scope: LoginRateLimitScope,
  identityKey: string,
  options?: LoginRateLimitOptions
): LoginRateLimitEntryState {
  const cfg = getEffectiveConfig(options);
  const state = getRateLimitState();

  let active: LoginRateLimitEntryState['active'] = null;
  const pEntry = state.primary.get(identityKey);
  if (pEntry) {
    active = {
      location: 'primary',
      overflowSlotIndex: -1,
      epochId: pEntry.epochId,
      failures: pEntry.failures,
      pending: pEntry.pending,
      resetAt: pEntry.resetAt,
    };
  } else {
    const table = state.overflow[scope];
    for (let i = 0; i < cfg.maxOverflowSlotsPerScope; i++) {
      const slot = table[i];
      if (slot && slot.identityKey === identityKey) {
        active = {
          location: 'overflow',
          overflowSlotIndex: i,
          epochId: slot.epochId,
          failures: slot.failures,
          pending: slot.pending,
          resetAt: slot.resetAt,
        };
        break;
      }
    }
  }

  const retiring: LoginRateLimitEntryState['retiring'] = [];
  for (const entry of state.retiring.values()) {
    if (entry.scope === scope && entry.identityKey === identityKey) {
      retiring.push({
        epochId: entry.epochId,
        failures: entry.failures,
        pending: entry.pending,
        resetAt: entry.resetAt,
      });
    }
  }

  return { active, retiring };
}

/**
 * Limpa completamente o armazenamento em memória (exclusivo para isolamento entre testes).
 */
export function resetLoginRateLimitStore(): void {
  const state = getRateLimitState();
  state.primary.clear();
  state.overflow = createEmptyOverflowTables();
  state.retiring.clear();
  state.nextEpochId = 1;
}
