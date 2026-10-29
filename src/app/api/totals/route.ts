import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_CONTROL_HEADER = 'no-store, no-cache, must-revalidate, proxy-revalidate';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roundParam = searchParams.get('round');
    const electionParam = searchParams.get('election') || searchParams.get('electionId') || searchParams.get('slug');

    let election;
    if (electionParam) {
      const found = await prisma.election.findFirst({
        where: {
          OR: [
            { id: electionParam },
            { slug: electionParam }
          ]
        },
        include: {
          rounds: {
            orderBy: { roundNumber: 'asc' }
          },
          scopes: {
            include: {
              state: true,
              municipality: true
            }
          }
        }
      });
      if (!found) {
        return NextResponse.json({ error: 'Eleição informada não encontrada.' }, {
          status: 404,
          headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
        });
      }
      election = found;
    } else {
      const activeElections = await prisma.election.findMany({ 
        where: { status: 'ACTIVE' },
        include: {
          rounds: {
            orderBy: { roundNumber: 'asc' }
          },
          scopes: {
            include: {
              state: true,
              municipality: true
            }
          }
        }
      });
      if (activeElections.length === 0) {
        return NextResponse.json({
          processedReports: 0,
          expectedReports: 0,
          totals: [],
          offices: [],
          projections: {}
        }, {
          headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
        });
      }
      if (activeElections.length > 1) {
        return NextResponse.json({
          error: 'CONFIGURACAO_AMBIGUA',
          message: 'Configuração ambígua: múltiplas eleições ativas no banco. Especifique o parâmetro ?election=<id_ou_slug>.',
          activeElections: activeElections.map(e => ({ id: e.id, slug: e.slug, name: e.name }))
        }, {
          status: 400,
          headers: { 'Cache-Control': CACHE_CONTROL_HEADER }
        });
      }
      election = activeElections[0];
    }

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
        return NextResponse.json({
          processedReports: 0,
          expectedReports: 0,
          totals: [],
          offices: [],
          projections: {}
        }, {
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

    // Elegibilidade estrita de seções para o turno consultado
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
    
    // Denominador derivado exclusivamente de RoundCoverage.expectedBUs pré-configurados
    const expectedAgg = await prisma.roundCoverage.aggregate({
      where: { 
        electionRoundId: targetRound.id,
        expectedBUs: { gt: 0 },
        OR: [
          { notes: null },
          { notes: { not: 'DYNAMIC_SECTION' } }
        ]
      },
      _sum: { expectedBUs: true }
    });
    const expectedBUsCount = expectedAgg._sum.expectedBUs || 0;

    // Status canônico estrito derivado exclusivamente do que está persistido no banco
    const canonicalCoverageStatus = targetRound.coverageStatus || 'PROVISIONAL';
    let isProvisional = false;
    let coverageConfigured = false;
    let coverageStatus = 'PROVISORIA';
    let coverageStatusLabel = 'Cobertura Provisória';

    if (canonicalCoverageStatus === 'HOMOLOGATED') {
      isProvisional = false;
      coverageConfigured = coverageCount > 0 || expectedBUsCount > 0;
      coverageStatus = 'CONFIRMADA';
      coverageStatusLabel = 'Cobertura Homologada';
    } else if (canonicalCoverageStatus === 'REGISTERED') {
      isProvisional = false;
      coverageConfigured = coverageCount > 0 || expectedBUsCount > 0;
      coverageStatus = 'CONFIRMADA';
      coverageStatusLabel = 'Cobertura Cadastrada';
    } else if (canonicalCoverageStatus === 'UNCONFIGURED') {
      isProvisional = false;
      coverageConfigured = false;
      coverageStatus = 'NAO_CONFIGURADA';
      coverageStatusLabel = 'Não Configurada';
    } else {
      // canonicalCoverageStatus === 'PROVISIONAL'
      // Permanece ESTRITAMENTE provisória, independentemente da quantidade de seções ou BUs
      isProvisional = true;
      coverageConfigured = false;
      coverageStatus = 'PROVISORIA';
      coverageStatusLabel = 'Cobertura Provisória';
    }

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

    // Para cobertura confirmada, aplica filtro estrito de seções elegíveis
    if (!isProvisional && eligibleConditions.length > 0) {
      baseReportFilter.OR = eligibleConditions;
    }

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

    // Busca exclusivamente os cargos e candidatos da eleição consultada
    const offices = await prisma.office.findMany({
      where: { electionId: election.id },
      include: {
        candidates: {
          where: { isActive: true },
          include: { party: true },
          orderBy: { candidateNumber: 'asc' }
        }
      },
      orderBy: { orderNumber: 'asc' }
    });
    const officeMap = Object.fromEntries(offices.map(o => [o.id, o.name]));
    
    // Escopo territorial da eleição: NUNCA assumir 'SC' arbitrariamente
    const primaryScope = election.scopes && election.scopes.length > 0 ? election.scopes[0] : null;
    const explicitStateAbbr = primaryScope?.state?.abbreviation || election.scopes?.find(s => s.state)?.state?.abbreviation || null;

    // CandidateResolver para resolução de metadados TSE oficiais
    const { CandidateResolver } = await import('@/lib/metadata/CandidateResolver');
    const resolver = new CandidateResolver();
    if (election.year && targetRound.roundNumber) {
      await resolver.load(election.year, targetRound.roundNumber);
    }

    const { OFFICE_NAME_TO_CODE } = await import('@/lib/metadata/voteEnricher');

    const totals: any[] = [];

    // 1. Processa votos apurados associando aos candidatos da própria eleição
    for (const t of rawTotals) {
      const officeObj = offices.find(o => o.id === t.officeId);
      const officeName = officeObj?.name || officeMap[t.officeId] || t.officeId;
      const officeCode = officeObj?.code || OFFICE_NAME_TO_CODE[officeName];
      let metadata: { status: string; candidateName?: string; partyAbbreviation?: string; partyNumber?: string } = { status: 'NOT_FOUND' };

      // Prioridade absoluta: candidato formalmente cadastrado na eleição
      const registeredCand = officeObj?.candidates?.find(c => c.candidateNumber === t.candidateNumber);
      if (registeredCand) {
        metadata = {
          status: 'REGISTERED',
          candidateName: registeredCand.ballotName || registeredCand.name,
          partyAbbreviation: registeredCand.party?.abbreviation || '',
          partyNumber: registeredCand.party?.officialIdentifier || (registeredCand.candidateNumber.length >= 2 ? registeredCand.candidateNumber.slice(0, 2) : '')
        };
      } else if (officeCode) {
        // Resolução de metadados externos: somente se houver contexto de UF explícito
        const stateContext = officeCode === '1' ? 'BR' : explicitStateAbbr;
        if (stateContext) {
          if (t.voteType === 'NOMINAL' && t.candidateNumber) {
            metadata = resolver.resolveNominal(election.year, targetRound.roundNumber, stateContext, officeCode, t.candidateNumber);
          } else if (t.voteType === 'LEGENDA' && t.partyNumber) {
            metadata = resolver.resolveLegenda(election.year, targetRound.roundNumber, stateContext, officeCode, t.partyNumber);
          }
        }
      }

      totals.push({
        officeId: t.officeId,
        officeName,
        candidateNumber: t.candidateNumber,
        partyNumber: t.partyNumber || metadata.partyNumber,
        voteType: t.voteType,
        quantity: t._sum.quantity || 0,
        metadataStatus: metadata.status,
        candidateName: metadata.candidateName,
        partyAbbreviation: metadata.partyAbbreviation
      });
    }

    // 2. Garante a inclusão de candidatos cadastrados na própria eleição desde zero votos
    for (const office of offices) {
      for (const cand of office.candidates) {
        const alreadyInTotals = totals.some(
          t => t.officeId === office.id && t.candidateNumber === cand.candidateNumber && t.voteType === 'NOMINAL'
        );
        if (!alreadyInTotals) {
          totals.push({
            officeId: office.id,
            officeName: office.name,
            candidateNumber: cand.candidateNumber,
            partyNumber: cand.party?.officialIdentifier || (cand.candidateNumber.length >= 2 ? cand.candidateNumber.slice(0, 2) : ''),
            voteType: 'NOMINAL',
            quantity: 0,
            metadataStatus: 'OFFICIAL',
            candidateName: cand.ballotName || cand.name,
            partyAbbreviation: cand.party?.abbreviation || ''
          });
        }
      }
    }

    // 3. Compatibilidade histórica estrita com o pleito legado 2026 T2 (plei 3221)
    // SOMENTE injeta se a eleição for comprovadamente o pleito legado 2026 T2 E o cargo Presidente estiver desprovido de candidatos próprios
    const isLegacy2026T2 = targetRound.plei === '3221' && election.year === 2026;
    if (isLegacy2026T2) {
      const presOffice = offices.find(o => o.code === '1' || o.name === 'Presidente');
      if (presOffice && presOffice.candidates.length === 0) {
        const legacyCandidates = await prisma.candidateMetadata.findMany({
          where: {
            electionYear: 2026,
            electionCode: '6258',
            round: 2,
            officeCode: '1'
          },
          orderBy: { candidateNumber: 'asc' }
        });

        for (const c of legacyCandidates) {
          const exists = totals.some(t => t.officeId === presOffice.id && t.candidateNumber === c.candidateNumber && t.voteType === 'NOMINAL');
          if (!exists) {
            totals.push({
              officeId: presOffice.id,
              officeName: presOffice.name,
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
    }

    // Preserva dados de comparecimento dos BUs confirmados
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

    // Projeções Matemáticas por Cargo: Identificadas preferencialmente por officeId
    const projections: Record<string, any> = {};
    for (const office of offices) {
      let projObj: any;

      if (office.type !== 'MAJORITARIO') {
        projObj = {
          officeId: office.id,
          officeName: office.name,
          hasProjection: false,
          status: 'UNAVAILABLE',
          reason: 'PROPORTIONAL_NOT_ALLOWED',
          message: 'Projeção matemática indisponível para cargos proporcionais.'
        };
      } else if (expectedBUsCount <= 0) {
        projObj = {
          officeId: office.id,
          officeName: office.name,
          hasProjection: false,
          status: 'UNAVAILABLE',
          reason: 'DENOMINATOR_UNAVAILABLE',
          message: 'Projeção indisponível: cobertura sem total de urnas esperado definido.'
        };
      } else if (processedReportsCount === 0) {
        projObj = {
          officeId: office.id,
          officeName: office.name,
          hasProjection: false,
          status: 'UNAVAILABLE',
          reason: 'WAITING_FIRST_BU',
          message: 'Aguardando confirmação dos primeiros Boletins de Urna.'
        };
      } else {
        // Agrupa estritamente pelo officeId do cargo!
        const officeNominals = totals.filter(t => t.officeId === office.id && t.voteType === 'NOMINAL');
        const isCompleted = processedReportsCount >= expectedBUsCount;

        const projectedCandidates = officeNominals.map(c => {
          const v = c.quantity || 0;
          const proj = isCompleted ? v : Math.round((v * expectedBUsCount) / processedReportsCount);
          return {
            candidateNumber: c.candidateNumber,
            candidateName: c.candidateName,
            partyAbbreviation: c.partyAbbreviation,
            currentVotes: v,
            projectedVotes: proj
          };
        });

        const totalProjValid = projectedCandidates.reduce((acc, c) => acc + c.projectedVotes, 0);

        projObj = {
          officeId: office.id,
          officeName: office.name,
          hasProjection: true,
          status: isCompleted ? 'COMPLETED' : 'ACTIVE',
          method: 'LINEAR_PROPORTIONAL',
          isProvisional,
          expectedReports: expectedBUsCount,
          processedReports: processedReportsCount,
          coveragePercent: Number(((processedReportsCount / expectedBUsCount) * 100).toFixed(2)),
          projectedValidVotes: totalProjValid,
          candidates: projectedCandidates.map(c => ({
            ...c,
            projectedPercent: totalProjValid > 0 ? ((c.projectedVotes / totalProjValid) * 100).toFixed(2).replace('.', ',') : '0,00'
          })),
          disclaimer: 'Estimativa matemática proporcional às urnas apuradas. Não representa resultado oficial do TSE nem declaração definitiva de vencedor.'
        };
      }

      // Identificação primária por officeId
      projections[office.id] = projObj;
      // Compatibilidade legada com correspondência inequívoca de cargo
      if (!projections[office.name]) {
        projections[office.name] = projObj;
      }
    }

    // Compatibilidade histórica: apenas na eleição 2026 plei 3221 provisória
    const estimatedReferenceBUs = (isProvisional && isLegacy2026T2) ? 193 : null;

    return NextResponse.json({
      coverageConfigured,
      coverageStatus,
      canonicalCoverageStatus,
      coverageStatusLabel,
      isProvisional,
      receivedReports: receivedReportsCount,
      processedReports: processedReportsCount,
      expectedReports: expectedBUsCount,
      registeredExpectedReports: expectedBUsCount,
      officialExpectedReports: (canonicalCoverageStatus === 'HOMOLOGATED' || canonicalCoverageStatus === 'REGISTERED') ? expectedBUsCount : null,
      estimatedReferenceBUs,
      dynamicallyRegisteredSections: dynamicSectionsCount,
      attendance,
      totals,
      projections,
      offices: offices.map(o => ({
        id: o.id,
        code: o.code,
        name: o.name,
        type: o.type,
        orderNumber: o.orderNumber
      })),
      election: {
        id: election.id,
        slug: election.slug,
        plei: targetRound.plei || election.plei,
        year: election.year,
        name: election.name,
        type: election.type,
        scope: primaryScope ? {
          type: primaryScope.scopeType,
          key: primaryScope.scopeKey,
          state: primaryScope.state ? { name: primaryScope.state.name, uf: primaryScope.state.abbreviation } : null,
          municipality: primaryScope.municipality ? { name: primaryScope.municipality.name, code: primaryScope.municipality.officialCode } : null
        } : null,
        rounds: election.rounds.map(r => ({
          id: r.id,
          roundNumber: r.roundNumber,
          status: r.status,
          coverageStatus: r.coverageStatus
        }))
      },
      round: {
        id: targetRound.id,
        roundNumber: targetRound.roundNumber,
        status: targetRound.status,
        coverageStatus: targetRound.coverageStatus,
        coverageOrigin: targetRound.coverageOrigin,
        coverageHomologatedAt: targetRound.coverageHomologatedAt,
        coverageHomologatedBy: targetRound.coverageHomologatedBy,
        coverageEvidenceNotes: targetRound.coverageEvidenceNotes
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
