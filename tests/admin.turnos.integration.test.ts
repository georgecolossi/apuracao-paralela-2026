import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/lib/db';
import { POST } from '../src/app/api/admin/turnos/activate/route';
import { requireAuthenticatedUser } from '../src/lib/auth';
import { vi } from 'vitest';

vi.mock('../src/lib/auth', () => ({
  requireAuthenticatedUser: vi.fn()
}));

function mockAuth(role: string = 'ADMIN') {
  vi.mocked(requireAuthenticatedUser).mockResolvedValue({
    authenticated: true,
    user: { userId: 'admin-1', username: 'admin', role }
  } as any);
}

function mockUnauth() {
  vi.mocked(requireAuthenticatedUser).mockResolvedValue({
    authenticated: false,
    user: null
  } as any);
}

describe('Admin Turnos Activation', () => {
  let electionId: string;
  let round1Id: string;
  let round2Id: string;
  let adminUserId: string;

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.roundCoverage.deleteMany({});
    await prisma.pollingSection.deleteMany({});
    await prisma.pollingZone.deleteMany({});
    await prisma.municipality.deleteMany({});
    await prisma.state.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});
    await prisma.user.deleteMany({});
    const usr = await prisma.user.create({ data: { name: 'Admin Test', passwordHash: 'hash', role: 'ADMIN', email: 'admin@test.com' } });
    adminUserId = usr.id;

    const el = await prisma.election.create({
      data: {
        year: 2026,
        name: 'Eleição 2026',
        plei: '3220',
        status: 'ACTIVE'
      }
    });
    electionId = el.id;

    const r1 = await prisma.electionRound.create({
      data: {
        electionId,
        roundNumber: 1,
        status: 'ACTIVE',
        plei: '3220'
      }
    });
    round1Id = r1.id;

    const r2 = await prisma.electionRound.create({
      data: {
        electionId,
        roundNumber: 2,
        status: 'PLANNED',
        plei: '3220'
      }
    });
    round2Id = r2.id;

    // Create fake coverage for r1 and r2
    const state = await prisma.state.create({ data: { name: 'Test', abbreviation: 'TS' } });
    const mun = await prisma.municipality.create({ data: { name: 'A', officialCode: '1', stateId: state.id } });
    const zone = await prisma.pollingZone.create({ data: { municipalityId: mun.id, zoneNumber: '1' } });
    const sec = await prisma.pollingSection.create({ data: { pollingZoneId: zone.id, sectionNumber: '1', expectedBUs: 1 } });

    await prisma.roundCoverage.create({ data: { electionRoundId: r1.id, pollingSectionId: sec.id, expectedBUs: 1 } });
    await prisma.roundCoverage.create({ data: { electionRoundId: r2.id, pollingSectionId: sec.id, expectedBUs: 1 } });
  });

  it('A. PLANNED -> ACTIVE: Deve transicionar round 1 para FINISHED e round 2 para ACTIVE', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: true, user: { userId: adminUserId, role: 'ADMIN' } } as any);

    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ roundId: round2Id })
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const r1 = await prisma.electionRound.findUnique({ where: { id: round1Id } });
    expect(r1?.status).toBe('FINISHED');

    const r2 = await prisma.electionRound.findUnique({ where: { id: round2Id } });
    expect(r2?.status).toBe('ACTIVE');

    const logs = await prisma.auditLog.findMany({ where: { action: 'TURN_ACTIVATED' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].identifiers).toContain(round2Id);
  });

  it('B. PRESERVAÇÃO: Não deve apagar reports ao ativar novo turno', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: true, user: { userId: adminUserId, role: 'ADMIN' } } as any);

    // Cria um report no round 1
    await prisma.ballotReport.create({
      data: {
        electionId,
        roundId: round1Id,
        status: 'PROCESSADO',
        isSimulation: false,
        deterministicId: 'DUMMY1',
        cityCode: '1', zoneCode: '1', sectionCode: '1', hash: 'H', stateCode: 'SC', urnCode: '123'
      }
    });

    const beforeCount = await prisma.ballotReport.count();
    expect(beforeCount).toBe(1);

    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ roundId: round2Id })
    });
    await POST(req);

    const afterCount = await prisma.ballotReport.count();
    expect(afterCount).toBe(1); // Histórico preservado
  });

  it('C. REABERTURA: Tentativa de ativar turno FINISHED deve falhar', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: true, user: { userId: adminUserId, role: 'ADMIN' } } as any);

    await prisma.electionRound.update({ where: { id: round1Id }, data: { status: 'FINISHED' } });
    await prisma.electionRound.update({ where: { id: round2Id }, data: { status: 'ACTIVE' } });

    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ roundId: round1Id })
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/PLANNED/);
  });

  it('D. AMBIGUIDADE: Se múltiplos rounds ACTIVE antes da chamada, deve falhar', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ authenticated: true, user: { userId: adminUserId, role: 'ADMIN' } } as any);

    // Força ambiguidade no setup
    await prisma.electionRound.update({ where: { id: round2Id }, data: { status: 'ACTIVE' } });

    // Tenta ativar um terceiro (ou um dos dois) - aqui o req envia round2Id, que já tá ACTIVE (não PLANNED)
    // Mas se ele estivesse PLANNED e houvesse DOIS ACTIVEs?
    const r3 = await prisma.electionRound.create({
      data: { electionId, roundNumber: 3, status: 'PLANNED', plei: '9999' }
    });
    const sec = await prisma.pollingSection.findFirst();
    if (sec) {
      await prisma.roundCoverage.create({ data: { electionRoundId: r3.id, pollingSectionId: sec.id, expectedBUs: 1 } });
    }

    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ roundId: r3.id })
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/múltiplos turnos/);
  });

  it('E. AUTORIZAÇÃO: Rejeita não autenticado e não admin', async () => {
    mockUnauth();
    const req1 = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ roundId: round2Id }) });
    const res1 = await POST(req1);
    expect(res1.status).toBe(403);

    mockAuth('OPERATOR');
    const req2 = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ roundId: round2Id }) });
    const res2 = await POST(req2);
    expect(res2.status).toBe(403);
  });

});
