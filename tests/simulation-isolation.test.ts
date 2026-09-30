import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildBallotReportIdentity } from '../src/lib/identity';

const prisma = new PrismaClient();

describe('Simulation Isolation', () => {
  let electionId: string;
  let roundId: string;
  let officeId: string;

  beforeAll(async () => {
    const election = await prisma.election.create({
      data: { plei: '789', name: 'Eleição Teste Simulação', year: 2026, status: 'ACTIVE' }
    });
    electionId = election.id;

    const round = await prisma.electionRound.create({
      data: { electionId, roundNumber: 1, status: 'ACTIVE' }
    });
    roundId = round.id;

    const office = await prisma.office.create({
      data: { name: 'Governador', orderNumber: 1 }
    });
    officeId = office.id;
  });

  afterAll(async () => {
    await prisma.ballotVote.deleteMany({ where: { report: { electionId } } });
    await prisma.ballotReport.deleteMany({ where: { electionId } });
    await prisma.office.deleteMany({ where: { id: officeId } });
    await prisma.electionRound.deleteMany({ where: { id: roundId } });
    await prisma.election.deleteMany({ where: { id: electionId } });
    await prisma.$disconnect();
  });

  async function insertBU(urnCode: string, quantity: number, isSimulation: boolean) {
    const deterministicId = buildBallotReportIdentity({
      plei: '789', turn: '1', stateCode: 'BR', cityCode: 'BR', zoneCode: '0001', sectionCode: '0001', urnCode
    });

    const report = await prisma.ballotReport.create({
      data: {
        deterministicId, electionId, roundId, stateCode: 'BR', cityCode: 'BR', zoneCode: '0001', sectionCode: '0001', urnCode,
        status: 'PROCESSADO', isSimulation
      }
    });

    await prisma.ballotVote.create({
      data: {
        reportId: report.id, officeId, candidateNumber: '50', partyNumber: '50', voteType: 'NOMINAL', quantity
      }
    });
  }

  it('deve garantir que votos de simulação NUNCA apareçam na agregação real', async () => {
    // BU REAL com 100 votos
    await insertBU('URN_REAL', 100, false);
    
    // BU SIMULADO com 900 votos
    await insertBU('URN_SIM', 900, true);

    // Consulta real como a feita por /api/totals
    const rawTotals = await prisma.ballotVote.groupBy({
      by: ['officeId', 'candidateNumber', 'partyNumber', 'voteType'],
      where: { report: { electionId, status: 'PROCESSADO', isSimulation: false } },
      _sum: { quantity: true }
    });

    expect(rawTotals.length).toBe(1);
    expect(rawTotals[0]._sum.quantity).toBe(100);
    expect(rawTotals[0]._sum.quantity).not.toBe(1000);
  });
});
