import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { UniversalQrBuParser } from '@/lib/parser/adapter/UniversalQrBuParser';
import { Tse2026SimulationParser } from '@/lib/parser/Tse2026SimulationParser';

import { requireAuthenticatedUser } from '@/lib/auth';
import { validateCsrfProtection } from '@/lib/security/csrf';
import { OFFICE_NAME_TO_CODE } from '@/lib/metadata/voteEnricher';
import {
  validateBallotIngestionInvariants,
  ElectionInvariantError,
  getSafeOperatorErrorMessage
} from '@/lib/validation/electionContext';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (auth.user.role === 'VIEWER') {
      return NextResponse.json({
        error: 'FORBIDDEN_ROLE',
        message: 'Acesso negado: usuários com perfil de visualizador (VIEWER) não possuem permissão de leitura de BUs.'
      }, { status: 403 });
    }

    const csrf = validateCsrfProtection(req, { userId: auth.user.userId, sessionVersion: auth.user.sessionVersion });
    if (!csrf.valid) {
      return NextResponse.json({ error: 'Falha na validação de origem (CSRF).', reason: csrf.reason }, { status: 403 });
    }

    const { content, isSimulation = false, sessionId } = await req.json();
    const operatorId = auth.user.userId;

    const parser = isSimulation ? new Tse2026SimulationParser() : new UniversalQrBuParser();

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
      return NextResponse.json({ error: reportData.code, message: reportData.message }, { status: 400 });
    }

    // Validação estrita de integridade criptográfica para modo oficial
    if (!isSimulation && reportData.hashStatus !== 'VERIFIED') {
      await prisma.scanSession.update({
        where: { id: session.id },
        data: { status: 'ERROR' }
      });
      return NextResponse.json({
        error: 'CRYPTOGRAPHIC_INTEGRITY_FAILED',
        message: 'A integridade criptográfica (SHA-512) do Boletim de Urna não pôde ser verificada com sucesso.',
        details: { hashStatus: reportData.hashStatus }
      }, { status: 400 });
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

      if (activeRound.plei !== electionId && (!reportData.specificElectionId || activeRound.plei !== reportData.specificElectionId)) {
        return NextResponse.json({
          error: 'ELECTION_CONTEXT_MISMATCH',
          message: 'O BU pertence a outro pleito não configurado ou inativo.',
          received: { plei: electionId, specificPlei: reportData.specificElectionId, turn: roundNumber }
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

    // Regras de Cobertura Contextuais Baseadas em RoundCoverage
    const isStrictCoverage = activeRound.coverageStatus === 'HOMOLOGATED' || activeRound.coverageStatus === 'REGISTERED';

    if (isStrictCoverage) {
      // Cobertura estrita pré-cadastrada: a seção deve existir e estar contemplada no RoundCoverage
      if (!sectionInDB && !isSimulation) {
        return NextResponse.json({
          error: 'OUT_OF_COVERAGE',
          message: 'Seção não encontrada na cobertura homologada/registrada do turno.'
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
              errors: 'Seção fora da área de cobertura configurada para o turno.',
              userId: operatorId,
              roundId: activeRound.id
            }
          });

          return NextResponse.json({
            error: 'OUT_OF_COVERAGE',
            message: 'Este Boletim de Urna pertence a uma seção fora da área de cobertura configurada para o turno.'
          }, { status: 403 });
        }

        if (coverage && coverage.expectedBUs <= 0) {
          return NextResponse.json({
            error: 'SECTION_AGGREGATED_NO_BU',
            message: 'Esta seção eleitoral é agregada e não possui Boletim de Urna independente. Seus votos foram computados na urna da seção principal.'
          }, { status: 403 });
        }
      }
    } else if (!isSimulation) {
      // Cobertura provisória: aceita e cadastra dinamicamente seções elegíveis da zona/município em escopo
      if (!sectionInDB && zoneInDB) {
        const canonicalSec = sectionCode.padStart(4, '0');
        try {
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
              identifiers: `Round: ${activeRound.roundNumber}, Zone: ${zoneInDB.zoneNumber}, Sec: ${canonicalSec}`,
              userId: operatorId,
              roundId: activeRound.id
            }
          });
        } catch (secErr: unknown) {
          if (secErr && typeof secErr === 'object' && 'code' in secErr && (secErr as { code?: string }).code === 'P2002') {
            sectionInDB = await prisma.pollingSection.findFirst({
              where: {
                pollingZoneId: zoneInDB.id,
                sectionNumber: canonicalSec
              }
            });
          } else {
            throw secErr;
          }
        }
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
          try {
            await prisma.roundCoverage.create({
              data: {
                electionRoundId: activeRound.id,
                pollingSectionId: sectionInDB.id,
                expectedBUs: 1
              }
            });
          } catch (covErr: unknown) {
            if (covErr && typeof covErr === 'object' && 'code' in covErr && (covErr as { code?: string }).code === 'P2002') {
              // Já criado concorrentemente por outra requisição simultânea
            } else {
              throw covErr;
            }
          }
        } else if (existingCoverage.expectedBUs <= 0) {
          return NextResponse.json({
            error: 'SECTION_AGGREGATED_NO_BU',
            message: 'Esta seção eleitoral é agregada e não possui Boletim de Urna independente.'
          }, { status: 403 });
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
      if (conflictingSectionReport.deterministicId === deterministicId) {
        return NextResponse.json({
          status: 'DUPLICADO',
          reportId: conflictingSectionReport.id,
          error: 'Este Boletim de Urna já foi processado ou está na fila.'
        }, { status: 409 });
      }

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

      if (activeRound.plei !== electionId && (!reportData.specificElectionId || activeRound.plei !== reportData.specificElectionId)) {
        return NextResponse.json({
          error: 'ELECTION_CONTEXT_MISMATCH',
          message: 'O BU pertence a outro pleito não configurado ou inativo.',
          received: { plei: electionId, specificPlei: reportData.specificElectionId, turn: roundNumber }
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
            vrqrVersion: reportData.vrqrVersion || null,
            hash: reportData.hash || '',
            signature: reportData.signature || '',
            status: 'PENDENTE_CONFIRMACAO',
            validationData: JSON.stringify({
              parsed: true,
              vrqrVersion: reportData.vrqrVersion,
              hashStatus: reportData.hashStatus,
              sigStatus: reportData.sigStatus,
              sigValidationNote: reportData.sigValidationNote,
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

        const votesToInsert: Array<{
          officeId: string;
          candidateId?: string | null;
          candidateNumber?: string | null;
          partyId?: string | null;
          partyNumber?: string | null;
          voteType: string;
          quantity: number;
        }> = [];

        // Resolução estrita de cargos no contexto exclusivo da eleição configurada (sem auto-criação)
        const electionOffices = await tx.office.findMany({
          where: { electionId: activeElection.id }
        });

        const officeMap = new Map<string, typeof electionOffices[0]>();
        for (const off of electionOffices) {
          officeMap.set(off.code, off);
          officeMap.set(off.name.toLowerCase(), off);
        }

        for (const vote of reportData.votes) {
          const officeCode = vote.officeCode || OFFICE_NAME_TO_CODE[vote.officeName] || vote.officeName;
          const office = officeMap.get(officeCode) || officeMap.get(vote.officeName.toLowerCase());

          if (!office) {
            await tx.auditLog.create({
              data: {
                action: 'SCAN_OFFICE_NOT_CONFIGURED',
                result: 'REJECTED',
                identifiers: `Office: ${vote.officeName} (${officeCode}), Plei: ${reportData.electionId}`,
                errors: `Cargo '${vote.officeName}' (código ${officeCode}) presente no Boletim de Urna não está configurado na eleição ativa '${activeElection.name}'.`,
                userId: operatorId,
                roundId: activeRound.id
              }
            });

            throw new ElectionInvariantError(
              'OFFICE_NOT_CONFIGURED',
              `O cargo '${vote.officeName}' (código ${officeCode}) presente no Boletim de Urna não está configurado para a eleição ativa '${activeElection.name}'.`,
              { officeCode, officeName: vote.officeName, electionId: activeElection.id }
            );
          }

          let resolvedCandidateId: string | null = null;
          let resolvedPartyId: string | null = null;

          const normType = (vote.type || 'NOMINAL').trim().toUpperCase();

          // 1. Resolução estrita de candidato nominal por (officeId, candidateNumber) no contexto desta eleição
          if (vote.candidateNumber && normType !== 'BRANCO' && normType !== 'NULO' && normType !== 'LEGENDA') {
            const candidate = await tx.candidate.findUnique({
              where: {
                officeId_candidateNumber: {
                  officeId: office.id,
                  candidateNumber: vote.candidateNumber
                }
              }
            });

            if (candidate) {
              resolvedCandidateId = candidate.id;
              resolvedPartyId = candidate.partyId || null;
            } else {
              // Candidato ainda não cadastrado no catálogo:
              // O voto oficial e o BU legítimo são aceitos com candidateId=null e candidateNumber preservado,
              // sem atribuir votos a candidatos de outros cargos ou eleições por aproximação ambígua.
              resolvedCandidateId = null;
            }
          }

          // 2. Resolução de partido para votos de legenda ou votos sem candidato identificado
          if (!resolvedPartyId && vote.partyNumber) {
            const party = await tx.party.findFirst({
              where: { officialIdentifier: vote.partyNumber }
            });
            if (party) {
              resolvedPartyId = party.id;
            }
          }

          votesToInsert.push({
            officeId: office.id,
            candidateId: resolvedCandidateId,
            candidateNumber: (normType === 'BRANCO' || normType === 'NULO') ? null : (vote.candidateNumber || null),
            partyId: resolvedPartyId,
            partyNumber: vote.partyNumber || null,
            voteType: vote.type,
            quantity: vote.quantity
          });
        }

        // Validação estrita de invariantes contextuais multi-eleição
        await validateBallotIngestionInvariants(tx, {
          electionId: activeElection.id,
          roundId: activeRound.id,
          votes: votesToInsert
        });

        for (const vote of votesToInsert) {
          await tx.ballotVote.create({
            data: {
              reportId: newReport.id,
              officeId: vote.officeId,
              candidateId: vote.candidateId || null,
              candidateNumber: vote.candidateNumber,
              partyId: vote.partyId || null,
              partyNumber: vote.partyNumber,
              voteType: vote.voteType,
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
      if (dbError instanceof ElectionInvariantError) {
        const correlationId = crypto.randomUUID();
        console.error(`[SCAN_INVARIANT_ERROR][${correlationId}] Code: ${dbError.code}`, {
          message: dbError.message
        });
        return NextResponse.json({
          status: 'ERRO_INVARIANTE',
          error: dbError.code,
          message: getSafeOperatorErrorMessage(dbError.code),
          correlationId
        }, { status: 422 });
      }

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
    if (error instanceof ElectionInvariantError) {
      const correlationId = crypto.randomUUID();
      console.error(`[SCAN_INVARIANT_ERROR][${correlationId}] Code: ${error.code}`, {
        message: error.message
      });
      return NextResponse.json({
        status: 'ERRO_INVARIANTE',
        error: error.code,
        message: getSafeOperatorErrorMessage(error.code),
        correlationId
      }, { status: 422 });
    }
    const correlationId = crypto.randomUUID();
    console.error(`[SCAN_INTERNAL_ERROR][${correlationId}]`, error);
    return NextResponse.json({
      error: 'INTERNAL_ERROR',
      message: 'Erro interno ao processar o Boletim de Urna.',
      correlationId
    }, { status: 500 });
  }
}
