import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP,
  DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR,
  DEFAULT_LOGIN_WINDOW_MS,
  DEFAULT_OVERFLOW_SLOTS_PER_SCOPE,
  acquireLoginRateLimitReservation,
  buildAccountBucketKey,
  buildIpBucketKey,
  buildPairBucketKey,
  commitLoginFailure,
  commitLoginSuccess,
  getLoginRateLimitDiagnostics,
  getLoginRateLimitEntryState,
  normalizeIpCandidate,
  parseTrustedProxyHops,
  releaseLoginRateLimitReservation,
  resetLoginRateLimitStore,
  resolveLoginClientIp,
} from '@/lib/security/loginRateLimiter';

function findCollidingSuffixes(prefixBuilder: (i: number) => string, mod = DEFAULT_OVERFLOW_SLOTS_PER_SCOPE): [string, string] {
  const seen = new Map<number, string>();
  const hashFnv1a = (value: string) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  };

  for (let i = 0; i < 10_000; i++) {
    const key = prefixBuilder(i);
    const slot = hashFnv1a(key) % mod;
    const prev = seen.get(slot);
    if (prev && prev !== key) {
      return [prev, key];
    }
    seen.set(slot, key);
  }
  throw new Error('Failed to generate colliding keys');
}

describe('Login Rate Limiter Security Suite (Overflow Identity & Pending Epoch Integrity)', () => {
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
    const untrusted = resolveLoginClientIp(
      {
        headers: new Headers({
          'x-forwarded-for': '203.0.113.77',
          'x-real-ip': '198.51.100.88',
        }),
      },
      0
    );
    expect(untrusted.ip).toBeNull();
    expect(untrusted.trustedProxyResolved).toBe(false);
    expect(untrusted.resolutionStatus).toBe('PROXY_NOT_TRUSTED');

    const missingHeader = resolveLoginClientIp(
      { headers: new Headers({ 'x-real-ip': '198.51.100.88' }) },
      1
    );
    expect(missingHeader.ip).toBeNull();
    expect(missingHeader.resolutionStatus).toBe('MISSING_HEADER');

    const trailingGarbage = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5, garbage' }) },
      1
    );
    expect(trailingGarbage.ip).toBeNull();
    expect(trailingGarbage.resolutionStatus).toBe('MALFORMED_CHAIN');

    const trailingComma = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5, ' }) },
      1
    );
    expect(trailingComma.ip).toBeNull();
    expect(trailingComma.resolutionStatus).toBe('MALFORMED_CHAIN');

    const invalidTargetTwoHops = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5, not-an-ip, 10.0.0.2' }) },
      2
    );
    expect(invalidTargetTwoHops.ip).toBeNull();
    expect(invalidTargetTwoHops.resolutionStatus).toBe('MALFORMED_CHAIN');

    const insufficient = resolveLoginClientIp(
      { headers: new Headers({ 'x-forwarded-for': '203.0.113.5' }) },
      2
    );
    expect(insufficient.ip).toBeNull();
    expect(insufficient.resolutionStatus).toBe('INSUFFICIENT_HOPS');

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

    const attackedCheck = acquireLoginRateLimitReservation(reqWithoutProxy, 'conta-atacada@local', { now, config: cfg });
    expect(attackedCheck.allowed).toBe(false);
    expect(attackedCheck.blockedScope).toBe('ACCOUNT');

    const legitA = acquireLoginRateLimitReservation(reqWithoutProxy, 'admin-a@local', { now, config: cfg });
    expect(legitA.allowed).toBe(true);
    commitLoginSuccess(legitA, now);

    const legitB = acquireLoginRateLimitReservation(reqWithoutProxy, 'operador-b@local', { now, config: cfg });
    expect(legitB.allowed).toBe(true);
    commitLoginSuccess(legitB, now);
  });

  it('reserva síncrona pré-async impede contorno por rajadas concorrentes no par e no IP confiável', () => {
    const attackerReq = { headers: new Headers({ 'x-forwarded-for': '203.0.113.88' }) };
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 1 };

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
      releaseLoginRateLimitReservation(resv, now);
    }
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).totalPendingCount).toBe(0);
  });

  it('P1 Overflow Identity (ACCOUNT): reproduz colisão exata blocked-target@local vs attacker-196@local sem vazamento nem reset cruzado', () => {
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 0, maxStoreEntries: 2 };

    // 1. Satura a store primária com 2 bloqueios ativos (2/2)
    for (const blk of ['prim-1@local', 'prim-2@local']) {
      for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
        const r = acquireLoginRateLimitReservation(null, blk, { now, config: cfg });
        expect(r.allowed).toBe(true);
        commitLoginFailure(r, now);
      }
    }

    // 2. Registra 4 falhas para blocked-target@local no overflow (slot FNV-1a = 29)
    for (let i = 0; i < 4; i++) {
      const r = acquireLoginRateLimitReservation(null, 'blocked-target@local', { now, config: cfg });
      expect(r.allowed).toBe(true);
      expect(r.capacitySaturated).toBe(true);
      commitLoginFailure(r, now);
    }
    const stateTargetBefore = getLoginRateLimitEntryState('ACCOUNT', buildAccountBucketKey('blocked-target@local'), {
      now,
      config: cfg,
    });
    expect(stateTargetBefore.active?.location).toBe('overflow');
    expect(stateTargetBefore.active?.failures).toBe(4);

    // 3. Autentica com sucesso a identidade colidente attacker-196@local (mesmo hash FNV-1a mod 256!)
    // Em seguida testa tentativa + sucesso em attacker-196@local após 2 falhas
    for (let i = 0; i < 2; i++) {
      const attFail = acquireLoginRateLimitReservation(null, 'attacker-196@local', { now, config: cfg });
      expect(attFail.allowed).toBe(true);
      commitLoginFailure(attFail, now);
    }
    const stateAttBefore = getLoginRateLimitEntryState('ACCOUNT', buildAccountBucketKey('attacker-196@local'), {
      now,
      config: cfg,
    });
    expect(stateAttBefore.active?.location).toBe('overflow');
    expect(stateAttBefore.active?.overflowSlotIndex).not.toBe(stateTargetBefore.active?.overflowSlotIndex);

    const attWin = acquireLoginRateLimitReservation(null, 'attacker-196@local', { now, config: cfg });
    expect(attWin.allowed).toBe(true);
    commitLoginSuccess(attWin, now);

    // Confirmado: sucesso em attacker-196@local NÃO zerou as 4 falhas de blocked-target@local!
    const stateTargetAfter = getLoginRateLimitEntryState('ACCOUNT', buildAccountBucketKey('blocked-target@local'), {
      now,
      config: cfg,
    });
    expect(stateTargetAfter.active?.failures).toBe(4);

    // 4. 5a falha bloqueia blocked-target@local, sem provocar bloqueio cruzado em attacker-196@local
    const finalFail = acquireLoginRateLimitReservation(null, 'blocked-target@local', { now, config: cfg });
    expect(finalFail.allowed).toBe(true);
    commitLoginFailure(finalFail, now);

    expect(acquireLoginRateLimitReservation(null, 'blocked-target@local', { now, config: cfg }).allowed).toBe(false);
    const attAfterTargetBlocked = acquireLoginRateLimitReservation(null, 'attacker-196@local', { now, config: cfg });
    expect(attAfterTargetBlocked.allowed).toBe(true);
    commitLoginSuccess(attAfterTargetBlocked, now);
  });

  it('P1 Overflow Identity (PAIR e IP): isola colisões em PAIR/IP e respeita resetOnSuccess somente por identidade em PAIR', () => {
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 1, maxStoreEntries: 2 };

    // Satura primária com 2 bloqueios ativos (2/2) sem proxy para travar os 2 slots da primária
    for (const blk of ['sat-a@local', 'sat-b@local']) {
      for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
        const r = acquireLoginRateLimitReservation(null, blk, {
          now,
          config: { trustedProxyHops: 0, maxStoreEntries: 2 },
        });
        commitLoginFailure(r, now);
      }
    }
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).primarySize).toBe(2);
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).activeBlockedCount).toBe(2);

    // Encontra dois pares colidentes no hash mod 256 sob o mesmo escopo PAIR (com IPs distintos para não disparar IP limit)
    const [pairKeyA, pairKeyB] = findCollidingSuffixes((i) => buildPairBucketKey(`198.51.100.${(i % 200) + 1}`, `pair-${i}@local`));
    const [, ipA, accA] = pairKeyA.split(':');
    const [, ipB, accB] = pairKeyB.split(':');

    const reqA = { headers: new Headers({ 'x-forwarded-for': ipA }) };
    const reqB = { headers: new Headers({ 'x-forwarded-for': ipB }) };

    for (let i = 0; i < 4; i++) {
      const rA = acquireLoginRateLimitReservation(reqA, accA, { now, config: cfg });
      expect(rA.allowed).toBe(true);
      commitLoginFailure(rA, now);
    }

    // Colidente B falha 2x e depois autentica com sucesso -> zera B (PAIR), preserva A (PAIR) e preserva falhas de IP!
    for (let i = 0; i < 2; i++) {
      const rB = acquireLoginRateLimitReservation(reqB, accB, { now, config: cfg });
      expect(rB.allowed).toBe(true);
      commitLoginFailure(rB, now);
    }
    const winB = acquireLoginRateLimitReservation(reqB, accB, { now, config: cfg });
    expect(winB.allowed).toBe(true);
    commitLoginSuccess(winB, now);

    // Falhas de pairKeyA continuam exatamente 4 (sucesso de pairKeyB não limpou pairKeyA)
    const statePairA = getLoginRateLimitEntryState('PAIR', pairKeyA, { now, config: cfg });
    expect(statePairA.active?.location).toBe('overflow');
    expect(statePairA.active?.failures).toBe(4);

    // Sucesso de accB zerou pairKeyB, MAS NÃO zerou ipB (IP tem resetOnSuccess=false)
    const stateIpB = getLoginRateLimitEntryState('IP', buildIpBucketKey(ipB), { now, config: cfg });
    expect(stateIpB.active?.failures).toBe(2);

    // Bloqueia pairKeyA definitivamente sem afetar pairKeyB
    const failA5 = acquireLoginRateLimitReservation(reqA, accA, { now, config: cfg });
    commitLoginFailure(failA5, now);
    expect(acquireLoginRateLimitReservation(reqA, accA, { now, config: cfg }).allowed).toBe(false);
    const checkB = acquireLoginRateLimitReservation(reqB, accB, { now, config: cfg });
    expect(checkB.allowed).toBe(true);
    commitLoginSuccess(checkB, now);

    // Colisão direta no escopo IP (duas IPs colidentes no FNV-1a mod 256):
    // bloqueio da IP colidente 1 no overflow não bloqueia IP colidente 2, e sucesso em IP 2 não zera IP 1
    const [ipKeyC1, ipKeyC2] = findCollidingSuffixes((i) => buildIpBucketKey(`192.0.2.${(i % 250) + 1}`));
    const ipC1 = ipKeyC1.slice(3);
    const ipC2 = ipKeyC2.slice(3);
    const reqC1 = { headers: new Headers({ 'x-forwarded-for': ipC1 }) };
    const reqC2 = { headers: new Headers({ 'x-forwarded-for': ipC2 }) };

    for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP; i++) {
      const r = acquireLoginRateLimitReservation(reqC1, `ip-col-${i}@local`, { now, config: cfg });
      expect(r.allowed).toBe(true);
      commitLoginFailure(r, now);
    }
    expect(acquireLoginRateLimitReservation(reqC1, 'other@local', { now, config: cfg }).allowed).toBe(false);

    const checkC2 = acquireLoginRateLimitReservation(reqC2, 'other@local', { now, config: cfg });
    expect(checkC2.allowed).toBe(true);
    commitLoginSuccess(checkC2, now);
    expect(getLoginRateLimitEntryState('IP', ipKeyC1, { now, config: cfg }).active?.failures).toBe(
      DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP
    );
  });

  it('P1 Overflow Saturation: comportamento fail-closed explícito quando todos os slots de overflow estão ocupados por bloqueios/reservas', () => {
    const now = 1_700_000_000_000;
    const cfg = { trustedProxyHops: 0, maxStoreEntries: 2, maxOverflowSlotsPerScope: 4 };

    // Preenche 2/2 da primária + 4/4 do overflow ACCOUNT exclusivamente com bloqueios ativos
    const primVictims = ['prim-blk-1@local', 'prim-blk-2@local'];
    const ovfVictims = ['ovf-blk-1@local', 'ovf-blk-2@local', 'ovf-blk-3@local', 'ovf-blk-4@local'];

    for (const acc of [...primVictims, ...ovfVictims]) {
      for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
        const r = acquireLoginRateLimitReservation(null, acc, { now, config: cfg });
        expect(r.allowed).toBe(true);
        commitLoginFailure(r, now);
      }
    }

    const diag = getLoginRateLimitDiagnostics({ now, config: cfg });
    expect(diag.primarySize).toBe(2);
    expect(diag.overflowByScope.ACCOUNT).toBe(4);
    expect(diag.activeBlockedCount).toBe(6);

    // Nova conta com overflow 100% ocupado por bloqueios ativos -> fail-closed explícito (sem bypass, sem evicção, sem reaproveitamento)
    const blockedUnderFullOverflow = acquireLoginRateLimitReservation(null, 'sem-vaga@local', { now, config: cfg });
    expect(blockedUnderFullOverflow.allowed).toBe(false);
    expect(blockedUnderFullOverflow.overflowExhausted).toBe(true);
    expect(blockedUnderFullOverflow.capacitySaturated).toBe(true);
    expect(blockedUnderFullOverflow.blockedScope).toBe('ACCOUNT');
    expect(blockedUnderFullOverflow.retryAfterSeconds).toBeGreaterThan(0);

    // Todos os bloqueios existentes permanecem ativos e o limite de 4 slots de overflow foi estritamente mantido
    for (const acc of [...primVictims, ...ovfVictims]) {
      expect(acquireLoginRateLimitReservation(null, acc, { now, config: cfg }).allowed).toBe(false);
    }
    expect(getLoginRateLimitDiagnostics({ now, config: cfg }).overflowByScope.ACCOUNT).toBe(4);

    // Valida rollback atômico se PAIR entrar no overflow mas IP estiver 100% esgotado
    resetLoginRateLimitStore();
    const cfgDual = { trustedProxyHops: 1, maxStoreEntries: 1, maxOverflowSlotsPerScope: 2 };
    // Satura primária com 1 IP bloqueado (ip:10.0.0.1) + overflow IP 2/2 com 10.0.0.2 e 10.0.0.3 bloqueados por maxAttemptsPerIp
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP; i++) {
        const r = acquireLoginRateLimitReservation(
          { headers: new Headers({ 'x-forwarded-for': ip }) },
          `fill-${i}@local`,
          { now, config: cfgDual }
        );
        commitLoginFailure(r, now);
      }
    }
    // 10.0.0.99 consegue passar fase 2 no PAIR antes de falhar em IP overflowExhausted -> rollback garante 0 pending preso!
    const dualFull = acquireLoginRateLimitReservation(
      { headers: new Headers({ 'x-forwarded-for': '10.0.0.99' }) },
      'target-rollback@local',
      { now, config: cfgDual }
    );
    expect(dualFull.allowed).toBe(false);
    expect(dualFull.overflowExhausted).toBe(true);
    expect(getLoginRateLimitDiagnostics({ now, config: cfgDual }).totalPendingCount).toBe(0);
  });

  it('P2 Pending Expiry Integrity (Store Primária): preserva epochId e reservas em voo através da expiração sem sobrescrita nem vazamento', () => {
    const t0 = 1_700_000_000_000;
    const tExp = t0 + DEFAULT_LOGIN_WINDOW_MS;
    const cfg = { trustedProxyHops: 0 };

    // 1. Reserva adquirida antes da expiração e liquidada depois dela -> limpa ao zera pending
    const rSolo = acquireLoginRateLimitReservation(null, 'solo@local', { now: t0, config: cfg });
    expect(rSolo.allowed).toBe(true);
    commitLoginFailure(rSolo, tExp + 100);
    expect(getLoginRateLimitEntryState('ACCOUNT', 'acct:solo@local', { now: tExp + 100, config: cfg }).active).toBeNull();
    expect(getLoginRateLimitDiagnostics({ now: tExp + 100, config: cfg }).totalPendingCount).toBe(0);

    // 2. Exatamente no instante tExp, há 3 reservas antigas pendentes (r1a, r1b, r1c) na geração E1
    const r1a = acquireLoginRateLimitReservation(null, 'gen-test@local', { now: t0, config: cfg });
    const r1b = acquireLoginRateLimitReservation(null, 'gen-test@local', { now: t0 + 100, config: cfg });
    const r1c = acquireLoginRateLimitReservation(null, 'gen-test@local', { now: t0 + 200, config: cfg });
    const stateBeforeExp = getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local', { now: t0 + 200, config: cfg });
    const epoch1 = stateBeforeExp.active!.epochId;
    expect(stateBeforeExp.active!.pending).toBe(3);

    // Nova tentativa r2 exatamente no instante de expiração tExp -> aposenta E1 em retiring sem sobrescrever epochId e cria E2
    const r2 = acquireLoginRateLimitReservation(null, 'gen-test@local', { now: tExp, config: cfg });
    expect(r2.allowed).toBe(true);

    const stateAtExp = getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local', { now: tExp, config: cfg });
    expect(stateAtExp.active).not.toBeNull();
    const epoch2 = stateAtExp.active!.epochId;
    expect(epoch2).not.toBe(epoch1);
    expect(stateAtExp.active!.pending).toBe(1);
    expect(stateAtExp.active!.failures).toBe(0);
    expect(stateAtExp.retiring).toHaveLength(1);
    expect(stateAtExp.retiring[0].epochId).toBe(epoch1);
    expect(stateAtExp.retiring[0].pending).toBe(3);

    // Conclusão em ordens diferentes entre gerações:
    // Primeiro, falha nova tentativa em E2 -> r2 falha (1 falha registrada em E2)
    commitLoginFailure(r2, tExp + 10);
    expect(getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local').active?.failures).toBe(1);

    // Depois r1a (antiga!) autentica COM SUCESSO após expiração -> NÃO zera a falha de E2!
    commitLoginSuccess(r1a, tExp + 20);
    expect(getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local').active?.failures).toBe(1);
    expect(getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local').retiring[0].pending).toBe(2);

    // Depois r1b (antiga!) falha após expiração -> contabilizada isolada em E1 (não soma em E2!)
    commitLoginFailure(r1b, tExp + 30);
    expect(getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local').active?.failures).toBe(1);
    expect(getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local').retiring[0].pending).toBe(1);

    // Por fim r1c (antiga!) sofre exceção e libera -> E1 limpa totalmente de retiring (pending=0)!
    releaseLoginRateLimitReservation(r1c, tExp + 40);
    releaseLoginRateLimitReservation(r1c, tExp + 45); // idempotência: não altera E2
    const stateFinal = getLoginRateLimitEntryState('ACCOUNT', 'acct:gen-test@local', { now: tExp + 50, config: cfg });
    expect(stateFinal.retiring).toHaveLength(0);
    expect(stateFinal.active?.epochId).toBe(epoch2);
    expect(stateFinal.active?.failures).toBe(1);
    expect(stateFinal.active?.pending).toBe(0);
    expect(getLoginRateLimitDiagnostics({ now: tExp + 50, config: cfg }).totalPendingCount).toBe(0);

    // Recuperação normal após expiração da geração E2
    const recovered = acquireLoginRateLimitReservation(null, 'gen-test@local', {
      now: tExp + DEFAULT_LOGIN_WINDOW_MS,
      config: cfg,
    });
    expect(recovered.allowed).toBe(true);
    commitLoginSuccess(recovered, tExp + DEFAULT_LOGIN_WINDOW_MS + 10);
    expect(getLoginRateLimitDiagnostics({ now: tExp + DEFAULT_LOGIN_WINDOW_MS + 10, config: cfg }).primarySize).toBe(0);
  });

  it('P2 Pending Expiry Integrity (Overflow Ativo): preserva reservas em voo no overflow sem sobrescrever gerações', () => {
    const t0 = 1_700_000_000_000;
    const tExp = t0 + DEFAULT_LOGIN_WINDOW_MS;
    const cfg = { trustedProxyHops: 0, maxStoreEntries: 2 };

    // Satura primária com bloqueios que durarão 2x mais (criados tarde ou janela maior? Aqui ajustamos via nova aquisição em t0 + 10_000)
    for (const acc of ['hold-1@local', 'hold-2@local']) {
      for (let i = 0; i < DEFAULT_LOGIN_MAX_ATTEMPTS_PER_PAIR; i++) {
        const r = acquireLoginRateLimitReservation(null, acc, { now: t0 + 50_000, config: cfg });
        commitLoginFailure(r, t0 + 50_000);
      }
    }

    // Duas reservas pendentes no overflow em t0 (epoch O1)
    const o1a = acquireLoginRateLimitReservation(null, 'ovf-gen@local', { now: t0, config: cfg });
    const o1b = acquireLoginRateLimitReservation(null, 'ovf-gen@local', { now: t0 + 10, config: cfg });
    expect(o1a.allowed && o1b.allowed).toBe(true);
    expect(o1a.capacitySaturated).toBe(true);

    const beforeOvf = getLoginRateLimitEntryState('ACCOUNT', 'acct:ovf-gen@local', { now: t0 + 10, config: cfg });
    expect(beforeOvf.active?.location).toBe('overflow');
    const epochO1 = beforeOvf.active!.epochId;

    // No instante tExp (enquanto hold-1/hold-2 ainda seguram a primária saturada até t0+50_000+window),
    // nova tentativa o2 para ovf-gen@local entra no overflow -> aposenta O1 intacto em retiring e cria O2!
    const o2 = acquireLoginRateLimitReservation(null, 'ovf-gen@local', { now: tExp, config: cfg });
    expect(o2.allowed).toBe(true);
    expect(o2.capacitySaturated).toBe(true);

    const midOvf = getLoginRateLimitEntryState('ACCOUNT', 'acct:ovf-gen@local', { now: tExp, config: cfg });
    expect(midOvf.active?.location).toBe('overflow');
    expect(midOvf.active?.epochId).not.toBe(epochO1);
    expect(midOvf.retiring).toHaveLength(1);
    expect(midOvf.retiring[0].epochId).toBe(epochO1);
    expect(midOvf.retiring[0].pending).toBe(2);

    // Conclui o2 com falha (E2), depois o1a (sucesso antigo em O1) e o1b (exceção em O1)
    commitLoginFailure(o2, tExp + 5);
    commitLoginSuccess(o1a, tExp + 15);
    releaseLoginRateLimitReservation(o1b, tExp + 20);

    const afterOvf = getLoginRateLimitEntryState('ACCOUNT', 'acct:ovf-gen@local', { now: tExp + 25, config: cfg });
    expect(afterOvf.retiring).toHaveLength(0);
    expect(afterOvf.active?.failures).toBe(1); // falha de o2 preservada!
    expect(afterOvf.active?.pending).toBe(0);
    expect(getLoginRateLimitDiagnostics({ now: tExp + 25, config: cfg }).totalPendingCount).toBe(0);

    // Após expirar E2 também, recuperação normal no overflow limpa tudo
    const recovered = acquireLoginRateLimitReservation(null, 'ovf-gen@local', {
      now: tExp + DEFAULT_LOGIN_WINDOW_MS,
      config: cfg,
    });
    expect(recovered.allowed).toBe(true);
    commitLoginSuccess(recovered, tExp + DEFAULT_LOGIN_WINDOW_MS + 5);
    expect(getLoginRateLimitDiagnostics({ now: tExp + DEFAULT_LOGIN_WINDOW_MS + 5, config: cfg }).overflowSize).toBe(0);
  });

  it('recupera acesso após expiração da janela nos escopos PAIR, IP e ACCOUNT fallback', () => {
    const t0 = 1_700_000_000_000;
    const trustedReq = { headers: new Headers({ 'x-forwarded-for': '203.0.113.40' }) };

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
    commitLoginSuccess(recoveredPair, t0 + DEFAULT_LOGIN_WINDOW_MS);

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
    releaseLoginRateLimitReservation(recoveredIp, t0 + DEFAULT_LOGIN_WINDOW_MS);

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
    commitLoginSuccess(recoveredAcc, t0 + DEFAULT_LOGIN_WINDOW_MS);
  });
});
