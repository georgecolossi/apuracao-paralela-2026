import net from 'node:net';

export const DEFAULT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR = 5;
export const DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP = 20;
export const DEFAULT_MAX_TRACKED_RATE_LIMIT_ENTRIES = 10_000;
const OVERFLOW_SLOTS_PER_SCOPE = 256;

export type IpResolutionStatus =
  | 'TRUSTED_PROXY_IP'
  | 'PROXY_NOT_TRUSTED'
  | 'MISSING_HEADER'
  | 'MALFORMED_CHAIN'
  | 'INSUFFICIENT_HOPS';

export type LoginRateLimitScope = 'PAIR' | 'IP' | 'ACCOUNT';

interface RateLimitBucketEntry {
  epochId: number;
  failures: number;
  pending: number;
  resetAt: number;
}

interface LoginRateLimitState {
  primary: Map<string, RateLimitBucketEntry>;
  overflow: Map<string, RateLimitBucketEntry>;
  nextEpochId: number;
}

interface TargetBucketSpec {
  scope: LoginRateLimitScope;
  primaryKey: string;
  overflowKey: string;
  limit: number;
  resetOnSuccess: boolean;
}

interface ReservedBucketSlot {
  scope: LoginRateLimitScope;
  mapKind: 'primary' | 'overflow';
  storeKey: string;
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
  settled: boolean;
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
  activeBlockedCount: number;
  totalPendingCount: number;
}

const globalForRateLimiter = globalThis as unknown as {
  loginRateLimitState?: LoginRateLimitState;
};

function getRateLimitState(): LoginRateLimitState {
  if (!globalForRateLimiter.loginRateLimitState) {
    globalForRateLimiter.loginRateLimitState = {
      primary: new Map<string, RateLimitBucketEntry>(),
      overflow: new Map<string, RateLimitBucketEntry>(),
      nextEpochId: 1,
    };
  }
  return globalForRateLimiter.loginRateLimitState;
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
 * Nunca filtra elementos inválidos antes de indexar (evita deslocamento silencioso
 * para entradas à esquerda controladas pelo atacante) e nunca fabrica IP sintético
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

  // Preserva posições exatas: qualquer entrada vazia ou malformada no sufixo
  // confiável invalida toda a resolução em modo fail-safe.
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

function buildIpBucketKey(clientIp: string): string {
  return `ip:${clientIp}`;
}

function buildPairBucketKey(clientIp: string, normalizedAccount: string): string {
  return `pair:${clientIp}:${normalizedAccount}`;
}

function buildAccountBucketKey(normalizedAccount: string): string {
  return `acct:${normalizedAccount}`;
}

function buildOverflowBucketKey(scope: LoginRateLimitScope, primaryKey: string): string {
  const slot = hashFnv1a(primaryKey) % OVERFLOW_SLOTS_PER_SCOPE;
  return `ovf:${scope}:${slot}`;
}

function buildTargetBuckets(clientIp: string | null, normalizedAccount: string, cfg: LoginRateLimitConfig): TargetBucketSpec[] {
  if (clientIp !== null) {
    const pairKey = buildPairBucketKey(clientIp, normalizedAccount);
    const ipKey = buildIpBucketKey(clientIp);
    return [
      {
        scope: 'PAIR',
        primaryKey: pairKey,
        overflowKey: buildOverflowBucketKey('PAIR', pairKey),
        limit: cfg.maxAttemptsPerPair,
        resetOnSuccess: true,
      },
      {
        scope: 'IP',
        primaryKey: ipKey,
        overflowKey: buildOverflowBucketKey('IP', ipKey),
        limit: cfg.maxAttemptsPerIp,
        resetOnSuccess: false,
      },
    ];
  }

  // Fallback seguro quando não há IP confiável: protege cada conta individualmente
  // sem compartilhar bucket global entre usuários distintos.
  const accountKey = buildAccountBucketKey(normalizedAccount);
  return [
    {
      scope: 'ACCOUNT',
      primaryKey: accountKey,
      overflowKey: buildOverflowBucketKey('ACCOUNT', accountKey),
      limit: cfg.maxAttemptsPerPair,
      resetOnSuccess: true,
    },
  ];
}

function getBucketLimitByKey(key: string, cfg: LoginRateLimitConfig): number {
  if (key.startsWith('ip:') || key.startsWith('ovf:IP:')) {
    return cfg.maxAttemptsPerIp;
  }
  return cfg.maxAttemptsPerPair;
}

function isEntryBlocked(key: string, entry: RateLimitBucketEntry, cfg: LoginRateLimitConfig): boolean {
  return entry.failures >= getBucketLimitByKey(key, cfg);
}

function getActiveEntry(map: Map<string, RateLimitBucketEntry>, key: string, now: number): RateLimitBucketEntry | null {
  const existing = map.get(key);
  if (!existing) return null;
  if (now >= existing.resetAt) {
    // Só remove se não houver reservas ativas pendentes; caso contrário preserva
    // a expiração natural da janela sem quebrar limpeza de reservas em voo.
    if (existing.pending === 0) {
      map.delete(key);
    }
    return null;
  }
  return existing;
}

function purgeExpiredEntries(map: Map<string, RateLimitBucketEntry>, now: number): void {
  for (const [key, entry] of map.entries()) {
    if (now >= entry.resetAt && entry.pending === 0) {
      map.delete(key);
    }
  }
}

/**
 * Garante capacidade na store primária sem JAMAIS remover bloqueios ativos
 * nem entradas com reservas em voo (`pending > 0`). Retorna `true` se há vaga na
 * primária ou `false` caso esteja 100% saturada com bloqueios/reservas ativas.
 */
function ensurePrimaryCapacityForInsert(
  primary: Map<string, RateLimitBucketEntry>,
  now: number,
  cfg: LoginRateLimitConfig
): boolean {
  if (primary.size < cfg.maxStoreEntries) return true;

  purgeExpiredEntries(primary, now);
  if (primary.size < cfg.maxStoreEntries) return true;

  for (const [candidateKey, entry] of primary.entries()) {
    if (entry.pending === 0 && !isEntryBlocked(candidateKey, entry, cfg)) {
      primary.delete(candidateKey);
      if (primary.size < cfg.maxStoreEntries) return true;
    }
  }

  return primary.size < cfg.maxStoreEntries;
}

function refreshLruOrder(map: Map<string, RateLimitBucketEntry>, key: string, entry: RateLimitBucketEntry): void {
  map.delete(key);
  map.set(key, entry);
}

function locateActiveTargetEntry(
  state: LoginRateLimitState,
  target: TargetBucketSpec,
  now: number
): { mapKind: 'primary' | 'overflow'; storeKey: string; entry: RateLimitBucketEntry } | null {
  const primaryEntry = getActiveEntry(state.primary, target.primaryKey, now);
  if (primaryEntry) {
    return { mapKind: 'primary', storeKey: target.primaryKey, entry: primaryEntry };
  }
  const overflowEntry = getActiveEntry(state.overflow, target.overflowKey, now);
  if (overflowEntry) {
    return { mapKind: 'overflow', storeKey: target.overflowKey, entry: overflowEntry };
  }
  return null;
}

function getEffectiveConfig(options?: LoginRateLimitOptions): LoginRateLimitConfig {
  return {
    ...getLoginRateLimitConfig(),
    ...options?.config,
  };
}

/**
 * Verifica e reserva atomicamente capacidade de tentativa ANTES das operações
 * assíncronas de banco e bcrypt, eliminando corridas TOCTOU em rajadas concorrentes.
 */
export function acquireLoginRateLimitReservation(
  req: Pick<Request, 'headers'> | Request | null | undefined,
  normalizedAccount: string,
  options?: LoginRateLimitOptions
): LoginRateLimitReservation {
  const now = options?.now ?? Date.now();
  const cfg = getEffectiveConfig(options);
  const ipResolution = resolveLoginClientIp(req, cfg.trustedProxyHops);
  const state = getRateLimitState();
  const targets = buildTargetBuckets(ipResolution.ip, normalizedAccount, cfg);

  // Fase 1 (somente leitura): checa todos os buckets aplicáveis antes de mutar qualquer um
  for (const target of targets) {
    const located = locateActiveTargetEntry(state, target, now);
    if (located && located.entry.failures + located.entry.pending >= target.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((located.entry.resetAt - now) / 1000)),
        blockedScope: target.scope,
        clientIp: ipResolution.ip,
        trustedProxyResolved: ipResolution.trustedProxyResolved,
        ipResolutionStatus: ipResolution.resolutionStatus,
        capacitySaturated: state.primary.size >= cfg.maxStoreEntries,
        settled: true,
        windowMs: cfg.windowMs,
        slots: [],
      };
    }
  }

  // Fase 2 (mutação síncrona atômica): reserva slot em cada bucket aplicável
  let capacitySaturated = false;
  const reservedSlots: ReservedBucketSlot[] = [];

  for (const target of targets) {
    const located = locateActiveTargetEntry(state, target, now);
    if (located) {
      if (located.mapKind === 'overflow') {
        capacitySaturated = true;
      }
      located.entry.pending += 1;
      const targetMap = located.mapKind === 'primary' ? state.primary : state.overflow;
      refreshLruOrder(targetMap, located.storeKey, located.entry);
      reservedSlots.push({
        scope: target.scope,
        mapKind: located.mapKind,
        storeKey: located.storeKey,
        epochId: located.entry.epochId,
        limit: target.limit,
        resetOnSuccess: target.resetOnSuccess,
      });
      continue;
    }

    const canUsePrimary = ensurePrimaryCapacityForInsert(state.primary, now, cfg);
    if (canUsePrimary) {
      const existingExpired = state.primary.get(target.primaryKey);
      if (existingExpired && existingExpired.pending === 0 && now >= existingExpired.resetAt) {
        state.primary.delete(target.primaryKey);
      }
      const created: RateLimitBucketEntry = {
        epochId: state.nextEpochId++,
        failures: 0,
        pending: 1,
        resetAt: now + cfg.windowMs,
      };
      state.primary.set(target.primaryKey, created);
      reservedSlots.push({
        scope: target.scope,
        mapKind: 'primary',
        storeKey: target.primaryKey,
        epochId: created.epochId,
        limit: target.limit,
        resetOnSuccess: target.resetOnSuccess,
      });
    } else {
      // Primária 100% ocupada com bloqueios/reservas ativas: isola em tabela de overflow
      // fixa sem remover nenhum bloqueio ativo da tabela primária.
      capacitySaturated = true;
      purgeExpiredEntries(state.overflow, now);
      const ovfExisting = state.overflow.get(target.overflowKey);
      if (ovfExisting && now < ovfExisting.resetAt) {
        ovfExisting.pending += 1;
        refreshLruOrder(state.overflow, target.overflowKey, ovfExisting);
        reservedSlots.push({
          scope: target.scope,
          mapKind: 'overflow',
          storeKey: target.overflowKey,
          epochId: ovfExisting.epochId,
          limit: target.limit,
          resetOnSuccess: target.resetOnSuccess,
        });
      } else {
        const createdOvf: RateLimitBucketEntry = {
          epochId: state.nextEpochId++,
          failures: 0,
          pending: 1,
          resetAt: now + cfg.windowMs,
        };
        state.overflow.set(target.overflowKey, createdOvf);
        reservedSlots.push({
          scope: target.scope,
          mapKind: 'overflow',
          storeKey: target.overflowKey,
          epochId: createdOvf.epochId,
          limit: target.limit,
          resetOnSuccess: target.resetOnSuccess,
        });
      }
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    clientIp: ipResolution.ip,
    trustedProxyResolved: ipResolution.trustedProxyResolved,
    ipResolutionStatus: ipResolution.resolutionStatus,
    capacitySaturated,
    settled: false,
    windowMs: cfg.windowMs,
    slots: reservedSlots,
  };
}

/**
 * Converte uma reserva ativa em falha contabilizada (após credenciais inválidas).
 * Idempotente: chamadas repetidas na mesma reserva não duplicam falhas.
 */
export function commitLoginFailure(
  reservation: LoginRateLimitReservation,
  now = Date.now()
): LoginFailureCommitResult {
  if (reservation.settled) {
    return { blocked: false, newlyBlocked: false, retryAfterSeconds: 0, pairOrAccountCount: 0, ipCount: 0 };
  }
  reservation.settled = true;

  const state = getRateLimitState();
  let blocked = false;
  let newlyBlocked = false;
  let retryAfterMs = 0;
  let pairOrAccountCount = 0;
  let ipCount = 0;

  for (const slot of reservation.slots) {
    const map = slot.mapKind === 'primary' ? state.primary : state.overflow;
    const entry = map.get(slot.storeKey);
    if (!entry || entry.epochId !== slot.epochId) {
      continue;
    }

    entry.pending = Math.max(0, entry.pending - 1);

    if (now >= entry.resetAt && entry.pending === 0) {
      entry.failures = 1;
      entry.resetAt = now + reservation.windowMs;
    } else {
      const prevFailures = entry.failures;
      entry.failures += 1;
      if (entry.failures >= slot.limit && prevFailures < slot.limit) {
        newlyBlocked = true;
      }
    }

    if (entry.failures >= slot.limit) {
      blocked = true;
      retryAfterMs = Math.max(retryAfterMs, entry.resetAt - now);
      if (slot.limit === 1) {
        newlyBlocked = true;
      }
    }

    refreshLruOrder(map, slot.storeKey, entry);

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
 * Conclui uma reserva após login bem-sucedido: libera `pending` e zera as falhas
 * do bucket específico da conta/par sem remover reservas concorrentes ainda em voo.
 */
export function commitLoginSuccess(reservation: LoginRateLimitReservation): void {
  if (reservation.settled) return;
  reservation.settled = true;

  const state = getRateLimitState();
  for (const slot of reservation.slots) {
    const map = slot.mapKind === 'primary' ? state.primary : state.overflow;
    const entry = map.get(slot.storeKey);
    if (!entry || entry.epochId !== slot.epochId) continue;

    entry.pending = Math.max(0, entry.pending - 1);
    if (slot.resetOnSuccess) {
      entry.failures = 0;
    }

    if (entry.failures === 0 && entry.pending === 0) {
      map.delete(slot.storeKey);
    }
  }
}

/**
 * Libera reservas pendentes em caso de erro inesperado (exceção de banco/bcrypt),
 * preservando idempotência caso a reserva já tenha sido encerrada como sucesso ou falha.
 */
export function releaseLoginRateLimitReservation(reservation: LoginRateLimitReservation): void {
  if (reservation.settled) return;
  reservation.settled = true;

  const state = getRateLimitState();
  for (const slot of reservation.slots) {
    const map = slot.mapKind === 'primary' ? state.primary : state.overflow;
    const entry = map.get(slot.storeKey);
    if (!entry || entry.epochId !== slot.epochId) continue;

    entry.pending = Math.max(0, entry.pending - 1);
    if (entry.failures === 0 && entry.pending === 0) {
      map.delete(slot.storeKey);
    }
  }
}

/**
 * Retorna contadores diagnósticos da store em memória (sem expor chaves/contas sensíveis).
 */
export function getLoginRateLimitDiagnostics(options?: LoginRateLimitOptions): LoginRateLimitDiagnostics {
  const now = options?.now ?? Date.now();
  const cfg = getEffectiveConfig(options);
  const state = getRateLimitState();

  let activeBlockedCount = 0;
  let totalPendingCount = 0;

  for (const [k, entry] of state.primary.entries()) {
    totalPendingCount += entry.pending;
    if (now < entry.resetAt && isEntryBlocked(k, entry, cfg)) {
      activeBlockedCount += 1;
    }
  }

  for (const [k, entry] of state.overflow.entries()) {
    totalPendingCount += entry.pending;
    if (now < entry.resetAt && isEntryBlocked(k, entry, cfg)) {
      activeBlockedCount += 1;
    }
  }

  return {
    primarySize: state.primary.size,
    overflowSize: state.overflow.size,
    activeBlockedCount,
    totalPendingCount,
  };
}

/**
 * Limpa completamente o armazenamento em memória (exclusivo para isolamento entre testes).
 */
export function resetLoginRateLimitStore(): void {
  const state = getRateLimitState();
  state.primary.clear();
  state.overflow.clear();
  state.nextEpochId = 1;
}
