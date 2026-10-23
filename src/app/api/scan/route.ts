import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Tse2026BallotReportParser } from '@/lib/parser/Tse2026BallotReportParser';
import { Tse2026SimulationParser } from '@/lib/parser/Tse2026SimulationParser';

import { requireAuthenticatedUser } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { content, isSimulation = false, sessionId } = await req.json();
    const operatorId = auth.user.userId;

    const parser = isSimulation ? new Tse2026SimulationParser() : new Tse2026BallotReportParser();

    const partInfo = parser.parsePart(content);
    if ('code' in partInfo) {
      return NextResponse.json({ error: partInfo.code || partInfo.message }, { status: 400 });
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'SCAN_SESSION_REQUIRED' }, { status: 400 });
    }

    const { partIndex, totalParts, payload } = partInfo;
    const sequenceId = sessionId;

    // Resolve ScanSession
    let session = await prisma.scanSession.findUnique({
      where: { sequenceId }
    });

    if (!session) {
      try {
        session = await prisma.scanSession.create({
          data: {
            sequenceId,
            expectedParts: totalParts,
            operatorId,
            isSimulation
          }
        });
      } catch (dbError: unknown) {
        if (dbError && typeof dbError === 'object' && 'code' in dbError && dbError.code === 'P2002') {
          session = await prisma.scanSession.findUnique({
            where: { sequenceId }
          });
          if (!session) throw dbError;
        } else {
          throw dbError;
        }
      }
    }

    // Ignore duplicate part
    const existingPart = await prisma.ballotReportPart.findUnique({
      where: {
        sessionId_partIndex: {
          sessionId: session.id,
          partIndex
        }
      }
    });

    const crypto = await import('crypto');
    const contentHashStr = crypto.createHash('sha256').update(content).digest('hex');

    if (existingPart) {
      if (existingPart.contentHash === contentHashStr) {
        // It's the exact same part, we can just treat it as ALREADY_SCANNED but return PARCIAL or COMPLETO to keep the flow alive
        // Just let it pass through to the count check
      } else {
        return NextResponse.json({ error: 'CONFLICTING_PART', message: 'Parte lida diverge da lida anteriormente' }, { status: 409 });
      }
    } else {
      try {
        await prisma.ballotReportPart.create({
          data: {
            sessionId: session.id,
            partIndex,
            totalParts,
            rawContent: content, // Full content with QRBU header
            contentHash: contentHashStr,
          }
        });
      } catch (dbError: unknown) {
        if (dbError && typeof dbError === 'object' && 'code' in dbError && dbError.code === 'P2002') {
          // Concorrência: outra requisição simultânea acabou de inserir esta parte.
          const concurrentPart = await prisma.ballotReportPart.findUnique({
            where: {
              sessionId_partIndex: {
                sessionId: session.id,
                partIndex
              }
            }
          });
          if (concurrentPart && concurrentPart.contentHash !== contentHashStr) {
            return NextResponse.json({ error: 'CONFLICTING_PART', message: 'Parte lida diverge da lida concorrentemente' }, { status: 409 });
          }
          // Se o hash for igual, a parte já está lá (idempotência), apenas prossegue
        } else {
          throw dbError; // Qualquer outro erro (banco caído, etc.)
        }
      }
    }

    // Verifica completude
    const partsCount = await prisma.ballotReportPart.count({
      where: { sessionId: session.id }
    });

    if (partsCount < totalParts) {
      return NextResponse.json({
        status: 'PARCIAL',
        partsRead: partsCount,
        totalParts
      });
    }

    // Reconstruir o BU inteiro e extrair dados
    const allParts = await prisma.ballotReportPart.findMany({
      where: { sessionId: session.id },
      orderBy: { partIndex: 'asc' }
    });

    const rawPartsArray = allParts.map(p => p.rawContent);
    const fullPayloadOrError = parser.reconstruct(rawPartsArray);
    if (typeof fullPayloadOrError !== 'string') {
      return NextResponse.json({ error: fullPayloadOrError.code }, { status: 400 });
    }

    const reportData = parser.parseReport(fullPayloadOrError, rawPartsArray);

    if ('code' in reportData) {
      await prisma.scanSession.update({
        where: { id: session.id },
        data: { status: 'ERROR' }
      });
      return NextResponse.json({ error: reportData.code }, { status: 400 });
    }

    // Rejeição estrita de QRBU de teste/simulação em modo oficial
    if (!isSimulation && reportData.fase && reportData.fase !== 'O' && process.env.ALLOW_SIMULATED_FASE !== 'true') {
      await prisma.scanSession.update({
        where: { id: session.id },
        data: { status: 'ERROR' }
      });
      return NextResponse.json({
        error: 'SIMULATED_QRBU_REJECTED',
        message: `Boletim de Urna de teste/simulação (FASE: ${reportData.fase}) rejeitado em modo oficial.`
      }, { status: 400 });
    }

    const { buildBallotReportIdentity } = await import('@/lib/identity');
    // Determina DeterministicID real a partir do parser
    const { electionId, roundNumber, stateCode, cityCode, zoneCode, sectionCode, urnCode } = reportData;


      const activeRounds = await prisma.electionRound.findMany({
        where: { status: 'ACTIVE', roundNumber },
        include: { election: true }
      });

      if (activeRounds.length === 0) {
        return NextResponse.json({
          error: 'ELECTION_CONTEXT_MISMATCH',
          message: 'O BU pertence a outro turno ou a um turno que não está ativo.',
          received: { plei: electionId, turn: roundNumber }
        }, { status: 400 });
      }

      if (activeRounds.length > 1) {
        return NextResponse.json({
          error: 'CONFIGURATION_ERROR',
          message: 'Múltiplos turnos ativos com o mesmo número.',
        }, { status: 500 });
      }

      const activeRound = activeRounds[0];

      if (!activeRound.plei) {
        return NextResponse.json({
          error: 'ROUND_PLEI_NOT_CONFIGURED',
          message: 'O pleito do turno ativo não está configurado.',
        }, { status: 400 });
      }

      if (activeRound.plei !== electionId) {
        return NextResponse.json({
          error: 'ELECTION_CONTEXT_MISMATCH',
          message: 'O BU pertence a outro pleito não configurado ou inativo.',
          received: { plei: electionId, turn: roundNumber }
        }, { status: 400 });
      }

      const activeElection = activeRound.election;


    // Checagem de Escopo Geográfico (Cobertura Regional)
    const secVariants = Array.from(new Set([sectionCode, sectionCode.padStart(4, '0'), parseInt(sectionCode, 10).toString()]));
    const zoneVariants = Array.from(new Set([zoneCode, zoneCode.padStart(4, '0'), parseInt(zoneCode, 10).toString()]));

    // Validação de Município e Zona Eleitoral
    const zoneInDB = await prisma.pollingZone.findFirst({
      where: {
        zoneNumber: { in: zoneVariants },
        municipality: { officialCode: cityCode }
      },
      include: { municipality: true }
    });

    if (!zoneInDB && !isSimulation) {
      await prisma.auditLog.create({
        data: {
          action: 'SCAN_OUT_OF_COVERAGE',
          result: 'REJECTED',
          identifiers: `City: ${cityCode}, Zone: ${zoneCode}, Sec: ${sectionCode}`,
          errors: 'Município ou zona eleitoral fora da área de apuração configurada.',
          userId: operatorId
        }
      });

      return NextResponse.json({
        error: 'OUT_OF_COVERAGE',
        message: 'Este Boletim de Urna pertence a um município ou zona eleitoral fora da área de apuração.'
      }, { status: 403 });
    }

    let sectionInDB = zoneInDB ? await prisma.pollingSection.findFirst({
      where: {
        sectionNumber: { in: secVariants },
        pollingZoneId: zoneInDB.id
      }
    }) : null;

    // Proteção estrita contra seções agregadas sem BU independente (expectedBUs <= 0)
    let isAggregated = false;
    if (sectionInDB && sectionInDB.expectedBUs !== null && sectionInDB.expectedBUs <= 0) {
      isAggregated = true;
    }
    if (sectionInDB) {
      const existingAggregatedCoverage = await prisma.roundCoverage.findFirst({
        where: {
          pollingSectionId: sectionInDB.id,
          expectedBUs: { lte: 0 }
        }
      });
      if (existingAggregatedCoverage) {
        isAggregated = true;
      }
    }

    if (isAggregated) {
      try {
        await prisma.auditLog.create({
          data: {
            action: 'SCAN_INELIGIBLE_SECTION_REJECTED',
            result: 'REJECTED',
            identifiers: `City: ${cityCode}, Zone: ${zoneCode}, Sec: ${sectionCode}`,
            errors: 'Seção eleitoral agregada não possui Boletim de Urna independente (expectedBUs = 0).',
            userId: operatorId
          }
        });
      } catch (logErr) {
        console.error('Falha ao registrar AuditLog de rejeição de seção agregada:', logErr);
      }

      return NextResponse.json({
        error: 'SECTION_AGGREGATED_NO_BU',
        message: 'Esta seção eleitoral é agregada e não possui Boletim de Urna independente. Seus votos foram computados na urna da seção principal.'
      }, { status: 403 });
    }

    // Regras de Cobertura por Turno
    if (activeRound.roundNumber === 1) {
      // 1º Turno: Cobertura estrita pré-cadastrada (193 urnas)
      if (!sectionInDB && !isSimulation) {
        return NextResponse.json({
          error: 'OUT_OF_COVERAGE',
          message: 'Seção não encontrada.'
        }, { status: 403 });
      }

      if (sectionInDB) {
        const coverage = await prisma.roundCoverage.findUnique({
          where: {
            electionRoundId_pollingSectionId: {
              electionRoundId: activeRound.id,
              pollingSectionId: sectionInDB.id
            }
          }
        });

        if (!coverage && !isSimulation) {
          await prisma.auditLog.create({
            data: {
              action: 'SCAN_OUT_OF_COVERAGE',
              result: 'REJECTED',
              identifiers: `City: ${cityCode}, Zone: ${zoneCode}, Sec: ${sectionCode}`,
              errors: 'Seção fora da área de cobertura configurada.',
              userId: operatorId
            }
          });

          return NextResponse.json({
            error: 'OUT_OF_COVERAGE',
            message: 'Este Boletim de Urna pertence a uma seção fora da área de cobertura configurada.'
          }, { status: 403 });
        }

        if (coverage && coverage.expectedBUs <= 0) {
          return NextResponse.json({
            error: 'SECTION_AGGREGATED_NO_BU',
            message: 'Esta seção eleitoral é agregada e não possui Boletim de Urna independente. Seus votos foram computados na urna da seção principal.'
          }, { status: 403 });
        }
      }
    } else if (activeRound.roundNumber === 2 && !isSimulation) {
      // 2º Turno: Cobertura dinâmica — aceita e cadastra seções elegíveis sem lista prévia
      if (!sectionInDB && zoneInDB) {
        const canonicalSec = sectionCode.padStart(4, '0');
        sectionInDB = await prisma.pollingSection.create({
          data: {
            pollingZoneId: zoneInDB.id,
            sectionNumber: canonicalSec,
            expectedBUs: 1
          }
        });

        await prisma.auditLog.create({
          data: {
            action: 'DYNAMIC_SECTION_REGISTERED',
            result: 'SUCCESS',
            identifiers: `Round: 2, Zone: ${zoneInDB.zoneNumber}, Sec: ${canonicalSec}`,
            userId: operatorId
          }
        });
      }

      if (sectionInDB) {
        const existingCoverage = await prisma.roundCoverage.findUnique({
          where: {
            electionRoundId_pollingSectionId: {
              electionRoundId: activeRound.id,
              pollingSectionId: sectionInDB.id
            }
          }
        });

        if (!existingCoverage) {
          await prisma.roundCoverage.create({
            data: {
              electionRoundId: activeRound.id,
              pollingSectionId: sectionInDB.id,
              expectedBUs: 1
            }
          });
        }
      }
    }

    const deterministicId = buildBallotReportIdentity({
      plei: electionId,
      turn: String(roundNumber),
      stateCode,
      cityCode,
      zoneCode,
      sectionCode,
      urnCode
    });

    // 1. Checar duplicidade exata de identidade (Deterministic ID)
    const duplicate = await prisma.ballotReport.findUnique({
      where: { deterministicId }
    });

    if (duplicate) {
      return NextResponse.json({
        status: 'DUPLICADO',
        reportId: duplicate.id,
        error: 'Este Boletim de Urna já foi processado ou está na fila.'
      }, { status: 409 });
    }

    // 2. Checar duplicidade / conflito por seção/turno
    const conflictingSectionReport = await prisma.ballotReport.findFirst({
      where: {
        roundId: activeRound.id,
        isSimulation: false,
        cityCode: cityCode,
        zoneCode: { in: zoneVariants },
        sectionCode: { in: secVariants },
        status: { in: ['PROCESSADO', 'PENDENTE_CONFIRMACAO', 'CONFLITO'] }
      }
    });

    if (conflictingSectionReport) {
      await prisma.auditLog.create({
        data: {
          action: 'BALLOT_REPORT_CONFLICT',
          result: 'FLAGGED_FOR_REVIEW',
          identifiers: `Round: ${roundNumber}, City: ${cityCode}, Zone: ${zoneCode}, Sec: ${sectionCode}, ExistingReportId: ${conflictingSectionReport.id}, IncomingDeterministicId: ${deterministicId}`,
          errors: `Conflito de seção/turno: já existe BU (${conflictingSectionReport.id}) registrado para a seção ${sectionCode} neste turno.`,
          userId: operatorId
        }
      });

      return NextResponse.json({
        status: 'CONFLITO',
        error: 'CONFLITO_SECAO',
        message: 'Conflito detectado: já existe um Boletim de Urna registrado para esta seção no turno. Sinalizado para revisão sem contabilização automática.',
        conflictingReportId: conflictingSectionReport.id
      }, { status: 409 });
    }

    // Tentar criar via Transação para previnir condição de corrida exata no mesmo milissegundo.
    let reportId: string;
    try {
      const activeRounds = await prisma.electionRound.findMany({
        where: { status: 'ACTIVE', roundNumber },
        include: { election: true }
      });

      if (activeRounds.length === 0) {
        return NextResponse.json({
          error: 'ELECTION_CONTEXT_MISMATCH',
          message: 'O BU pertence a outro turno ou a um turno que não está ativo.',
          received: { plei: electionId, turn: roundNumber }
        }, { status: 400 });
      }

      if (activeRounds.length > 1) {
        return NextResponse.json({
          error: 'CONFIGURATION_ERROR',
          message: 'Múltiplos turnos ativos com o mesmo número.',
        }, { status: 500 });
      }

      const activeRound = activeRounds[0];

      if (!activeRound.plei) {
        return NextResponse.json({
          error: 'ROUND_PLEI_NOT_CONFIGURED',
          message: 'O pleito do turno ativo não está configurado.',
        }, { status: 400 });
      }

      if (activeRound.plei !== electionId) {
        return NextResponse.json({
          error: 'ELECTION_CONTEXT_MISMATCH',
          message: 'O BU pertence a outro pleito não configurado ou inativo.',
          received: { plei: electionId, turn: roundNumber }
        }, { status: 400 });
      }

      const activeElection = activeRound.election;

      const result = await prisma.$transaction(async (tx) => {
        const newReport = await tx.ballotReport.create({
          data: {
            deterministicId,
            electionId: activeElection.id,
            roundId: activeRound.id,
            stateCode,
            cityCode,
            zoneCode,
            sectionCode,
            urnCode,
            hash: reportData.hash || '',
            signature: reportData.signature || '',
            status: 'PENDENTE_CONFIRMACAO',
            validationData: JSON.stringify({
              parsed: true,
              hashStatus: reportData.hashStatus,
              sigStatus: reportData.sigStatus,
              attendance: (reportData.apto !== undefined || reportData.comp !== undefined || reportData.falt !== undefined) ? {
                apto: reportData.apto,
                comp: reportData.comp,
                falt: reportData.falt
              } : undefined
            }),
            metadata: sequenceId,
            isSimulation: session!.isSimulation,
            operatorId: session!.operatorId
          }
        });

        for (const vote of reportData.votes) {
           let office = await tx.office.findFirst({ where: { name: vote.officeName }});
           if (!office) {
              office = await tx.office.create({ data: { name: vote.officeName, orderNumber: 1 } });
           }
           await tx.ballotVote.create({
             data: {
               reportId: newReport.id,
               officeId: office.id,
               candidateNumber: vote.candidateNumber,
               partyNumber: vote.partyNumber,
               voteType: vote.type,
               quantity: vote.quantity
             }
           });
        }

        await tx.scanSession.update({
          where: { id: session!.id },
          data: { status: 'COMPLETED' }
        });

        return newReport.id;
      });
      reportId = result;
    } catch (dbError: unknown) {
      if (dbError && typeof dbError === 'object' && 'code' in dbError && dbError.code === 'P2002') {
         // Caiu na malha fina da concorrência exata (mesmo milissegundo)
         const dup = await prisma.ballotReport.findUnique({ where: { deterministicId } });
         return NextResponse.json({
            status: 'DUPLICADO',
            reportId: dup?.id,
            error: 'Este Boletim de Urna foi processado simultaneamente por outro operador.'
          }, { status: 409 });
      }
      throw dbError;
    }

    return NextResponse.json({ status: 'COMPLETO', reportId });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro interno ao processar QR' }, { status: 500 });
  }
}
