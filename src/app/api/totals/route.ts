import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const election = await prisma.election.findFirst({ where: { status: 'ACTIVE' } });
    if (!election) return NextResponse.json({ processedReports: 0, totals: [] });

    const processedReportsCount = await prisma.ballotReport.count({
      where: {
        electionId: election.id,
        status: 'PROCESSADO',
        isSimulation: false
      }
    });

    const rawTotals = await prisma.ballotVote.groupBy({
      by: ['officeId', 'candidateNumber', 'partyNumber', 'voteType'],
      where: {
        report: {
          electionId: election.id,
          status: 'PROCESSADO',
          isSimulation: false
        }
      },
      _sum: {
        quantity: true
      }
    });

    const offices = await prisma.office.findMany();
    const officeMap = Object.fromEntries(offices.map(o => [o.id, o.name]));
    
    // Configura o resolver
    const { CandidateResolver } = await import('@/lib/metadata/CandidateResolver');
    const resolver = new CandidateResolver();
    await resolver.load(election.year);

    const { OFFICE_NAME_TO_CODE } = await import('@/lib/metadata/voteEnricher');

    const totals = rawTotals.map(t => {
      const officeName = officeMap[t.officeId] || t.officeId;
      const officeCode = OFFICE_NAME_TO_CODE[officeName];
      let metadata: { status: string; candidateName?: string; partyAbbreviation?: string; partyNumber?: string } = { status: 'NOT_FOUND' };

      if (officeCode) {
        // LIMITAÇÃO CONHECIDA (FASE 7.7.3):
        // Para suporte multi-UF completo, a agregação (groupBy) precisa considerar o estado do BU (report.stateCode).
        // Como o Prisma não suporta groupBy em relações, isso exige refatoração estrutural (ex: raw query ou mover stateCode para BallotVote).
        // Por ora, mantemos o comportamento atual (fallback SC) para não quebrar a agregação.
        const stateContext = officeCode === '1' ? 'BR' : 'SC';
        
        if (t.voteType === 'NOMINAL' && t.candidateNumber) {
          metadata = resolver.resolveNominal(election.year, stateContext, officeCode, t.candidateNumber);
        } else if (t.voteType === 'LEGENDA' && t.partyNumber) {
          metadata = resolver.resolveLegenda(election.year, stateContext, officeCode, t.partyNumber);
        }
      }

      return {
        officeName,
        candidateNumber: t.candidateNumber,
        partyNumber: t.partyNumber,
        voteType: t.voteType,
        quantity: t._sum.quantity || 0,
        metadataStatus: metadata.status,
        candidateName: metadata.candidateName,
        partyAbbreviation: metadata.partyAbbreviation
      };
    });

    const expectedAgg = await prisma.pollingSection.aggregate({
      _sum: { expectedBUs: true }
    });
    const expectedBUsCount = expectedAgg._sum.expectedBUs || 0;

    return NextResponse.json({
      processedReports: processedReportsCount,
      expectedReports: expectedBUsCount,
      totals
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
