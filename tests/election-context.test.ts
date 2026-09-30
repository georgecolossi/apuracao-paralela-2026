import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Election Context Resolution', () => {
  beforeAll(async () => {
    // Limpar state anterior
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});

    // Eleição A
    const electionA = await prisma.election.create({
      data: { plei: 'PLEI-A', name: 'Eleição A', year: 2026, status: 'ACTIVE' }
    });
    await prisma.electionRound.create({ data: { electionId: electionA.id, roundNumber: 1, status: 'ACTIVE' } });

    // Eleição Ambígua (mesmo plei)
    const electionAmbigua = await prisma.election.create({
      data: { plei: 'PLEI-AMBIGUO', name: 'Ambigua 1', year: 2026, status: 'ACTIVE' }
    });
    await prisma.electionRound.create({ data: { electionId: electionAmbigua.id, roundNumber: 1, status: 'ACTIVE' } });

    const electionAmbigua2 = await prisma.election.create({
      data: { plei: 'PLEI-AMBIGUO', name: 'Ambigua 2', year: 2026, status: 'ACTIVE' }
    });
    await prisma.electionRound.create({ data: { electionId: electionAmbigua2.id, roundNumber: 1, status: 'ACTIVE' } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function mockApiScanResolveContext(plei: string, turn: number) {
    const activeElections = await prisma.election.findMany({
      where: { plei, status: 'ACTIVE' },
      include: { rounds: true }
    });

    if (activeElections.length === 0) return { error: 'ELECTION_CONTEXT_MISMATCH' };
    if (activeElections.length > 1) return { error: 'CONFIGURATION_ERROR' };

    const activeElection = activeElections[0];
    const activeRound = activeElection.rounds.find(r => r.roundNumber === turn);

    if (!activeRound) return { error: 'ELECTION_CONTEXT_MISMATCH_TURN' };
    
    return { success: true, electionId: activeElection.id, roundId: activeRound.id };
  }

  it('deve aceitar se PLEI e TURN baterem', async () => {
    const res = await mockApiScanResolveContext('PLEI-A', 1);
    expect(res.success).toBe(true);
  });

  it('deve rejeitar se PLEI for incorreto (não cadastrado)', async () => {
    const res = await mockApiScanResolveContext('PLEI-INEXISTENTE', 1);
    expect(res.error).toBe('ELECTION_CONTEXT_MISMATCH');
  });

  it('deve rejeitar se TURN for incorreto', async () => {
    const res = await mockApiScanResolveContext('PLEI-A', 2);
    expect(res.error).toBe('ELECTION_CONTEXT_MISMATCH_TURN');
  });

  it('deve falhar de maneira previsível caso múltiplas eleições dividam o mesmo PLEI ACTIVE', async () => {
    const res = await mockApiScanResolveContext('PLEI-AMBIGUO', 1);
    expect(res.error).toBe('CONFIGURATION_ERROR');
  });
});
