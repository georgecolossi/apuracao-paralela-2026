import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../src/app/api/export/route';
import { requireAuthenticatedUser } from '../src/lib/auth';
import { prisma } from '../src/lib/db';

vi.mock('../src/lib/auth', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({
  prisma: {
    ballotReport: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('GET /api/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockReq = (url = 'http://localhost/api/export') => ({ url } as Request);

  it('A) should return 401 if user is not authenticated', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: false } as any);
    const res = await GET(mockReq());
    expect(res.status).toBe(401);
  });

  it('B) should return 401 for invalid/inactive user (via requireAuthenticatedUser)', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: false, reason: 'USER_INACTIVE' } as any);
    const res = await GET(mockReq());
    expect(res.status).toBe(401);
  });

  it('C) should return 403 if role is inadequate', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'OPERATOR' }
    } as any);
    const res = await GET(mockReq());
    expect(res.status).toBe(403);
  });

  it('D) should permit export if user is authorized ADMIN', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'ADMIN' }
    } as any);
    const res = await GET(mockReq());
    expect(res.status).toBe(200);
    expect(prisma.ballotReport.findMany).toHaveBeenCalled();
  });
});
