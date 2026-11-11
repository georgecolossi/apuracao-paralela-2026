import net from 'node:net';

export const DEFAULT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR = 5;
export const DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP = 20;
const MAX_TRACKED_RATE_LIMIT_ENTRIES = 10_000;

interface RateLimitBucketEntry {
  count: number;
  resetAt: number;
}

export interface LoginRateLimitConfig {
  windowMs: number;
  maxAttemptsPerPair: number;
  maxAttemptsPerIp: number;
  trustedProxyHops: number;
}

export interface LoginRateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  blockedScope?: 'PAIR' | 'IP';
  clientIp: string;
  trustedProxyResolved: boolean;
}

export interface LoginFailureRecordResult {
  blocked: boolean;
  newlyBlocked: boolean;
  retryAfterSeconds: number;
  pairCount: number;
  ipCount: number;
}

const globalForRateLimiter = globalThis as unknown as {
  loginRateLimitStore?: Map<string, RateLimitBucketEntry>;
};

function getRateLimitStore(): Map<string, RateLimitBucketEntry> {
  if (!globalForRateLimiter.loginRateLimitStore) {
    globalForRateLimiter.loginRateLimitStore = new Map<string, RateLimitBucketEntry>();
  }
  return globalForRateLimiter.loginRateLimitStore;
}

function parsePositiveIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/**
 * Lê a configuração ativa de rate limiting e confiança de proxy reverso a partir do ambiente.
 */
export function getLoginRateLimitConfig(): LoginRateLimitConfig {
  return {
    windowMs: parsePositiveIntEnv(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, DEFAULT_LOGIN_WINDOW_MS, 1000, 24 * 60 * 60 * 1000),
    maxAttemptsPerPair: parsePositiveIntEnv(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_PAIR, DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR, 1, 1000),
    maxAttemptsPerIp: parsePositiveIntEnv(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_IP, DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP, 1, 10_000),
    trustedProxyHops: parsePositiveIntEnv(process.env.LOGIN_TRUSTED_PROXY_HOPS, 0, 0, 10)
  };
}

/**
 * Normaliza e valida um candidato de IP (IPv4, [IPv6]:porta ou ::ffff:IPv4) via net.isIP().
 */
export function normalizeIpCandidate(raw: string): string | null {
  let clean = raw.trim();
  if (!clean) return null;

  if (clean.startsWith('[')) {
    const closingIdx = clean.indexOf(']');
    if (closingIdx === -1) return null;
    clean = clean.slice(1, closingIdx);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(clean)) {
    clean = clean.slice(0, clean.lastIndexOf(':'));
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
 * Extrai o IP real do cliente apenas quando `LOGIN_TRUSTED_PROXY_HOPS >= 1`,
 * lendo a cadeia `X-Forwarded-For` da direita para a esquerda para impedir
 * forjamento à esquerda pelo cliente atacante. Sem proxy confiável configurado,
 * cabeçalhos de encaminhamento são ignorados (fail-closed contra rotação de XFF).
 */
export function resolveLoginClientIp(
  req: Pick<Request, 'headers'> | Request | null | undefined,
  trustedProxyHops = getLoginRateLimitConfig().trustedProxyHops
): { ip: string; trustedProxyResolved: boolean } {
  if (trustedProxyHops <= 0) {
    return { ip: 'direct-untrusted', trustedProxyResolved: false };
  }

  const xffRaw =
    req && typeof req === 'object' && req.headers && typeof req.headers.get === 'function'
      ? req.headers.get('x-forwarded-for')
      : null;

  if (xffRaw) {
    const validIps = xffRaw
      .split(',')
      .map(normalizeIpCandidate)
      .filter((ip): ip is string => Boolean(ip));

    const targetIndex = validIps.length - trustedProxyHops;
    if (targetIndex >= 0 && validIps[targetIndex]) {
      return { ip: validIps[targetIndex], trustedProxyResolved: true };
    }
  }

  return { ip: 'unverified-proxy-client', trustedProxyResolved: false };
}

function buildIpBucketKey(clientIp: string): string {
  return `ip:${clientIp}`;
}

function buildPairBucketKey(clientIp: string, normalizedAccount: string): string {
  return `pair:${clientIp}:${normalizedAccount}`;
}

function getActiveBucket(store: Map<string, RateLimitBucketEntry>, key: string, now: number): RateLimitBucketEntry | null {
  const existing = store.get(key);
  if (!existing) return null;
  if (now >= existing.resetAt) {
    store.delete(key);
    return null;
  }
  return existing;
}

function ensureStoreCapacity(store: Map<string, RateLimitBucketEntry>, now: number): void {
  if (store.size < MAX_TRACKED_RATE_LIMIT_ENTRIES) return;

  for (const [k, entry] of store.entries()) {
    if (now >= entry.resetAt) {
      store.delete(k);
    }
  }

  while (store.size >= MAX_TRACKED_RATE_LIMIT_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}

function incrementBucket(
  store: Map<string, RateLimitBucketEntry>,
  key: string,
  windowMs: number,
  now: number
): RateLimitBucketEntry {
  const active = getActiveBucket(store, key, now);
  if (active) {
    active.count += 1;
    // Atualiza ordem LRU
    store.delete(key);
    store.set(key, active);
    return active;
  }

  ensureStoreCapacity(store, now);
  const created: RateLimitBucketEntry = {
    count: 1,
    resetAt: now + windowMs
  };
  store.set(key, created);
  return created;
}

/**
 * Verifica se a origem (IP + par IP/identificador) já excedeu o limite na janela atual.
 */
export function checkLoginRateLimit(
  req: Pick<Request, 'headers'> | Request | null | undefined,
  normalizedAccount: string,
  options?: { now?: number; config?: Partial<LoginRateLimitConfig> }
): LoginRateLimitCheckResult {
  const now = options?.now ?? Date.now();
  const baseCfg = getLoginRateLimitConfig();
  const cfg: LoginRateLimitConfig = { ...baseCfg, ...options?.config };
  const { ip, trustedProxyResolved } = resolveLoginClientIp(req, cfg.trustedProxyHops);

  const store = getRateLimitStore();
  const pairEntry = getActiveBucket(store, buildPairBucketKey(ip, normalizedAccount), now);
  if (pairEntry && pairEntry.count >= cfg.maxAttemptsPerPair) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((pairEntry.resetAt - now) / 1000)),
      blockedScope: 'PAIR',
      clientIp: ip,
      trustedProxyResolved
    };
  }

  const ipEntry = getActiveBucket(store, buildIpBucketKey(ip), now);
  if (ipEntry && ipEntry.count >= cfg.maxAttemptsPerIp) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((ipEntry.resetAt - now) / 1000)),
      blockedScope: 'IP',
      clientIp: ip,
      trustedProxyResolved
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    clientIp: ip,
    trustedProxyResolved
  };
}

/**
 * Registra falha de autenticação nos buckets independentes de IP e par (IP, conta),
 * garantindo que bloqueios direcionados a um par (IP_A, conta) não bloqueiem
 * logins legítimos da mesma conta em outro IP (IP_B).
 */
export function recordLoginFailure(
  clientIp: string,
  normalizedAccount: string,
  options?: { now?: number; config?: Partial<LoginRateLimitConfig> }
): LoginFailureRecordResult {
  const now = options?.now ?? Date.now();
  const baseCfg = getLoginRateLimitConfig();
  const cfg: LoginRateLimitConfig = { ...baseCfg, ...options?.config };
  const store = getRateLimitStore();

  const pairKey = buildPairBucketKey(clientIp, normalizedAccount);
  const ipKey = buildIpBucketKey(clientIp);

  const prevPairCount = getActiveBucket(store, pairKey, now)?.count ?? 0;
  const prevIpCount = getActiveBucket(store, ipKey, now)?.count ?? 0;

  const pairEntry = incrementBucket(store, pairKey, cfg.windowMs, now);
  const ipEntry = incrementBucket(store, ipKey, cfg.windowMs, now);

  const pairBlocked = pairEntry.count >= cfg.maxAttemptsPerPair;
  const ipBlocked = ipEntry.count >= cfg.maxAttemptsPerIp;
  const blocked = pairBlocked || ipBlocked;
  const newlyBlocked =
    (pairEntry.count === cfg.maxAttemptsPerPair && prevPairCount < cfg.maxAttemptsPerPair) ||
    (ipEntry.count === cfg.maxAttemptsPerIp && prevIpCount < cfg.maxAttemptsPerIp);

  let retryAfterMs = 0;
  if (pairBlocked) {
    retryAfterMs = Math.max(retryAfterMs, pairEntry.resetAt - now);
  }
  if (ipBlocked) {
    retryAfterMs = Math.max(retryAfterMs, ipEntry.resetAt - now);
  }

  return {
    blocked,
    newlyBlocked,
    retryAfterSeconds: blocked ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : 0,
    pairCount: pairEntry.count,
    ipCount: ipEntry.count
  };
}

/**
 * Limpa o contador específico do par (IP, conta) após autenticação bem-sucedida.
 */
export function clearLoginPairFailures(clientIp: string, normalizedAccount: string): void {
  const store = getRateLimitStore();
  store.delete(buildPairBucketKey(clientIp, normalizedAccount));
}

/**
 * Limpa completamente o armazenamento em memória (exclusivo para isolamento entre testes).
 */
export function resetLoginRateLimitStore(): void {
  getRateLimitStore().clear();
}
