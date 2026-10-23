import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_CONTROL_HEADER = 'no-store, no-cache, must-revalidate, proxy-revalidate';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roundParam = searchParams.get('round');

    const activeElections = await prisma.election.findMany({ 
      where: { status: 'ACTIVE' },
      include: { rounds: true }
    });
    if (activeElections.length === 0) {
      return NextResponse.json({ processedReports: 0, expectedReports: 0, totals: [] }, {
        headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
      });
    }
    if (activeElections.length > 1) {
      return NextResponse.json({ error: 'Configuração ambígua: múltiplas eleições ativas.' }, {
        status: 500,
        headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
      });
    }
    const election = activeElections[0];

    let targetRound;
    if (roundParam) {
      const parsedRound = parseInt(roundParam, 10);
      targetRound = election.rounds.find(r => r.roundNumber === parsedRound);
      if (!targetRound) {
        return NextResponse.json({ error: 'Turno inexistente para esta eleição.' }, {
          status: 404,
          headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
        });
      }
    } else {
      const activeRounds = election.rounds.filter(r => r.status === 'ACTIVE');
      if (activeRounds.length === 0) {
        return NextResponse.json({ processedReports: 0, expectedReports: 0, totals: [] }, {
          headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
        });
      }
      if (activeRounds.length > 1) {
        return NextResponse.json({ error: 'Configuração ambígua: múltiplos turnos ativos.' }, {
          status: 500,
          headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
        });
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

    if (targetRound.roundNumber === 2) {
      const t2Candidates = await prisma.candidateMetadata.findMany({
        where: {
          electionYear: election.year,
          round: 2,
          officeCode: '1'
        },
        orderBy: { candidateNumber: 'asc' }
      });

      for (const c of t2Candidates) {
        const exists = totals.some(t => t.officeName === 'Presidente' && t.candidateNumber === c.candidateNumber);
        if (!exists) {
          totals.push({
            officeName: 'Presidente',
            candidateNumber: c.candidateNumber,
            partyNumber: c.partyNumber,
            voteType: 'NOMINAL',
            quantity: 0,
            metadataStatus: 'OFFICIAL',
            candidateName: c.ballotName,
            partyAbbreviation: c.partyAbbreviation
          });
        }
      }
    }

    let attendance: {
      eligible: number;
      turnout: number;
      abstention: number;
      turnoutPercent: string | null;
      abstentionPercent: string | null;
      available: boolean;
    } | null = null;

    if (processedReportsCount > 0) {
      const confirmedReports = await prisma.ballotReport.findMany({
        where: baseReportFilter,
        select: {
          stateCode: true,
          cityCode: true,
          zoneCode: true,
          sectionCode: true,
          validationData: true
        }
      });

      const seenSections = new Set<string>();
      let totalEligible = 0;
      let totalTurnout = 0;
      let hasValidAttendance = false;

      for (const rep of confirmedReports) {
        const secKey = `${rep.stateCode}:${rep.cityCode}:${rep.zoneCode}:${rep.sectionCode}`;
        if (seenSections.has(secKey)) continue;
        seenSections.add(secKey);

        if (rep.validationData) {
          try {
            const parsedVal = JSON.parse(rep.validationData);
            if (parsedVal.attendance && typeof parsedVal.attendance.apto === 'number') {
              hasValidAttendance = true;
              totalEligible += parsedVal.attendance.apto;
              if (typeof parsedVal.attendance.comp === 'number') {
                totalTurnout += parsedVal.attendance.comp;
              }
            }
          } catch (e) {}
        }
      }

      if (hasValidAttendance && totalEligible > 0) {
        const abstention = Math.max(0, totalEligible - totalTurnout);
        attendance = {
          eligible: totalEligible,
          turnout: totalTurnout,
          abstention,
          turnoutPercent: ((totalTurnout / totalEligible) * 100).toFixed(2).replace('.', ','),
          abstentionPercent: ((abstention / totalEligible) * 100).toFixed(2).replace('.', ','),
          available: true
        };
      }
    }

    if (!attendance) {
      attendance = {
        eligible: 0,
        turnout: 0,
        abstention: 0,
        turnoutPercent: null,
        abstentionPercent: null,
        available: false
      };
    }

    return NextResponse.json({
      coverageConfigured,
      coverageStatus,
      isProvisional,
      receivedReports: receivedReportsCount,
      processedReports: processedReportsCount,
      expectedReports: isProvisional ? 0 : expectedBUsCount,
      officialExpectedReports: isProvisional ? null : expectedBUsCount,
      estimatedReferenceBUs: isProvisional ? 193 : null,
      dynamicallyRegisteredSections: dynamicSectionsCount,
      attendance,
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
    }, {
      headers: {
        'Cache-Control': CACHE_CONTROL_HEADER
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, {
      status: 500,
      headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
    });
  }
}
