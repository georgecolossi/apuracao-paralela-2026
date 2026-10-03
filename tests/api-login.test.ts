import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../src/app/api/login/route';
import { prisma } from '../src/lib/db';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

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

const mockReq = (body: any) => ({
  json: async () => body,
} as Request);

describe('POST /api/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A) should permit login with valid username and password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: '1', email: 'admin', role: 'ADMIN', passwordHash: 'hash', isActive: true } as any);
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
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: '1', email: 'admin', role: 'ADMIN', passwordHash: 'hash', isActive: true } as any);
    vi.mocked(bcrypt.compare).mockImplementation(async () => false);

    const res = await POST(mockReq({ username: 'admin', password: 'wrong_password' }));
    expect(res.status).toBe(401);
  });

  it('D) should reject if username is empty', async () => {
    const res = await POST(mockReq({ username: '', password: 'valid_password' }));
    expect(res.status).toBe(400);
  });

  it('E) should trim username and not require email format', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: '1', email: 'admin', role: 'ADMIN', passwordHash: 'hash', isActive: true } as any);
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);

    const res = await POST(mockReq({ username: '  admin  ', password: 'valid_password' }));
    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'admin' } });
  });

  it('G) should require password', async () => {
    const res = await POST(mockReq({ username: 'admin', password: '' }));
    expect(res.status).toBe(400);
  });
});
