import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { CandidateResolver } from '../src/lib/metadata/CandidateResolver';

describe('Round Isolation', () => {
  let electionId: string;
  let round1Id: string;
  let round2Id: string;

  beforeAll(async () => {
    // Limpa a base
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.candidateMetadata.deleteMany();

    // Cria Eleição e 2 Turnos
    const election = await prisma.election.create({
      data: {
        year: 2026,
        plei: '3220',
        status: 'ACTIVE',
        name: 'Eleição Teste'
      }
    });
    electionId = election.id;

    const r1 = await prisma.electionRound.create({
      data: {
        electionId,
        roundNumber: 1,
        status: 'FINISHED'
      }
    });
    round1Id = r1.id;

    const r2 = await prisma.electionRound.create({
      data: {
        electionId,
        roundNumber: 2,
        status: 'ACTIVE'
      }
    });
    round2Id = r2.id;

    // Encontra o Office PRESIDENTE
    let presOffice = await prisma.office.findFirst({ where: { name: 'Presidente' } });
    if (!presOffice) {
      presOffice = await prisma.office.create({ data: { name: 'Presidente', orderNumber: 1 } });
    }
    const officeId = presOffice.id;

    // Cria BUs para R1 e R2
    await prisma.ballotReport.create({
      data: {
        deterministicId: 'R1-1',
        electionId,
        roundId: round1Id,
        status: 'PROCESSADO',
        isSimulation: false,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '90',
        sectionCode: '100',
        urnCode: '99',
        votes: {
          create: [
            { officeId: officeId, voteType: 'NOMINAL', candidateNumber: '13', quantity: 100 }
          ]
        }
      }
    });

    await prisma.ballotReport.create({
      data: {
        deterministicId: 'R2-1',
        electionId,
        roundId: round2Id,
        status: 'PROCESSADO',
        isSimulation: false,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '90',
        sectionCode: '100',
        urnCode: '99',
        votes: {
          create: [
            { officeId: officeId, voteType: 'NOMINAL', candidateNumber: '13', quantity: 40 }
          ]
        }
      }
    });

    // Cria CandidateMetadata nos dois turnos
    await prisma.candidateMetadata.create({
      data: {
        candidateSequence: '90001',
        electionYear: 2026,
        electionCode: '6257',
        round: 1,
        state: 'BR',
        officeCode: '1',
        officeName: 'PRESIDENTE',
        candidateNumber: '13',
        ballotName: 'LULA R1',
        partyNumber: '13',
        partyAbbreviation: 'PT',
        partyName: 'PT',
        source: 'test'
      }
    });

    await prisma.candidateMetadata.create({
      data: {
        candidateSequence: '90002',
        electionYear: 2026,
        electionCode: '6259',
        round: 2,
        state: 'BR',
        officeCode: '1',
        officeName: 'PRESIDENTE',
        candidateNumber: '13',
        ballotName: 'LULA R2',
        partyNumber: '13',
        partyAbbreviation: 'PT',
        partyName: 'PT',
        source: 'test'
      }
    });
  });

  afterAll(async () => {
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.candidateMetadata.deleteMany();
  });

  it('TOTALIZAÇÃO: deve totalizar apenas o round ACTIVE (Round 2)', async () => {
    const { GET } = await import('../src/app/api/totals/route');
    
    // As the API is mocked, we need to bypass Next Request/Response
    const res = await GET(new Request('http://localhost/api/totals')) as any;
    const json = await res.json();
    
    expect(json.processedReports).toBe(1);
    
    const vote = json.totals.find((t: any) => t.candidateNumber === '13');
    expect(vote.quantity).toBe(40);
    // Not 140!
    expect(vote.candidateName).toBe('LULA R2');
  });

  it('INVERSÃO: invertendo ACTIVE para Round 1, deve totalizar 100', async () => {
    await prisma.electionRound.update({ where: { id: round2Id }, data: { status: 'FINISHED' } });
    await prisma.electionRound.update({ where: { id: round1Id }, data: { status: 'ACTIVE' } });

    const { GET } = await import('../src/app/api/totals/route');
    const res = await GET(new Request('http://localhost/api/totals')) as any;
    const json = await res.json();
    
    expect(json.processedReports).toBe(1);
    const vote = json.totals.find((t: any) => t.candidateNumber === '13');
    expect(vote.quantity).toBe(100);
    expect(vote.candidateName).toBe('LULA R1');
    
    // Revert para os próximos testes
    await prisma.electionRound.update({ where: { id: round2Id }, data: { status: 'ACTIVE' } });
  });

  it('METADATA: Resolver contextualizado por round não resulta em AMBIGUOUS', async () => {
    const resolverR1 = new CandidateResolver();
    await resolverR1.load(2026, 1);
    const result1 = resolverR1.resolveNominal(2026, 1, 'BR', '1', '13');
    expect(result1.status).toBe('FOUND');
    expect(result1.candidateName).toBe('LULA R1');

    const resolverR2 = new CandidateResolver();
    await resolverR2.load(2026, 2);
    const result2 = resolverR2.resolveNominal(2026, 2, 'BR', '1', '13');
    expect(result2.status).toBe('FOUND');
    expect(result2.candidateName).toBe('LULA R2');
  });

  it('CONFIGURAÇÃO AMBÍGUA: Múltiplos rounds ACTIVE', async () => {
    await prisma.electionRound.update({ where: { id: round1Id }, data: { status: 'ACTIVE' } });
    
    const { GET } = await import('../src/app/api/totals/route');
    const res = await GET(new Request('http://localhost/api/totals')) as any;
    const json = await res.json();
    
    expect(json.error).toContain('ambígua: múltiplos turnos');
    expect(res.status).toBe(500);

    // Revert
    await prisma.electionRound.update({ where: { id: round1Id }, data: { status: 'FINISHED' } });
  });

  it('HISTÓRICO: reports continuam existindo globalmente', async () => {
    const count = await prisma.ballotReport.count();
    expect(count).toBe(2);
  });
});
