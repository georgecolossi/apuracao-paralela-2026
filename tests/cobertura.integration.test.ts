import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/lib/db';
import { POST } from '../src/app/api/admin/cobertura/route';
import * as auth from '../src/lib/auth';

let mockAuthData = { authenticated: false, role: 'OPERATOR', userId: 'user-1' };

vi.mock('../src/lib/auth', () => ({
  requireAuthenticatedUser: vi.fn(async () => {
    if (!mockAuthData.authenticated) return { authenticated: false, reason: 'NO_TOKEN' };
    return { authenticated: true, user: { userId: mockAuthData.userId, role: mockAuthData.role } };
  })
}));

describe('API Admin Cobertura (Integration)', () => {
  beforeEach(async () => {
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();

    await prisma.user.create({ data: { id: 'user-1', name: 'User 1', email: 'user1@test.com', role: 'ADMIN', passwordHash: 'hash' } });
    
    // Seed some data
    const sc = await prisma.state.create({ data: { abbreviation: 'SC', name: 'Santa Catarina' } });
    const sp = await prisma.state.create({ data: { abbreviation: 'SP', name: 'São Paulo' } });
    
    await prisma.municipality.createMany({
      data: [
        { officialCode: '80837', name: 'CONCÓRDIA', stateId: sc.id, isCoverage: true },
        { officialCode: '81051', name: 'ERVAL VELHO', stateId: sc.id, isCoverage: false },
        { officialCode: '71072', name: 'SÃO PAULO', stateId: sp.id, isCoverage: false }
      ]
    });
  });

  const mockAuth = (authenticated: boolean, role: string = 'OPERATOR', userId: string = 'user-1') => {
    mockAuthData = { authenticated, role, userId };
  };

  it('C) não autenticado -> 401', async () => {
    mockAuth(false);
    const req = new Request('http://localhost/api/admin/cobertura', { method: 'POST', body: JSON.stringify({ coverageCodes: ['80837'] }) });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('D) OPERATOR -> 403', async () => {
    mockAuth(true, 'OPERATOR');
    const req = new Request('http://localhost/api/admin/cobertura', { method: 'POST', body: JSON.stringify({ coverageCodes: ['80837'] }) });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('E) ADMIN -> consegue atualizar e I) AuditLog contém before/after', async () => {
    mockAuth(true, 'ADMIN');
    const req = new Request('http://localhost/api/admin/cobertura', { 
      method: 'POST', 
      body: JSON.stringify({ coverageCodes: ['80837', '81051'] }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const cvg = await prisma.municipality.findMany({ where: { isCoverage: true } });
    expect(cvg.length).toBe(2);

    const log = await prisma.auditLog.findFirst({ where: { action: 'UPDATE_COVERAGE' } });
    expect(log).not.toBeNull();
    expect(log!.identifiers).toBe('before=80837;after=80837,81051');
  });

  it('F) código inexistente -> 400', async () => {
    mockAuth(true, 'ADMIN');
    const req = new Request('http://localhost/api/admin/cobertura', { 
      method: 'POST', 
      body: JSON.stringify({ coverageCodes: ['99999'] }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    
    // Cobertura anterior preservada
    const cvg = await prisma.municipality.findMany({ where: { isCoverage: true } });
    expect(cvg.length).toBe(1);
  });

  it('G) município fora de SC -> 400', async () => {
    mockAuth(true, 'ADMIN');
    const req = new Request('http://localhost/api/admin/cobertura', { 
      method: 'POST', 
      body: JSON.stringify({ coverageCodes: ['71072'] }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('J) município com BU real processado -> 409', async () => {
    // Seed real BU for Concordia
const createdElection = await prisma.election.create({
      data: {
        plei: '123', name: 'Test', year: 2026, status: 'ACTIVE',
        rounds: { create: [{ roundNumber: 1, status: 'ACTIVE' }] }
      },
      include: { rounds: true }
    });
    const session = await prisma.scanSession.create({ data: { operatorId: 'user-1', sequenceId: 'seq1', expectedParts: 1 }});
    await prisma.ballotReport.create({
      data: {
        hash: 'abc', electionId: createdElection.id, roundId: createdElection.rounds[0].id, deterministicId: 'det1',
        stateCode: 'SC', cityCode: '80837', zoneCode: '1', sectionCode: '1', urnCode: '1',
        status: 'PROCESSADO', isSimulation: false
      }
    });

    mockAuth(true, 'ADMIN');
    // Tentativa de remover Concordia
    const req = new Request('http://localhost/api/admin/cobertura', { 
      method: 'POST', 
      body: JSON.stringify({ coverageCodes: ['81051'] }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(409);

    // Cobertura anterior preservada
    const cvg = await prisma.municipality.findMany({ where: { isCoverage: true } });
    expect(cvg.length).toBe(1);
    expect(cvg[0].officialCode).toBe('80837');
  });

  it('K) adicionar novo município -> permitido', async () => {
    // Igual ao E
    mockAuth(true, 'ADMIN');
    const req = new Request('http://localhost/api/admin/cobertura', { 
      method: 'POST', 
      body: JSON.stringify({ coverageCodes: ['80837', '81051'] }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
