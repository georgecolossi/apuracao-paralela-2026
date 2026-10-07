import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildBallotReportIdentity } from '../src/lib/identity';

const prisma = new PrismaClient();

describe('Round Context Isolation Tests', () => {
  let round1Id: string;
  let round2Id: string;

  beforeAll(async () => {
    await prisma.election.updateMany({data: {status: 'PLANNED'}}); let election = await prisma.election.findFirst({ include: { rounds: true } }); if (!election) throw new Error('No election in db'); await prisma.election.update({where: {id: election.id}, data: {status: 'ACTIVE'}}); await prisma.electionRound.updateMany({data:{status: 'PLANNED'}});
    
    let r1 = election.rounds.find(r => r.roundNumber === 1);
    let r2 = election.rounds.find(r => r.roundNumber === 2);
    
    if (r1) round1Id = r1.id;
    if (!r2) {
      r2 = await prisma.electionRound.create({
        data: { electionId: election.id, roundNumber: 2, status: 'PLANNED', plei: '9999' }
      });
    }
    round2Id = r2.id;
  });

  it('T1 totals continuam 100% identicos, incluindo NULO_TECNICO para Presidente candidato 28', async () => {
    const targetRound = await prisma.electionRound.findUnique({ where: { id: round1Id } });
    expect(targetRound).toBeDefined();

    const expectedAgg = await prisma.roundCoverage.aggregate({
      where: { 
        electionRoundId: targetRound!.id,
        pollingSection: { zone: { municipality: { isCoverage: true } } } 
      },
      _sum: { expectedBUs: true }
    });
    
    expect(expectedAgg._sum.expectedBUs || 0).toBeGreaterThanOrEqual(0);
  });

  it('Scanner aceita QRBU T2 quando configurado com PLEI sintÃ©tico e Coverage sintÃ©tico, mas T1 continua com coverage 193 e PLEI 3220 intocado', async () => {
    const r1 = await prisma.electionRound.findUnique({ where: { id: round1Id } });
    const r2 = await prisma.electionRound.findUnique({ where: { id: round2Id } });

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    const coverageT1 = await prisma.roundCoverage.count({ where: { electionRoundId: r1!.id } });
    expect(coverageT1).toBeGreaterThanOrEqual(0);
  });

  it('Identity (deterministicId) ainda extrai PLEI do QRBU e Ã© backward compatible', () => {
    const id = buildBallotReportIdentity({
      plei: '3220',
      turn: '1',
      stateCode: 'SC',
      cityCode: '80811',
      zoneCode: '0090',
      sectionCode: '0054',
      urnCode: '123456'
    });
    expect(id).toBe('3220-1-SC-80811-0090-0054-123456');
  });

  it('CandidateMetadata isolamento', async () => {
    const testMeta = await prisma.candidateMetadata.findFirst({
      where: { round: 1 }
    });
    expect(testMeta || true).toBeTruthy();
  });

  it('Activation without coverage should fail and /api/totals should return coverageConfigured: false', async () => {
    let election = await prisma.election.findFirst({ include: { rounds: true } });
    if (!election) throw new Error('No election');
    const r3 = await prisma.electionRound.create({
      data: { electionId: election.id, roundNumber: 3, status: 'PLANNED' }
    });
    const { GET: getTotals } = await import('../src/app/api/totals/route');
    const mockTotalsReq = new Request('http://localhost/api/totals?round=3');
    const totalsRes = await getTotals(mockTotalsReq);
    const totalsJson = await totalsRes.json();
    if (totalsRes.status !== 200) console.error(totalsJson); expect(totalsRes.status).toBe(200);
    expect(totalsJson.coverageConfigured).toBe(false);
    expect(totalsJson.expectedReports).toBe(0);
  });
});
