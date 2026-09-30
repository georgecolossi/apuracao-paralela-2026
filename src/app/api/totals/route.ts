import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const election = await prisma.election.findFirst({ where: { status: 'ACTIVE' } });
    if (!election) return NextResponse.json({ processedReports: 0, totals: [] });

    const processedReportsCount = await prisma.ballotReport.count({
      where: {
        electionId: election.id,
        status: 'PROCESSADO'
      }
    });

    // Como o groupBy não permite incluir relações facilmente, vamos buscar manual para simplificar e dar a UI bonita
    const rawTotals = await prisma.ballotVote.groupBy({
      by: ['officeId', 'voteType'],
      where: {
        report: {
          electionId: election.id,
          status: 'PROCESSADO'
        }
      },
      _sum: {
        quantity: true
      }
    });

    // Mapear officeId para nome
    const offices = await prisma.office.findMany();
    const officeMap = Object.fromEntries(offices.map(o => [o.id, o.name]));

    const totals = rawTotals.map(t => ({
      ...t,
      officeId: officeMap[t.officeId] || t.officeId
    }));

    // Calculate expected BUs from sections
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
