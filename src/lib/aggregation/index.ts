import { prisma } from '../db';

export async function getElectionTotals(electionId: string) {
  const processedReportsCount = await prisma.ballotReport.count({
    where: {
      electionId,
      status: 'PROCESSADO'
    }
  });

  const totals = await prisma.ballotVote.groupBy({
    by: ['officeId', 'candidateId', 'partyId', 'voteType'],
    where: {
      report: {
        electionId,
        status: 'PROCESSADO'
      }
    },
    _sum: {
      quantity: true
    }
  });

  return {
    processedReports: processedReportsCount,
    totals
  };
}

export async function getElectionTotalsByMunicipality(electionId: string, cityCode: string) {
  const processedReportsCount = await prisma.ballotReport.count({
    where: {
      electionId,
      cityCode,
      status: 'PROCESSADO'
    }
  });

  const totals = await prisma.ballotVote.groupBy({
    by: ['officeId', 'candidateId', 'partyId', 'voteType'],
    where: {
      report: {
        electionId,
        cityCode,
        status: 'PROCESSADO'
      }
    },
    _sum: {
      quantity: true
    }
  });

  return {
    processedReports: processedReportsCount,
    totals
  };
}
