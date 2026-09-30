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

    const officeNameToCode: Record<string, string> = {
      'Presidente': '1',
      'Governador': '3',
      'Senador': '5',
      'Deputado Federal': '6',
      'Deputado Estadual': '7',
      'Prefeito': '11',
      'Vereador': '13'
    };

    const totals = rawTotals.map(t => {
      const officeName = officeMap[t.officeId] || t.officeId;
      const officeCode = officeNameToCode[officeName];
      let metadata: { status: string; candidateName?: string; partyAbbreviation?: string; partyNumber?: string } = { status: 'NOT_FOUND' };

      if (officeCode) {
        // Presidente é sempre BR (Nacional), demais cargos usam contexto SC (Estado-alvo da plataforma)
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
