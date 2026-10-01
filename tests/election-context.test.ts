import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Election Context Resolution', () => {
  beforeAll(async () => {
    // Não limpa banco para evitar quebrar testes em paralelo, limpa apenas os específicos
    await prisma.ballotVote.deleteMany({
      where: { report: { election: { plei: { in: ['2110', 'PLEI-STATUS', '123', '2110MBIGUO'] } } } }
    });
    await prisma.ballotReport.deleteMany({
      where: { election: { plei: { in: ['2110', 'PLEI-STATUS', '123', '2110MBIGUO'] } } }
    });
    await prisma.electionRound.deleteMany({
      where: { election: { plei: { in: ['2110', 'PLEI-STATUS', '123', '2110MBIGUO'] } } }
    });
    await prisma.election.deleteMany({
      where: { plei: { in: ['2110', 'PLEI-STATUS', '123', '2110MBIGUO'] } }
    });

    // Eleição A
    const electionA = await prisma.election.create({
      data: { plei: '2110', name: 'Eleição A', year: 2026, status: 'ACTIVE' }
    });
    await prisma.electionRound.create({ data: { electionId: electionA.id, roundNumber: 1, status: 'ACTIVE' } });

    // Eleição Ambígua (mesmo plei)
    const electionAmbigua = await prisma.election.create({
      data: { plei: '2110MBIGUO', name: 'Ambigua 1', year: 2026, status: 'ACTIVE' }
    });
    await prisma.electionRound.create({ data: { electionId: electionAmbigua.id, roundNumber: 1, status: 'ACTIVE' } });

    const electionAmbigua2 = await prisma.election.create({
      data: { plei: '2110MBIGUO', name: 'Ambigua 2', year: 2026, status: 'ACTIVE' }
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
    const activeRound = activeElection.rounds.find(r => r.roundNumber === turn && r.status === 'ACTIVE');

    if (!activeRound) return { error: 'ELECTION_CONTEXT_MISMATCH_TURN' };
    
    return { success: true, electionId: activeElection.id, roundId: activeRound.id };
  }

  it('deve aceitar se PLEI e TURN baterem', async () => {
    const res = await mockApiScanResolveContext('2110', 1);
    expect(res.success).toBe(true);
  });

  it('deve rejeitar se PLEI for incorreto (não cadastrado)', async () => {
    const res = await mockApiScanResolveContext('123', 1);
    expect(res.error).toBe('ELECTION_CONTEXT_MISMATCH');
  });

  it('deve rejeitar se TURN for incorreto', async () => {
    const res = await mockApiScanResolveContext('2110', 2);
    expect(res.error).toBe('ELECTION_CONTEXT_MISMATCH_TURN');
  });

  it('deve falhar de maneira previsível caso múltiplas eleições dividam o mesmo PLEI ACTIVE', async () => {
    const res = await mockApiScanResolveContext('2110MBIGUO', 1);
    expect(res.error).toBe('CONFIGURATION_ERROR');
  });

  describe('Round Status', () => {
    beforeAll(async () => {
      const elStatus = await prisma.election.create({
        data: { plei: 'PLEI-STATUS', name: 'Eleição Status', year: 2026, status: 'ACTIVE' }
      });
      await prisma.electionRound.create({ data: { electionId: elStatus.id, roundNumber: 1, status: 'FINISHED' } });
      await prisma.electionRound.create({ data: { electionId: elStatus.id, roundNumber: 2, status: 'ACTIVE' } });
    });

    it('TURN 1 (FINISHED) deve ser rejeitado', async () => {
      const res = await mockApiScanResolveContext('PLEI-STATUS', 1);
      expect(res.error).toBe('ELECTION_CONTEXT_MISMATCH_TURN');
    });

    it('TURN 2 (ACTIVE) deve ser aceito', async () => {
      const res = await mockApiScanResolveContext('PLEI-STATUS', 2);
      expect(res.success).toBe(true);
    });
  });
});
