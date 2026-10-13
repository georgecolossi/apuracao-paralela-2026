import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roundParam = searchParams.get('round');

    const activeElections = await prisma.election.findMany({ 
      where: { status: 'ACTIVE' },
      include: { rounds: true }
    });
    if (activeElections.length === 0) return NextResponse.json({ processedReports: 0, expectedReports: 0, totals: [] });
    if (activeElections.length > 1) {
      return NextResponse.json({ error: 'Configuração ambígua: múltiplas eleições ativas.' }, { status: 500 });
    }
    const election = activeElections[0];

    let targetRound;
    if (roundParam) {
      const parsedRound = parseInt(roundParam, 10);
      targetRound = election.rounds.find(r => r.roundNumber === parsedRound);
      if (!targetRound) {
        return NextResponse.json({ error: 'Turno inexistente para esta eleição.' }, { status: 404 });
      }
    } else {
      const activeRounds = election.rounds.filter(r => r.status === 'ACTIVE');
      if (activeRounds.length === 0) return NextResponse.json({ processedReports: 0, expectedReports: 0, totals: [] });
      if (activeRounds.length > 1) {
        return NextResponse.json({ error: 'Configuração ambígua: múltiplos turnos ativos.' }, { status: 500 });
      }
      targetRound = activeRounds[0];
    }

    // EIXO A: Elegibilidade Positiva Estrita para o turno consultado
    const eligibleCoverages = await prisma.roundCoverage.findMany({
      where: {
        electionRoundId: targetRound.id,
        expectedBUs: { gt: 0 }
      },
      select: {
        pollingSection: {
          select: {
            sectionNumber: true,
            zone: {
              select: {
                zoneNumber: true,
                municipality: {
                  select: { officialCode: true }
                }
              }
            }
          }
        }
      }
    });

    const eligiblePairs = eligibleCoverages.flatMap(c => {
      const cityCode = c.pollingSection.zone.municipality.officialCode;
      const rawZone = c.pollingSection.zone.zoneNumber;
      const unpaddedZone = parseInt(rawZone, 10).toString();
      const paddedZone = rawZone.padStart(4, '0');
      const rawSec = c.pollingSection.sectionNumber;
      const unpaddedSec = parseInt(rawSec, 10).toString();
      const paddedSec = rawSec.padStart(4, '0');

      return [
        { cityCode, zoneCode: unpaddedZone, sectionCode: unpaddedSec },
        { cityCode, zoneCode: paddedZone, sectionCode: paddedSec },
        { cityCode, zoneCode: unpaddedZone, sectionCode: paddedSec },
        { cityCode, zoneCode: paddedZone, sectionCode: unpaddedSec }
      ];
    });

    const seenConds = new Set<string>();
    const eligibleConditions: Array<{ cityCode: string; zoneCode: string; sectionCode: string }> = [];
    for (const p of eligiblePairs) {
      const k = `${p.cityCode}:${p.zoneCode}:${p.sectionCode}`;
      if (!seenConds.has(k)) {
        seenConds.add(k);
        eligibleConditions.push(p);
      }
    }

    const coverageCount = eligibleCoverages.length;
    
    const expectedAgg = await prisma.roundCoverage.aggregate({
      where: { 
        electionRoundId: targetRound.id,
        expectedBUs: { gt: 0 }
      },
      _sum: { expectedBUs: true }
    });
    const expectedBUsCount = expectedAgg._sum.expectedBUs || 0;

    // Definição de status de cobertura:
    // Round 1: Confirmada se possuir cobertura configurada
    // Round 2: Confirmada apenas quando possuir malha oficial homologada (>= 190 seções com soma expectedBUs >= 193)
    // Demais casos em turnos subsequentes operam em regime de cobertura provisória dinâmica
    const isRound1 = targetRound.roundNumber === 1;
    const isOfficialT2 = targetRound.roundNumber === 2 && coverageCount >= 190 && expectedBUsCount >= 193;
    const isProvisional = targetRound.roundNumber >= 2 && !isOfficialT2;
    const coverageConfigured = isRound1 ? coverageCount > 0 : isOfficialT2;
    const coverageStatus = isProvisional ? 'PROVISORIA' : 'CONFIRMADA';

    const receivedReportsCount = await prisma.ballotReport.count({
      where: {
        electionId: election.id,
        roundId: targetRound.id,
        isSimulation: false
      }
    });

    const dynamicSectionsCount = isProvisional ? coverageCount : 0;

    let processedReportsCount = 0;
    let rawTotals: any[] = [];

    const baseReportFilter: any = {
      electionId: election.id,
      roundId: targetRound.id,
      status: 'PROCESSADO',
      isSimulation: false
    };

    // Para cobertura confirmada, aplica filtro estrito de elegibilidade por seção
    if (!isProvisional && eligibleConditions.length > 0) {
      baseReportFilter.OR = eligibleConditions;
    }

    // Apenas busca totais se a cobertura estiver configurada OU se estiver em regime provisório com relatórios recebidos
    if (coverageConfigured || (isProvisional && receivedReportsCount > 0)) {
      processedReportsCount = await prisma.ballotReport.count({
        where: baseReportFilter
      });

      if (processedReportsCount > 0) {
        rawTotals = await (prisma.ballotVote.groupBy as any)({
          by: ['officeId', 'candidateNumber', 'partyNumber', 'voteType'],
          where: {
            report: baseReportFilter
          },
          _sum: {
            quantity: true
          }
        });
      }
    }

    const offices = await prisma.office.findMany();
    const officeMap = Object.fromEntries(offices.map(o => [o.id, o.name]));
    
    // Configura o resolver
    const { CandidateResolver } = await import('@/lib/metadata/CandidateResolver');
    const resolver = new CandidateResolver();
    await resolver.load(election.year, targetRound.roundNumber);

    const { OFFICE_NAME_TO_CODE } = await import('@/lib/metadata/voteEnricher');

    const totals = rawTotals.map(t => {
      const officeName = officeMap[t.officeId] || t.officeId;
      const officeCode = OFFICE_NAME_TO_CODE[officeName];
      let metadata: { status: string; candidateName?: string; partyAbbreviation?: string; partyNumber?: string } = { status: 'NOT_FOUND' };

      if (officeCode) {
        const stateContext = officeCode === '1' ? 'BR' : 'SC';
        if (t.voteType === 'NOMINAL' && t.candidateNumber) {
          metadata = resolver.resolveNominal(election.year, targetRound.roundNumber, stateContext, officeCode, t.candidateNumber);
        } else if (t.voteType === 'LEGENDA' && t.partyNumber) {
          metadata = resolver.resolveLegenda(election.year, targetRound.roundNumber, stateContext, officeCode, t.partyNumber);
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

    return NextResponse.json({
      coverageConfigured,
      coverageStatus,
      isProvisional,
      receivedReports: receivedReportsCount,
      processedReports: processedReportsCount,
      expectedReports: isProvisional ? 0 : expectedBUsCount,
      officialExpectedReports: isProvisional ? null : expectedBUsCount,
      dynamicallyRegisteredSections: dynamicSectionsCount,
      totals,
      election: {
        plei: targetRound.plei,
        year: election.year,
        name: election.name,
        rounds: election.rounds.map(r => ({ roundNumber: r.roundNumber, status: r.status }))
      },
      round: {
        roundNumber: targetRound.roundNumber,
        status: targetRound.status
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
