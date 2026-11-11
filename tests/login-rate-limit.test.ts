import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP,
  DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR,
  DEFAULT_LOGIN_WINDOW_MS,
  checkLoginRateLimit,
  clearLoginPairFailures,
  normalizeIpCandidate,
  recordLoginFailure,
  resetLoginRateLimitStore,
  resolveLoginClientIp,
} from '@/lib/security/loginRateLimiter';

describe('Login Rate Limiter Security Suite', () => {
  beforeEach(() => {
    resetLoginRateLimitStore();
  });

  it('normaliza formatos IPv4, IPv6 com porta e mapeamento ::ffff:IPv4', () => {
    expect(normalizeIpCandidate('203.0.113.5:54321')).toBe('203.0.113.5');
    expect(normalizeIpCandidate('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIpCandidate('::ffff:192.0.2.10')).toBe('192.0.2.10');
    expect(normalizeIpCandidate('not-an-ip')).toBeNull();
  });

  it('ignora X-Forwarded-For quando trustedProxyHops=0 e lê da direita para esquerda quando >=1', () => {
    const req = {
      headers: new Headers({
        'x-forwarded-for': '1.2.3.4, 203.0.113.77',
        'x-real-ip': '198.51.100.88',
      }),
    };

    const untrusted = resolveLoginClientIp(req, 0);
    expect(untrusted.ip).toBe('direct-untrusted');
    expect(untrusted.trustedProxyResolved).toBe(false);

    // 1 hop confiável: cliente real = 203.0.113.77 (direita ignorando spoof 1.2.3.4 à esquerda)
    const oneHop = resolveLoginClientIp(req, 1);
    expect(oneHop.ip).toBe('203.0.113.77');
    expect(oneHop.trustedProxyResolved).toBe(true);

    // 2 hops confiáveis (ex.: CDN + proxy interno): cliente real = 1.2.3.4
    const twoHops = resolveLoginClientIp(req, 2);
    expect(twoHops.ip).toBe('1.2.3.4');
    expect(twoHops.trustedProxyResolved).toBe(true);

    // Hops configurados excedem cadeia XFF: fallback fail-closed sem confiar na entrada
    const excessHops = resolveLoginClientIp(req, 3);
    expect(excessHops.ip).toBe('unverified-proxy-client');
    expect(excessHops.trustedProxyResolved).toBe(false);
  });

  it('recupera acesso após expiração da janela e limpa contador do par em login bem-sucedido', () => {
    const req = { headers: new Headers({ 'x-forwarded-for': '203.0.113.15' }) };
    const t0 = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 1 };

    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
      const check = checkLoginRateLimit(req, 'op@local', { now: t0 + i * 1000, config: cfg });
      expect(check.allowed).toBe(true);
      recordLoginFailure(check.clientIp, 'op@local', { now: t0 + i * 1000, config: cfg });
    }

    const blocked = checkLoginRateLimit(req, 'op@local', { now: t0 + 10_000, config: cfg });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedScope).toBe('PAIR');
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Após janela expirar completamente, acesso volta a ser permitido
    const afterExpiry = checkLoginRateLimit(req, 'op@local', {
      now: t0 + DEFAULT_LOGIN_WINDOW_MS + 1000,
      config: cfg,
    });
    expect(afterExpiry.allowed).toBe(true);

    // Preenche novamente até bloquear e verifica limpeza explícita do par após sucesso
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
      recordLoginFailure('203.0.113.15', 'op@local', {
        now: t0 + DEFAULT_LOGIN_WINDOW_MS + 2000,
        config: cfg,
      });
    }
    expect(
      checkLoginRateLimit(req, 'op@local', {
        now: t0 + DEFAULT_LOGIN_WINDOW_MS + 3000,
        config: cfg,
      }).allowed
    ).toBe(false);

    clearLoginPairFailures('203.0.113.15', 'op@local');
    expect(
      checkLoginRateLimit(req, 'op@local', {
        now: t0 + DEFAULT_LOGIN_WINDOW_MS + 3000,
        config: cfg,
      }).allowed
    ).toBe(true);
  });

  it('aplica bucket de IP para enumeração distribuída entre várias contas sem bloquear outras IPs', () => {
    const attackerReq = { headers: new Headers({ 'x-forwarded-for': '203.0.113.99' }) };
    const benignReq = { headers: new Headers({ 'x-forwarded-for': '198.51.100.50' }) };
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 1 };

    // Ataca 20 contas distintas com 1 falha cada (abaixo de maxAttemptsPerPair=5 por conta)
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP; i++) {
      recordLoginFailure('203.0.113.99', `probe-${i}@local`, { now, config: cfg });
    }

    const ipBlocked = checkLoginRateLimit(attackerReq, 'brand-new-account@local', { now, config: cfg });
    expect(ipBlocked.allowed).toBe(false);
    expect(ipBlocked.blockedScope).toBe('IP');

    const benignCheck = checkLoginRateLimit(benignReq, 'probe-0@local', { now, config: cfg });
    expect(benignCheck.allowed).toBe(true);
  });
});
