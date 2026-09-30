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

    const totals = rawTotals.map(t => ({
      officeName: officeMap[t.officeId] || t.officeId,
      candidateNumber: t.candidateNumber,
      partyNumber: t.partyNumber,
      voteType: t.voteType,
      quantity: t._sum.quantity || 0
    }));

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
