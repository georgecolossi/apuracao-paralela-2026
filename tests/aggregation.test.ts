import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildBallotReportIdentity } from '../src/lib/identity';

const prisma = new PrismaClient();

describe('Totalization and Aggregation Service', () => {
  let electionId: string;
  let roundId: string;
  let officeId: string;

  beforeAll(async () => {
    // Cleanup first
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.office.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});

    // Setup Election
    const election = await prisma.election.create({
      data: { plei: '456', name: 'Eleição Teste Agregação', year: 2026, status: 'ACTIVE' }
    });
    electionId = election.id;

    const round = await prisma.electionRound.create({
      data: { electionId, roundNumber: 1, status: 'ACTIVE' }
    });
    roundId = round.id;

    const office = await prisma.office.create({
      data: { name: 'Presidente', orderNumber: 1 }
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

  async function insertBU(urnCode: string, votes: { candidateNumber?: string; partyNumber?: string; voteType: string; quantity: number }[]) {
    const deterministicId = buildBallotReportIdentity({
      plei: '456', turn: '1', stateCode: 'BR', cityCode: 'BR', zoneCode: '0001', sectionCode: '0001', urnCode
    });

    const report = await prisma.ballotReport.create({
      data: {
        deterministicId, electionId, roundId, stateCode: 'BR', cityCode: 'BR', zoneCode: '0001', sectionCode: '0001', urnCode,
        status: 'PROCESSADO', isSimulation: false
      }
    });

    for (const v of votes) {
      await prisma.ballotVote.create({
        data: {
          reportId: report.id, officeId, candidateNumber: v.candidateNumber, partyNumber: v.partyNumber, voteType: v.voteType, quantity: v.quantity
        }
      });
    }
  }

  it('deve agregar os votos corretamente de múltiplos BUs e separar candidatos diferentes', async () => {
    // BU A
    await insertBU('URN001', [
      { candidateNumber: '13', partyNumber: '13', voteType: 'NOMINAL', quantity: 100 },
      { candidateNumber: '22', partyNumber: '22', voteType: 'NOMINAL', quantity: 80 },
      { voteType: 'BRANCO', quantity: 5 },
      { voteType: 'NULO', quantity: 3 },
    ]);

    // BU B
    await insertBU('URN002', [
      { candidateNumber: '13', partyNumber: '13', voteType: 'NOMINAL', quantity: 50 },
      { candidateNumber: '22', partyNumber: '22', voteType: 'NOMINAL', quantity: 120 },
      { voteType: 'BRANCO', quantity: 2 },
      { voteType: 'NULO', quantity: 4 },
    ]);

    // Simular chamada do API totals (ou AggregationService)
    const rawTotals = await prisma.ballotVote.groupBy({
      by: ['officeId', 'candidateNumber', 'partyNumber', 'voteType'],
      where: { report: { electionId, status: 'PROCESSADO', isSimulation: false } },
      _sum: { quantity: true }
    });

    const cand13 = rawTotals.find(t => t.candidateNumber === '13' && t.voteType === 'NOMINAL');
    const cand22 = rawTotals.find(t => t.candidateNumber === '22' && t.voteType === 'NOMINAL');
    const brancos = rawTotals.find(t => t.voteType === 'BRANCO');
    const nulos = rawTotals.find(t => t.voteType === 'NULO');

    expect(cand13?._sum.quantity).toBe(150);
    expect(cand22?._sum.quantity).toBe(200);
    expect(brancos?._sum.quantity).toBe(7);
    expect(nulos?._sum.quantity).toBe(7);

    // Duplicate BU A - O sistema rejeitaria na API pelo deterministicId, mas vamos tentar criar direto e deve falhar no banco!
    let duplicateFailed = false;
    try {
      await insertBU('URN001', [
        { candidateNumber: '13', partyNumber: '13', voteType: 'NOMINAL', quantity: 100 }
      ]);
    } catch {
      duplicateFailed = true;
    }
    expect(duplicateFailed).toBe(true);

    const reportsCount = await prisma.ballotReport.count({ where: { electionId, status: 'PROCESSADO', isSimulation: false } });
    expect(reportsCount).toBe(2);
  });
});
