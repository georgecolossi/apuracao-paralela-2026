import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP,
  DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR,
  DEFAULT_LOGIN_WINDOW_MS,
  acquireLoginRateLimitReservation,
  commitLoginFailure,
  commitLoginSuccess,
  getLoginRateLimitDiagnostics,
  normalizeIpCandidate,
  parseTrustedProxyHops,
  releaseLoginRateLimitReservation,
  resetLoginRateLimitStore,
  resolveLoginClientIp,
} from '@/lib/security/loginRateLimiter';

describe('Login Rate Limiter Security Suite (Batch 2)', () => {
  beforeEach(() => {
    resetLoginRateLimitStore();
  });

  it('normaliza formatos válidos e rejeita portas ou colchetes malformados', () => {
    expect(normalizeIpCandidate('203.0.113.5:54321')).toBe('203.0.113.5');
    expect(normalizeIpCandidate('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIpCandidate('::ffff:192.0.2.10')).toBe('192.0.2.10');
    expect(normalizeIpCandidate('203.0.113.5:99999')).toBeNull();
    expect(normalizeIpCandidate('[2001:db8::1]extra')).toBeNull();
    expect(normalizeIpCandidate('not-an-ip')).toBeNull();
  });

  it('valida parseTrustedProxyHops em modo fail-closed para valores inválidos', () => {
    expect(parseTrustedProxyHops(undefined)).toBe(0);
    expect(parseTrustedProxyHops('')).toBe(0);
    expect(parseTrustedProxyHops('abc')).toBe(0);
    expect(parseTrustedProxyHops('-1')).toBe(0);
    expect(parseTrustedProxyHops('11')).toBe(0);
    expect(parseTrustedProxyHops('1')).toBe(1);
    expect(parseTrustedProxyHops('2')).toBe(2);
  });

  it('cadeias XFF malformadas, vazias à direita ou com hops insuficientes falham de forma segura sem deslocar índices', () => {
    // 1. Proxy não confiável (hops=0): retorna ip=null e ignora cabeçalhos
    const untrustedReq = {
      headers: new Headers({
        'x-forwarded-for': '203.0.113.77',
        'x-real-ip': '198.51.100.88',
      }),
    };
    const untrusted = resolveLoginClientIp(untrustedReq, 0);
    expect(untrusted.ip).toBeNull();
    expect(untrusted.trustedProxyResolved).toBe(false);
    expect(untrusted.resolutionStatus).toBe('PROXY_NOT_TRUSTED');

    // 2. XFF ausente mesmo com x-real-ip preenchido -> MISSING_HEADER
    const missingHeader = resolveLoginClientIp(
      { headers: new Headers({ 'x-real-ip': '198.51.100.88' }) },
      1
    );
    expect(missingHeader.ip).toBeNull();
    expect(missingHeader.resolutionStatus).toBe('MISSING_HEADER');

    // 3. CRÍTICO (P2): entrada inválida à direita com hops=1 NÃO deve filtrar nem deslocar para 203.0.113.5
    const trailingGarbage = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5, garbage' }) },
      1
    );
    expect(trailingGarbage.ip).toBeNull();
    expect(trailingGarbage.trustedProxyResolved).toBe(false);
    expect(trailingGarbage.resolutionStatus).toBe('MALFORMED_CHAIN');

    const trailingComma = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5, ' }) },
      1
    );
    expect(trailingComma.ip).toBeNull();
    expect(trailingComma.resolutionStatus).toBe('MALFORMED_CHAIN');

    // 4. CRÍTICO (P2): hops=2 com posição alvo inválida NÃO desloca para o IP à esquerda
    const invalidTargetTwoHops = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5, not-an-ip, 10.0.0.2' }) },
      2
    );
    expect(invalidTargetTwoHops.ip).toBeNull();
    expect(invalidTargetTwoHops.resolutionStatus).toBe('MALFORMED_CHAIN');

    // 5. Hops configurados maiores que a cadeia -> INSUFFICIENT_HOPS
    const insufficient = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5' }) },
      2
    );
    expect(insufficient.ip).toBeNull();
    expect(insufficient.resolutionStatus).toBe('INSUFFICIENT_HOPS');

    // 6. Cadeia válida com 2 hops confiáveis (ignora prefixo spoofed à esquerda)
    const validTwoHops = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': 'attacker-spoof, 203.0.113.5, 10.0.0.2' }) },
      2
    );
    expect(validTwoHops.ip).toBe('203.0.113.5');
    expect(validTwoHops.trustedProxyResolved).toBe(true);
    expect(validTwoHops.resolutionStatus).toBe('TRUSTED_PROXY_IP');
  });

  it('duas contas legítimas não compartilham bloqueio quando o IP é desconhecido (fallback individual por conta)', () => {
    const reqWithoutProxy = { headers: new Headers({ 'x-forwarded-for': '198.51.100.1' }) };
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 0 };

    // Atacante tenta derrubar várias contas ou rotacionar XFF quando hops=0
    for (let i = 0; i < 30; i++) {
      const targetAcc = i === 0 ? 'conta-atacada@local' : `spray-${i}@local`;
      for (let f = 0; f < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; f++) {
        const resv = acquireLoginRateLimitReservation(
          { headers: new Headers({ 'x-forwarded-for': `198.51.100.${(i % 200) + 1}` }) },
          targetAcc,
          { now, config: cfg }
        );
        expect(resv.allowed).toBe(true);
        expect(resv.clientIp).toBeNull();
        commitLoginFailure(resv, now);
      }
    }

    // Conta atacada fica bloqueada individualmente
    const attackedCheck = acquireLoginRateLimitReservation(reqWithoutProxy, 'conta-atacada@local', { now, config: cfg });
    expect(attackedCheck.allowed).toBe(false);
    expect(attackedCheck.blockedScope).toBe('ACCOUNT');

    // Duas contas legítimas distintas permanecem completamente livres
    const legitA = acquireLoginRateLimitReservation(reqWithoutProxy, 'admin-a@local', { now, config: cfg });
    expect(legitA.allowed).toBe(true);
    expect(legitA.clientIp).toBeNull();
    commitLoginSuccess(legitA);

    const legitB = acquireLoginRateLimitReservation(reqWithoutProxy, 'operador-b@local', { now, config: cfg });
    expect(legitB.allowed).toBe(true);
    expect(legitB.clientIp).toBeNull();
    commitLoginSuccess(legitB);
  });

  it('reserva síncrona pré-async impede contorno por rajadas concorrentes no par e no IP confiável', () => {
    const attackerReq = { headers: new Headers({ 'x-forwarded-for': '203.0.113.88' }) };
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 1 };

    // Simula 20 requisições simultâneas chegando ao mesmo tempo antes de qualquer await concluir
    const pairReservations = [];
    for (let i = 0; i < 20; i++) {
      pairReservations.push(
        acquireLoginRateLimitReservation(attackerReq, 'mesma-conta@local', { now, config: cfg })
      );
    }

    const allowedPair = pairReservations.filter((r) => r.allowed);
    const blockedPair = pairReservations.filter((r) => !r.allowed);
    expect(allowedPair).toHaveLength(DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR);
    expect(blockedPair).toHaveLength(20 - DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR);
    expect(blockedPair.every((r) => r.blockedScope === 'PAIR')).toBe(true);

    for (const resv of allowedPair) {
      commitLoginFailure(resv, now);
    }
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).totalPendingCount).toBe(0);

    // Nova rajada de 30 requisições simultâneas para 30 contas distintas do mesmo IP confiável
    resetLoginRateLimitStore();
    const ipReservations = [];
    for (let i = 0; i < 30; i++) {
      ipReservations.push(
        acquireLoginRateLimitReservation(attackerReq, `distinta-${i}@local`, { now, config: cfg })
      );
    }
    const allowedIp = ipReservations.filter((r) => r.allowed);
    const blockedIp = ipReservations.filter((r) => !r.allowed);
    expect(allowedIp).toHaveLength(DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP);
    expect(blockedIp).toHaveLength(30 - DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP);
    expect(blockedIp.every((r) => r.blockedScope === 'IP')).toBe(true);

    for (const resv of allowedIp) {
      releaseLoginRateLimitReservation(resv);
    }
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).totalPendingCount).toBe(0);
  });

  it('login bem-sucedido e liberação em exceção não deixam reservas pendentes nem corrompem concorrentes', () => {
    const req = { headers: new Headers({ 'x-forwarded-for': '203.0.113.15' }) };
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 1 };

    // Duas reservas simultâneas na mesma conta
    const r1 = acquireLoginRateLimitReservation(req, 'op@local', { now, config: cfg });
    const r2 = acquireLoginRateLimitReservation(req, 'op@local', { now, config: cfg });
    expect(r1.allowed && r2.allowed).toBe(true);
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).totalPendingCount).toBe(4); // (pair + ip) x 2

    // r1 conclui com sucesso sem destruir a reserva em voo de r2
    commitLoginSuccess(r1);
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).totalPendingCount).toBe(2);

    // r2 falha e encerra reserva (mesmo se release rodar em finally depois)
    commitLoginFailure(r2, now);
    releaseLoginRateLimitReservation(r2);
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).totalPendingCount).toBe(0);

    // r2 deixou 1 falha; mais 3 falhas totalizam 4 (< 5) e devem zerar no login válido seguinte
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR - 2; i++) {
      const f = acquireLoginRateLimitReservation(req, 'op@local', { now, config: cfg });
      expect(f.allowed).toBe(true);
      commitLoginFailure(f, now);
    }
    const win = acquireLoginRateLimitReservation(req, 'op@local', { now, config: cfg });
    expect(win.allowed).toBe(true);
    commitLoginSuccess(win);

    // Liberação por exceção não retém reserva
    const errResv = acquireLoginRateLimitReservation(req, 'op@local', { now, config: cfg });
    releaseLoginRateLimitReservation(errResv);
    releaseLoginRateLimitReservation(errResv); // idempotente
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).totalPendingCount).toBe(0);
  });

  it('esgotamento de capacidade não evicta bloqueios ativos e evita bypass via overflow limitado', () => {
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 0, maxStoreEntries: 3 };

    // Cenário A: 1 bloqueio ativo + 2 entradas de ruído (1 falha cada) preenchendo maxStoreEntries=3
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
      const r = acquireLoginRateLimitReservation(null, 'bloqueado-primario@local', { now, config: cfg });
      commitLoginFailure(r, now);
    }
    for (const noise of ['ruido-1@local', 'ruido-2@local']) {
      const r = acquireLoginRateLimitReservation(null, noise, { now, config: cfg });
      commitLoginFailure(r, now);
    }

    // 4a conta chega: deve evictar ruido-1 (ocioso e não bloqueado), preservando bloqueado-primario
    const quarta = acquireLoginRateLimitReservation(null, 'quarta-conta@local', { now, config: cfg });
    expect(quarta.allowed).toBe(true);
    expect(quarta.capacitySaturated).toBe(false);
    commitLoginFailure(quarta, now);

    const checkBlocked = acquireLoginRateLimitReservation(null, 'bloqueado-primario@local', { now, config: cfg });
    expect(checkBlocked.allowed).toBe(false);

    // Cenário B: saturação de 100% da tabela primária APENAS com bloqueios ativos (3/3)
    resetLoginRateLimitStore();
    for (const victim of ['blk-1@local', 'blk-2@local', 'blk-3@local']) {
      for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
        const r = acquireLoginRateLimitReservation(null, victim, { now, config: cfg });
        expect(r.allowed).toBe(true);
        commitLoginFailure(r, now);
      }
    }

    const diagBefore = getLoginRateLimitDiagnostics({ now, config: cfg });
    expect(diagBefore.primarySize).toBe(3);
    expect(diagBefore.activeBlockedCount).toBe(3);

    // Nova conta sob saturação usa overflow sem evictar bloqueios primários e sem bloqueio indiscriminado
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
      const ovfResv = acquireLoginRateLimitReservation(null, 'alvo-em-saturacao@local', { now, config: cfg });
      expect(ovfResv.allowed).toBe(true);
      expect(ovfResv.capacitySaturated).toBe(true);
      commitLoginFailure(ovfResv, now);
    }

    // 6a tentativa em alvo-em-saturacao também é bloqueada na overflow (sem bypass)
    const ovfBlocked = acquireLoginRateLimitReservation(null, 'alvo-em-saturacao@local', { now, config: cfg });
    expect(ovfBlocked.allowed).toBe(false);

    // Todos os 3 bloqueios primários continuam 100% intactos e bloqueados
    for (const victim of ['blk-1@local', 'blk-2@local', 'blk-3@local']) {
      const check = acquireLoginRateLimitReservation(null, victim, { now, config: cfg });
      expect(check.allowed).toBe(false);
    }
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).primarySize).toBe(3);
  });

  it('recupera acesso após expiração da janela nos escopos PAIR, IP e ACCOUNT fallback', () => {
    const t0 = 1_700_000_000_000;
    const trustedReq = { headers: new Headers({ 'x-forwarded-for': '203.0.113.40' }) };

    // 1. Bloqueio PAIR + IP com proxy confiável
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
      const r = acquireLoginRateLimitReservation(trustedReq, 'pair-user@local', {
        now: t0,
        config: { trustedProxyHops: 1 },
      });
      commitLoginFailure(r, t0);
    }
    expect(
      acquireLoginRateLimitReservation(trustedReq, 'pair-user@local', {
        now: t0 + DEFAULT_LOGIN_WINDOW_MS - 1,
        config: { trustedProxyHops: 1 },
      }).allowed
    ).toBe(false);

    const recoveredPair = acquireLoginRateLimitReservation(trustedReq, 'pair-user@local', {
      now: t0 + DEFAULT_LOGIN_WINDOW_MS,
      config: { trustedProxyHops: 1 },
    });
    expect(recoveredPair.allowed).toBe(true);
    commitLoginSuccess(recoveredPair);

    // 2. Bloqueio por IP distribuído
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP; i++) {
      const r = acquireLoginRateLimitReservation(trustedReq, `multi-${i}@local`, {
        now: t0,
        config: { trustedProxyHops: 1 },
      });
      commitLoginFailure(r, t0);
    }
    expect(
      acquireLoginRateLimitReservation(trustedReq, 'nova-conta@local', {
        now: t0 + DEFAULT_LOGIN_WINDOW_MS - 1,
        config: { trustedProxyHops: 1 },
      }).allowed
    ).toBe(false);

    const recoveredIp = acquireLoginRateLimitReservation(trustedReq, 'nova-conta@local', {
      now: t0 + DEFAULT_LOGIN_WINDOW_MS,
      config: { trustedProxyHops: 1 },
    });
    expect(recoveredIp.allowed).toBe(true);
    releaseLoginRateLimitReservation(recoveredIp);

    // 3. Bloqueio ACCOUNT fallback (IP desconhecido)
    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
      const r = acquireLoginRateLimitReservation(null, 'fallback-user@local', {
        now: t0,
        config: { trustedProxyHops: 0 },
      });
      commitLoginFailure(r, t0);
    }
    expect(
      acquireLoginRateLimitReservation(null, 'fallback-user@local', {
        now: t0 + DEFAULT_LOGIN_WINDOW_MS - 1,
        config: { trustedProxyHops: 0 },
      }).allowed
    ).toBe(false);

    const recoveredAcc = acquireLoginRateLimitReservation(null, 'fallback-user@local', {
      now: t0 + DEFAULT_LOGIN_WINDOW_MS,
      config: { trustedProxyHops: 0 },
    });
    expect(recoveredAcc.allowed).toBe(true);
    commitLoginSuccess(recoveredAcc);
  });
});
