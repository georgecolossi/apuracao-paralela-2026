import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../src/app/api/admin/reset/route';
import { requireAuthenticatedUser } from '../src/lib/auth';
import { prisma } from '../src/lib/db';

vi.mock('../src/lib/auth', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock('../src/lib/db', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

describe('POST /api/admin/reset', () => {
  const mockReq = (body: any) => ({
    json: vi.fn().mockResolvedValue(body),
  } as any as Request);

  const originalEnv = process.env.ALLOW_OPERATIONAL_RESET;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.ALLOW_OPERATIONAL_RESET = originalEnv;
  });

  it('A) should return 401 if user is not authenticated', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: false } as any);
    const req = mockReq({ confirmationText: 'ZERAR APURAÇÃO' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('B) should return 403 if user is not ADMIN', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'OPERATOR' },
    } as any);
    const req = mockReq({ confirmationText: 'ZERAR APURAÇÃO' });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('D) should return 403 if interlock is not explicitly enabled', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'false';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'ADMIN' },
    } as any);
    const req = mockReq({ confirmationText: 'ZERAR APURAÇÃO' });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('Reset desabilitado neste ambiente operacional.');
  });

  it('C) should return 400 if confirmation text is wrong', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'true';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'ADMIN' },
    } as any);
    const req = mockReq({ confirmationText: 'ERRADO' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('E) should permit reset if all conditions are met', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'true';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { userId: '1', role: 'ADMIN' },
    } as any);
    const req = mockReq({ confirmationText: 'ZERAR APURAÇÃO' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
