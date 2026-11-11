import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../src/app/api/login/route';
import { prisma } from '../src/lib/db';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import {
  getLoginRateLimitDiagnostics,
  resetLoginRateLimitStore,
} from '../src/lib/security/loginRateLimiter';

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    }
  },
}));

vi.mock('bcryptjs', () => ({
  compare: vi.fn(),
}));

vi.mock('jsonwebtoken', () => ({
  sign: vi.fn().mockReturnValue('fake_token'),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
  }),
}));

vi.mock('@/lib/auth', () => ({
  getJwtSecret: vi.fn().mockReturnValue('mock_secret'),
}));

const mockReq = (body: any, headers: Record<string, string> = {}) => ({
  headers: new Headers(headers),
  json: async () => body,
} as Request);

const prevProxyHops = process.env.LOGIN_TRUSTED_PROXY_HOPS;

describe('POST /api/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLoginRateLimitStore();
    delete process.env.LOGIN_TRUSTED_PROXY_HOPS;
  });

  afterEach(() => {
    if (prevProxyHops === undefined) {
      delete process.env.LOGIN_TRUSTED_PROXY_HOPS;
    } else {
      process.env.LOGIN_TRUSTED_PROXY_HOPS = prevProxyHops;
    }
  });

  it('A) should permit login with valid username and password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: '1', email: 'admin', role: 'ADMIN', passwordHash: 'hash', isActive: true, sessionVersion: 0 } as any);
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);

    const res = await POST(mockReq({ username: 'admin', password: 'valid_password' }));
    expect(res.status).toBe(200);
    expect(jwt.sign).toHaveBeenCalled();
  });

  it('B) should reject if username does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await POST(mockReq({ username: 'nonexistent', password: 'valid_password' }));
    expect(res.status).toBe(401);
  });

  it('C) should reject if password is incorrect', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: '1', email: 'admin', role: 'ADMIN', passwordHash: 'hash', isActive: true, sessionVersion: 0 } as any);
    vi.mocked(bcrypt.compare).mockImplementation(async () => false);

    const res = await POST(mockReq({ username: 'admin', password: 'wrong_password' }));
    expect(res.status).toBe(401);
  });

  it('D) should reject if username is empty', async () => {
    const res = await POST(mockReq({ username: '', password: 'valid_password' }));
    expect(res.status).toBe(400);
  });

  it('E) should trim username and not require email format', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: '1', email: 'admin', role: 'ADMIN', passwordHash: 'hash', isActive: true, sessionVersion: 0 } as any);
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);

    const res = await POST(mockReq({ username: '  admin  ', password: 'valid_password' }));
    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'admin' } });
  });

  it('G) should require password', async () => {
    const res = await POST(mockReq({ username: 'admin', password: '' }));
    expect(res.status).toBe(400);
  });

  it('H) should return 400 INVALID_PAYLOAD when JSON body is malformed', async () => {
    const malformedReq = {
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Request;

    const res = await POST(malformedReq);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('INVALID_PAYLOAD');
  });

  it('I) should reject non-string username or password with 400', async () => {
    const res = await POST(mockReq({ username: { gt: '' }, password: 123 }));
    expect(res.status).toBe(400);
  });

  it('J) should return identical 401 and run dummy bcrypt compare to avoid user enumeration', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(bcrypt.compare).mockImplementation(async () => false);

    const resMissing = await POST(mockReq({ username: 'nao-existe@local', password: 'wrong' }));
    expect(resMissing.status).toBe(401);
    const jsonMissing = await resMissing.json();
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'u1',
      email: 'admin@local',
      role: 'ADMIN',
      passwordHash: 'hash',
      isActive: true,
      sessionVersion: 0,
    } as NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>);

    const resWrongPwd = await POST(mockReq({ username: 'admin@local', password: 'wrong' }));
    expect(resWrongPwd.status).toBe(401);
    const jsonWrongPwd = await resWrongPwd.json();
    expect(jsonWrongPwd).toEqual(jsonMissing);
  });

  it('K) should block after 5 failed attempts on (IP, account) with 429 + Retry-After, without blocking a third-party IP for the same account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      email: 'admin@local',
      role: 'ADMIN',
      passwordHash: 'hash',
      isActive: true,
      sessionVersion: 0,
    } as NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>);
    vi.mocked(bcrypt.compare).mockImplementation(async () => false);

    process.env.LOGIN_TRUSTED_PROXY_HOPS = '1';

    for (let i = 0; i < 5; i++) {
      const failRes = await POST(
        mockReq({ username: 'admin@local', password: 'wrong' }, { 'x-forwarded-for': '203.0.113.10' })
      );
      expect(failRes.status).toBe(401);
    }

    // 6a tentativa do mesmo par (IP_A, admin@local) deve ser bloqueada com 429
    const blockedRes = await POST(
      mockReq({ username: 'admin@local', password: 'correct' }, { 'x-forwarded-for': '203.0.113.10' })
    );
    expect(blockedRes.status).toBe(429);
    const retryAfter = Number(blockedRes.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);

    // Logins legítimos da MESMA conta a partir de IP_B continuam permitidos (anti-DoS de terceiros)
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);
    const legitOtherIpRes = await POST(
      mockReq({ username: 'admin@local', password: 'correct' }, { 'x-forwarded-for': '198.51.100.42' })
    );
    expect(legitOtherIpRes.status).toBe(200);
  });

  it('L) should ignore spoofed X-Forwarded-For rotation when LOGIN_TRUSTED_PROXY_HOPS is 0', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(bcrypt.compare).mockImplementation(async () => false);
    process.env.LOGIN_TRUSTED_PROXY_HOPS = '0';

    for (let i = 1; i <= 5; i++) {
      const res = await POST(
        mockReq(
          { username: 'target@local', password: 'wrong' },
          { 'x-forwarded-for': `198.51.100.${i}` }
        )
      );
      expect(res.status).toBe(401);
    }

    const blockedRes = await POST(
      mockReq(
        { username: 'target@local', password: 'wrong' },
        { 'x-forwarded-for': '198.51.100.99' }
      )
    );
    expect(blockedRes.status).toBe(429);
  });

  it('M) should NOT block unrelated legitimate accounts when IP is unknown and another account/attacker saturates failures', async () => {
    process.env.LOGIN_TRUSTED_PROXY_HOPS = '0';
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(bcrypt.compare).mockImplementation(async () => false);

    // 25 falhas distribuídas em 25 contas distintas sem IP confiável
    for (let i = 0; i < 25; i++) {
      const failRes = await POST(mockReq({ username: `spray-${i}@local`, password: 'wrong' }));
      expect(failRes.status).toBe(401);
    }

    // Bloqueia uma conta específica após 5 falhas
    for (let i = 0; i < 5; i++) {
      expect((await POST(mockReq({ username: 'blocked-target@local', password: 'wrong' }))).status).toBe(401);
    }
    expect((await POST(mockReq({ username: 'blocked-target@local', password: 'wrong' }))).status).toBe(429);

    // Contas legítimas distintas não sofrem bloqueio coletivo e autenticam com 200
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u-legit',
      email: 'legit1@local',
      role: 'ADMIN',
      passwordHash: 'hash',
      isActive: true,
      sessionVersion: 0,
    } as NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>);
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);

    expect((await POST(mockReq({ username: 'legit1@local', password: 'ok' }))).status).toBe(200);
    expect((await POST(mockReq({ username: 'legit2@local', password: 'ok' }))).status).toBe(200);
    expect(getLoginRateLimitDiagnostics().totalPendingCount).toBe(0);
  });

  it('N) should prevent TOCTOU bypass across 20 concurrent attempts on the same pair and respect IP burst limit', async () => {
    process.env.LOGIN_TRUSTED_PROXY_HOPS = '1';

    vi.mocked(prisma.user.findUnique).mockImplementation(
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          id: 'u-race',
          email: 'race@local',
          role: 'OPERATOR',
          passwordHash: 'hash',
          isActive: true,
          sessionVersion: 0,
        };
      }) as unknown as typeof prisma.user.findUnique
    );
    vi.mocked(bcrypt.compare).mockImplementation((async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return false;
    }) as unknown as typeof bcrypt.compare);

    // 1. 20 tentativas concorrentes no mesmo par -> exatamente 5 chegam ao banco/bcrypt (401) e 15 são barrada com 429
    const pairResponses = await Promise.all(
      Array.from({ length: 20 }, () =>
        POST(
          mockReq(
            { username: 'race@local', password: 'wrong' },
            { 'x-forwarded-for': '203.0.113.61' }
          )
        )
      )
    );
    const pairStatuses = pairResponses.map((r) => r.status);
    expect(pairStatuses.filter((s) => s === 401)).toHaveLength(5);
    expect(pairStatuses.filter((s) => s === 429)).toHaveLength(15);
    expect(vi.mocked(prisma.user.findUnique)).toHaveBeenCalledTimes(5);
    expect(vi.mocked(bcrypt.compare)).toHaveBeenCalledTimes(5);
    expect(getLoginRateLimitDiagnostics().totalPendingCount).toBe(0);

    // 2. Rajada concorrente de 30 contas distintas a partir do mesmo IP confiável -> exatamente 20 chegam ao DB (401) e 10 recebem 429
    vi.clearAllMocks();
    resetLoginRateLimitStore();
    const ipBurstResponses = await Promise.all(
      Array.from({ length: 30 }, (_, idx) =>
        POST(
          mockReq(
            { username: `burst-${idx}@local`, password: 'wrong' },
            { 'x-forwarded-for': '203.0.113.62' }
          )
        )
      )
    );
    const ipBurstStatuses = ipBurstResponses.map((r) => r.status);
    expect(ipBurstStatuses.filter((s) => s === 401)).toHaveLength(20);
    expect(ipBurstStatuses.filter((s) => s === 429)).toHaveLength(10);
    expect(vi.mocked(prisma.user.findUnique)).toHaveBeenCalledTimes(20);
    expect(getLoginRateLimitDiagnostics().totalPendingCount).toBe(0);
  });

  it('O) should release reservations cleanly on successful login bursts and on DB/bcrypt exceptions', async () => {
    process.env.LOGIN_TRUSTED_PROXY_HOPS = '1';

    // 1. 15 logins válidos seguidos nunca bloqueiam nem vazam pending
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u-ok',
      email: 'ok@local',
      role: 'ADMIN',
      passwordHash: 'hash',
      isActive: true,
      sessionVersion: 0,
    } as NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>);
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);

    for (let i = 0; i < 15; i++) {
      const okRes = await POST(
        mockReq({ username: 'ok@local', password: 'good' }, { 'x-forwarded-for': '203.0.113.70' })
      );
      expect(okRes.status).toBe(200);
    }
    expect(getLoginRateLimitDiagnostics().totalPendingCount).toBe(0);
    expect(getLoginRateLimitDiagnostics().primarySize).toBe(0);

    // 2. Exceções de banco e de bcrypt não deixam reserva presa
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('DB_UNAVAILABLE'));
    for (let i = 0; i < 8; i++) {
      await expect(
        POST(mockReq({ username: 'exc@local', password: 'pw' }, { 'x-forwarded-for': '203.0.113.71' }))
      ).rejects.toThrow('DB_UNAVAILABLE');
    }
    expect(getLoginRateLimitDiagnostics().totalPendingCount).toBe(0);
    expect(getLoginRateLimitDiagnostics().primarySize).toBe(0);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u-exc',
      email: 'exc@local',
      role: 'ADMIN',
      passwordHash: 'hash',
      isActive: true,
      sessionVersion: 0,
    } as NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>);
    vi.mocked(bcrypt.compare).mockRejectedValue(new Error('BCRYPT_CRASH'));
    for (let i = 0; i < 8; i++) {
      await expect(
        POST(mockReq({ username: 'exc@local', password: 'pw' }, { 'x-forwarded-for': '203.0.113.71' }))
      ).rejects.toThrow('BCRYPT_CRASH');
    }
    expect(getLoginRateLimitDiagnostics().totalPendingCount).toBe(0);
    expect(getLoginRateLimitDiagnostics().primarySize).toBe(0);

    // Logo após as exceções, login válido funciona normalmente com 200
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);
    const recoverRes = await POST(
      mockReq({ username: 'exc@local', password: 'good' }, { 'x-forwarded-for': '203.0.113.71' })
    );
    expect(recoverRes.status).toBe(200);
  });

  it('P) should isolate in-flight pending reservations across window expiry inside POST /api/login', async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date('2026-11-11T12:00:00.000Z');
      vi.setSystemTime(t0);
      process.env.LOGIN_TRUSTED_PROXY_HOPS = '1';

      let releaseInFlight!: (val: boolean) => void;
      const inFlightGate = new Promise<boolean>((resolve) => {
        releaseInFlight = resolve;
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u-exp',
        email: 'expiry@local',
        role: 'ADMIN',
        passwordHash: 'hash',
        isActive: true,
        sessionVersion: 0,
      } as NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>);

      // 1. Dispara tentativa r1 que ficará pendente no bcrypt durante a virada da janela
      vi.mocked(bcrypt.compare).mockImplementationOnce(() => inFlightGate as unknown as Promise<boolean>);
      const req1Promise = POST(
        mockReq({ username: 'expiry@local', password: 'wrong' }, { 'x-forwarded-for': '203.0.113.85' })
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(getLoginRateLimitDiagnostics().totalPendingCount).toBe(2); // PAIR + IP

      // 2. Avança o relógio para exatamente o instante de expiração (15 min) enquanto r1 continua pendente
      vi.setSystemTime(new Date(t0.getTime() + 15 * 60 * 1000));
      vi.mocked(bcrypt.compare).mockImplementation(async () => false);
      const req2Res = await POST(
        mockReq({ username: 'expiry@local', password: 'wrong' }, { 'x-forwarded-for': '203.0.113.85' })
      );
      expect(req2Res.status).toBe(401);
      expect(getLoginRateLimitDiagnostics().retiringSize).toBe(2); // r1 PAIR + IP aposentados com epoch preservado

      // 3. Conclui r1 como falha após expiração -> retiring limpa completamente e nova geração permanece íntegra
      releaseInFlight(false);
      const req1Res = await req1Promise;
      expect(req1Res.status).toBe(401);

      const diag = getLoginRateLimitDiagnostics();
      expect(diag.retiringSize).toBe(0);
      expect(diag.totalPendingCount).toBe(0);

      // 4. Mais 4 falhas bloqueiam exatamente na 5a (r2 contou como 1/5 na nova geração)
      for (let i = 0; i < 4; i++) {
        expect(
          (
            await POST(
              mockReq({ username: 'expiry@local', password: 'wrong' }, { 'x-forwarded-for': '203.0.113.85' })
            )
          ).status
        ).toBe(401);
      }
      expect(
        (
          await POST(
            mockReq({ username: 'expiry@local', password: 'wrong' }, { 'x-forwarded-for': '203.0.113.85' })
          )
        ).status
      ).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });
});
