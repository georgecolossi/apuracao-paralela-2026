import { prisma } from '../db';

export async function getElectionTotals(electionId: string) {
  const processedReportsCount = await prisma.ballotReport.count({
    where: {
      electionId,
      status: 'PROCESSADO',
      isSimulation: false
    }
  });

  const totals = await prisma.ballotVote.groupBy({
    by: ['officeId', 'candidateNumber', 'partyNumber', 'voteType'],
    where: {
      report: {
        electionId,
        status: 'PROCESSADO',
        isSimulation: false
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
      status: 'PROCESSADO',
      isSimulation: false
    }
  });

  const totals = await prisma.ballotVote.groupBy({
    by: ['officeId', 'candidateNumber', 'partyNumber', 'voteType'],
    where: {
      report: {
        electionId,
        cityCode,
        status: 'PROCESSADO',
        isSimulation: false
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
