import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../src/app/api/login/route';
import { prisma } from '../src/lib/db';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { resetLoginRateLimitStore } from '../src/lib/security/loginRateLimiter';

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
});
