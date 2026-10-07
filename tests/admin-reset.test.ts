import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../src/app/api/admin/reset/route';
import { requireAuthenticatedUser } from '../src/lib/auth';
import { prisma } from '../src/lib/db';

vi.mock('../src/lib/auth', () => ({
  requireAuthenticatedUser: vi.fn(),
}));

const mockTx = {
  ballotVote: { deleteMany: vi.fn() },
  ballotReportPart: { deleteMany: vi.fn() },
  auditLog: { deleteMany: vi.fn(), create: vi.fn() },
  ballotReport: { deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([{ id: 'report-1' }]) },
  scanSession: { deleteMany: vi.fn() },
  election: { deleteMany: vi.fn() },
  electionRound: { deleteMany: vi.fn(), findUnique: vi.fn() },
  state: { deleteMany: vi.fn() },
  municipality: { deleteMany: vi.fn() },
  candidateMetadata: { deleteMany: vi.fn() },
  user: { deleteMany: vi.fn() },
};

vi.mock('../src/lib/db', () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => {
      if (typeof callback === 'function') {
        return callback(mockTx);
      }
    }),
    electionRound: {
      findUnique: vi.fn().mockResolvedValue({ id: 'round-1', roundNumber: 1, election: { id: 'elec-1' } })
    }
  },
}));

describe('POST /api/admin/reset', () => {
  const mockReq = (body: any) => ({
    json: vi.fn().mockResolvedValue(body),
  } as any as Request);

  const originalEnv = process.env.ALLOW_OPERATIONAL_RESET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.electionRound.findUnique).mockResolvedValue({ id: 'round-1', roundNumber: 1, election: { id: 'elec-1' } } as any);
  });

  afterEach(() => {
    process.env.ALLOW_OPERATIONAL_RESET = originalEnv;
  });

  it('A) should return 401 if user is not authenticated', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: false } as any);
    const req = mockReq({ confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: 'round-1' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('B) should return 403 if user is not ADMIN', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'OPERATOR' },
    } as any);
    const req = mockReq({ confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: 'round-1' });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('D) should return 403 if interlock is not explicitly enabled', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'false';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'ADMIN' },
    } as any);
    const req = mockReq({ confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: 'round-1' });
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
    const req = mockReq({ confirmationText: 'ERRADO', roundId: 'round-1' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('C2) should return 400 if roundId is missing', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'true';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'ADMIN' },
    } as any);
    const req = mockReq({ confirmationText: 'ZERAR PRIMEIRO TURNO' }); // no roundId
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('C3) should return 404 if round does not exist', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'true';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { role: 'ADMIN' },
    } as any);
    vi.mocked(prisma.electionRound.findUnique).mockResolvedValue(null);
    const req = mockReq({ confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: 'invalid' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('E) should permit reset if all conditions are met', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'true';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { userId: '1', role: 'ADMIN' },
    } as any);
    const req = mockReq({ confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: 'round-1' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();

    // Comprovando as exclusões esperadas
    expect(mockTx.ballotVote.deleteMany).toHaveBeenCalledWith({ where: { reportId: { in: ['report-1'] } } });
    expect(mockTx.ballotReport.deleteMany).toHaveBeenCalledWith({ where: { roundId: 'round-1' } });

    // Comprovando a criação do log de sistema
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'ROUND_RESET',
        result: 'SUCCESS'
      })
    }));

    // Comprovando que configurações não foram apagadas
    expect(mockTx.election.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.electionRound.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.state.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.municipality.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.candidateMetadata.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.user.deleteMany).not.toHaveBeenCalled();
  });

  it('F) should rollback and return 500 if transaction throws an error', async () => {
    process.env.ALLOW_OPERATIONAL_RESET = 'true';
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      authenticated: true,
      user: { userId: '1', role: 'ADMIN' },
    } as any);

    // Força um erro dentro da transação mockada
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('Simulated DB Error'));

    const req = mockReq({ confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: 'round-1' });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Erro ao zerar sistema');
  });
});
