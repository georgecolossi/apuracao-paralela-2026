import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  buildCanonicalScopeKey,
  validateElectionScopesSet,
  ElectionInvariantError
} from '@/lib/validation/electionContext';

/**
 * ROTA ADMINISTRATIVA DE COBERTURA GEOGRÁFICA CONTEXTUAL (PR 1 / v2.0)
 * 
 * DIRETRIZES DE INTEGRIDADE:
 * 1. Resolução estrita de Eleição e Turno (sem fallbacks arbitrários ou seleções cegas).
 * 2. Atualização real e atômica de RoundCoverage (vinculando e desvinculando seções reais).
 * 3. Validação canônica do conjunto final de escopos geográficos (ElectionScope).
 * 4. Isolamento estrito entre eleições e turnos (zero mutação global indevida em Municipality.isCoverage).
 * 5. Bloqueio absoluto contra remoção de municípios ou seções com BUs reais processados.
 * 6. Bloqueio de turnos FINISHED ou coberturas HOMOLOGATED.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const { coverageCodes, electionId, electionSlug, roundId, roundNumber } = body;

    if (!Array.isArray(coverageCodes) || !coverageCodes.every(c => typeof c === 'string')) {
      return NextResponse.json(
        { error: 'Invalid payload: coverageCodes deve ser um array de strings.' },
        { status: 400 }
      );
    }

    const dedupedCodes = Array.from(new Set(coverageCodes)).sort();

    // 1. Validação prévia de existência dos municípios informados
    let validMunicipalities: Array<{
      id: string;
      officialCode: string;
      stateId: string;
      state: { abbreviation: string; id: string };
    }> = [];

    if (dedupedCodes.length > 0) {
      validMunicipalities = await prisma.municipality.findMany({
        where: { officialCode: { in: dedupedCodes } },
        include: { state: true }
      });
      if (validMunicipalities.length !== dedupedCodes.length) {
        return NextResponse.json(
          { error: 'INVALID_MUNICIPALITIES', message: 'Um ou mais códigos de municípios informados são inválidos.' },
          { status: 400 }
        );
      }
    }

    // 2. Resolução Estrita da Eleição
    const electionParam = electionId || electionSlug || searchParams.get('election') || searchParams.get('electionId');
    let targetElection;

    if (electionParam) {
      targetElection = await prisma.election.findFirst({
        where: {
          OR: [
            { id: electionParam },
            { slug: electionParam }
          ]
        },
        include: { rounds: true }
      });
      if (!targetElection) {
        return NextResponse.json(
          { error: 'ELEICAO_NAO_ENCONTRADA', message: 'Eleição informada não encontrada.' },
          { status: 404 }
        );
      }
    } else {
      const allElections = await prisma.election.findMany({
        include: { rounds: true }
      });

      if (allElections.length === 0) {
        // Modo de compatibilidade legada: Nenhuma eleição cadastrada no sistema.
        // Permite testes unitários do schema legado atualizando Municipality.isCoverage.
        const oldCoverage = await prisma.municipality.findMany({
          where: { isCoverage: true },
          select: { officialCode: true }
        });
        const oldCodes = oldCoverage.map(m => m.officialCode);
        const removedCodes = oldCodes.filter(c => !dedupedCodes.includes(c));

        if (removedCodes.length > 0) {
          const reportsInRemoved = await prisma.ballotReport.findFirst({
            where: {
              cityCode: { in: removedCodes },
              isSimulation: false,
              status: 'PROCESSADO'
            }
          });
          if (reportsInRemoved) {
            return NextResponse.json({
              error: 'CONFLITO_DADOS_REAIS',
              message: 'Não é possível remover da cobertura um município que já possui BUs reais processados.'
            }, { status: 409 });
          }
        }

        await prisma.$transaction(async (tx) => {
          await tx.municipality.updateMany({
            where: { isCoverage: true },
            data: { isCoverage: false }
          });

          if (dedupedCodes.length > 0) {
            await tx.municipality.updateMany({
              where: { officialCode: { in: dedupedCodes } },
              data: { isCoverage: true }
            });
          }

          await tx.auditLog.create({
            data: {
              action: 'UPDATE_COVERAGE',
              result: 'SUCCESS',
              identifiers: `before=${oldCodes.join(',')};after=${dedupedCodes.join(',')}`,
              userId: auth.user.userId
            }
          });
        });

        return NextResponse.json({ success: true, legacy: true });
      }

      if (allElections.length === 1) {
        targetElection = allElections[0];
      } else {
        // Múltiplas eleições cadastradas: exige especificação explícita (sem escolher a última cegamente)
        return NextResponse.json({
          error: 'AMBIGUOUS_ELECTION',
          message: 'Múltiplas eleições cadastradas no sistema. Especifique electionId ou electionSlug para definir o escopo de cobertura.'
        }, { status: 400 });
      }
    }

    // 3. Resolução Estrita do Turno (Round)
    const roundParamId = roundId || searchParams.get('roundId');
    const rawRoundNum = roundNumber !== undefined ? roundNumber : searchParams.get('round');
    const roundParamNumber = rawRoundNum !== undefined && rawRoundNum !== null && String(rawRoundNum).trim() !== ''
      ? Number(rawRoundNum)
      : undefined;

    let targetRound;

    if (roundParamId) {
      const roundById = targetElection.rounds.find(r => r.id === roundParamId);
      if (!roundById) {
        // Verifica se o roundId existe em outra eleição
        const roundInOtherElection = await prisma.electionRound.findUnique({
          where: { id: roundParamId }
        });
        if (roundInOtherElection) {
          return NextResponse.json({
            error: 'TURNO_OUTRA_ELEICAO',
            message: 'O turno informado pertence a outra eleição.'
          }, { status: 400 });
        }
        return NextResponse.json({
          error: 'TURNO_NAO_ENCONTRADO',
          message: 'O turno informado por ID não foi encontrado.'
        }, { status: 404 });
      }

      if (roundParamNumber !== undefined && roundById.roundNumber !== roundParamNumber) {
        return NextResponse.json({
          error: 'TURNO_DIVERGENTE',
          message: `Identificadores contraditórios: roundId pertence ao turno ${roundById.roundNumber}, mas roundNumber informado foi ${roundParamNumber}.`
        }, { status: 400 });
      }

      targetRound = roundById;
    } else if (roundParamNumber !== undefined) {
      const roundByNum = targetElection.rounds.find(r => r.roundNumber === roundParamNumber);
      if (!roundByNum) {
        return NextResponse.json({
          error: 'TURNO_NAO_ENCONTRADO',
          message: `Turno ${roundParamNumber} não encontrado na eleição selecionada.`
        }, { status: 404 });
      }
      targetRound = roundByNum;
    } else {
      // Nenhum parâmetro de turno informado: busca turno ativo ou único da eleição
      if (targetElection.rounds.length === 0) {
        return NextResponse.json({
          error: 'SEM_TURNOS_CADASTRADOS',
          message: 'A eleição selecionada não possui turnos cadastrados para definir cobertura.'
        }, { status: 400 });
      }

      const activeRounds = targetElection.rounds.filter(r => r.status === 'ACTIVE');
      if (activeRounds.length === 1) {
        targetRound = activeRounds[0];
      } else if (targetElection.rounds.length === 1) {
        targetRound = targetElection.rounds[0];
      } else {
        return NextResponse.json({
          error: 'TURNO_OBRIGATORIO',
          message: 'A eleição possui múltiplos turnos. Especifique roundId ou roundNumber para definir a cobertura.'
        }, { status: 400 });
      }
    }

    // 4. Execução Atômica de Validações e Alterações na Mesma Transação
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Validação de estado do turno dentro da transação
        const freshRound = await tx.electionRound.findUnique({
          where: { id: targetRound.id },
          select: { id: true, electionId: true, status: true, coverageStatus: true, roundNumber: true }
        });

        if (!freshRound) {
          throw new Error('ROUND_NOT_FOUND');
        }

        if (freshRound.status === 'FINISHED') {
          throw new Error('ROUND_FINISHED');
        }

        if (freshRound.coverageStatus === 'HOMOLOGATED') {
          throw new Error('COVERAGE_HOMOLOGATED');
        }

        // Validação Canônica do Conjunto de Escopos da Eleição
        const existingNonMunicipalScopes = await tx.electionScope.findMany({
          where: {
            electionId: targetElection.id,
            scopeType: { not: 'MUNICIPAL' }
          }
        });

        const candidateScopes = [
          ...existingNonMunicipalScopes.map(s => ({ scopeType: s.scopeType, scopeKey: s.scopeKey })),
          ...validMunicipalities.map(m => ({
            scopeType: 'MUNICIPAL',
            stateCode: m.state.abbreviation,
            muniCode: m.officialCode
          }))
        ];

        validateElectionScopesSet(candidateScopes);

        // Resolução das seções atuais e alvos para o turno
        const existingRoundCoverages = await tx.roundCoverage.findMany({
          where: { electionRoundId: freshRound.id },
          include: {
            pollingSection: {
              include: {
                zone: {
                  include: { municipality: true }
                }
              }
            }
          }
        });

        const existingSectionIds = new Set(existingRoundCoverages.map(c => c.pollingSectionId));
        const existingMuniCodes = Array.from(
          new Set(existingRoundCoverages.map(c => c.pollingSection.zone.municipality.officialCode))
        ).sort();

        // Seções cadastradas nos municípios selecionados
        const targetSections = await tx.pollingSection.findMany({
          where: {
            zone: {
              municipality: { officialCode: { in: dedupedCodes } }
            }
          },
          select: {
            id: true,
            expectedBUs: true,
            zone: {
              select: {
                municipality: {
                  select: { officialCode: true }
                }
              }
            }
          }
        });

        const targetSectionIds = new Set(targetSections.map(s => s.id));

        const coveragesToRemove = existingRoundCoverages.filter(c => !targetSectionIds.has(c.pollingSectionId));
        const sectionsToAdd = targetSections.filter(s => !existingSectionIds.has(s.id));

        // Guarda contra remoção de municípios ou seções com BUs reais processados
        // 1) Seções que seriam removidas
        if (coveragesToRemove.length > 0) {
          const removedMuniCodes = Array.from(
            new Set(coveragesToRemove.map(c => c.pollingSection.zone.municipality.officialCode))
          );
          const reportsInRemoved = await tx.ballotReport.findFirst({
            where: {
              electionId: targetElection.id,
              roundId: freshRound.id,
              cityCode: { in: removedMuniCodes },
              isSimulation: false,
              status: 'PROCESSADO'
            }
          });
          if (reportsInRemoved) {
            throw new Error('CONFLITO_DADOS_REAIS');
          }
        }

        // 2) BUs em municípios não contemplados na nova cobertura
        const reportsInNonCovered = await tx.ballotReport.findFirst({
          where: {
            electionId: targetElection.id,
            roundId: freshRound.id,
            cityCode: { notIn: dedupedCodes },
            isSimulation: false,
            status: 'PROCESSADO'
          }
        });
        if (reportsInNonCovered) {
          throw new Error('CONFLITO_DADOS_REAIS');
        }

        // Sincronização real de RoundCoverage
        if (coveragesToRemove.length > 0) {
          const idsToDelete = coveragesToRemove.map(c => c.id);
          await tx.roundCoverage.deleteMany({
            where: { id: { in: idsToDelete } }
          });
        }

        if (sectionsToAdd.length > 0) {
          await tx.roundCoverage.createMany({
            data: sectionsToAdd.map(s => ({
              electionRoundId: freshRound.id,
              pollingSectionId: s.id,
              expectedBUs: s.expectedBUs ?? 1
            }))
          });
        }

        const finalSectionsCount = await tx.roundCoverage.count({
          where: { electionRoundId: freshRound.id }
        });

        // Atualização contextual do status de cobertura do turno
        let newCoverageStatus = freshRound.coverageStatus;
        if (finalSectionsCount > 0 && freshRound.coverageStatus === 'PROVISIONAL') {
          newCoverageStatus = 'REGISTERED';
          await tx.electionRound.update({
            where: { id: freshRound.id },
            data: { coverageStatus: 'REGISTERED' }
          });
        } else if (finalSectionsCount === 0 && freshRound.coverageStatus === 'REGISTERED') {
          newCoverageStatus = 'PROVISIONAL';
          await tx.electionRound.update({
            where: { id: freshRound.id },
            data: { coverageStatus: 'PROVISIONAL' }
          });
        }

        // Sincronização contextual de ElectionScope
        for (const muni of validMunicipalities) {
          const canonicalKey = buildCanonicalScopeKey({
            scopeType: 'MUNICIPAL',
            stateCode: muni.state.abbreviation,
            muniCode: muni.officialCode
          });

          await tx.electionScope.upsert({
            where: {
              electionId_scopeKey: {
                electionId: targetElection.id,
                scopeKey: canonicalKey
              }
            },
            create: {
              electionId: targetElection.id,
              scopeType: 'MUNICIPAL',
              scopeKey: canonicalKey,
              stateId: muni.stateId,
              municipalityId: muni.id,
              isCoverageArea: true
            },
            update: {
              isCoverageArea: true
            }
          });
        }

        // Remove do ElectionScope apenas municípios que não são cobertos por NENHUM turno da eleição
        const currentElectionMunicipalScopes = await tx.electionScope.findMany({
          where: {
            electionId: targetElection.id,
            scopeType: 'MUNICIPAL'
          },
          include: { municipality: true }
        });

        const muniCodesNotInNew = currentElectionMunicipalScopes
          .map(s => s.municipality?.officialCode)
          .filter((c): c is string => typeof c === 'string' && !dedupedCodes.includes(c));

        for (const mCode of muniCodesNotInNew) {
          const stillUsedInOtherRound = await tx.roundCoverage.findFirst({
            where: {
              electionRound: {
                electionId: targetElection.id,
                id: { not: freshRound.id }
              },
              pollingSection: {
                zone: {
                  municipality: { officialCode: mCode }
                }
              }
            }
          });

          if (!stillUsedInOtherRound) {
            await tx.electionScope.deleteMany({
              where: {
                electionId: targetElection.id,
                scopeType: 'MUNICIPAL',
                municipality: { officialCode: mCode }
              }
            });
          }
        }

        // NÃO muta Municipality.isCoverage globalmente (isolamento estrito multi-eleição)

        // Registro contextual no AuditLog
        await tx.auditLog.create({
          data: {
            action: 'UPDATE_COVERAGE',
            result: 'SUCCESS',
            electionId: targetElection.id,
            roundId: freshRound.id,
            identifiers: `election=${targetElection.slug};round=${freshRound.roundNumber};before=${existingMuniCodes.join(',')};after=${dedupedCodes.join(',')};addedSections=${sectionsToAdd.length};removedSections=${coveragesToRemove.length};totalSections=${finalSectionsCount}`,
            userId: auth.user.userId,
            metadata: JSON.stringify({
              beforeMunicipalities: existingMuniCodes,
              afterMunicipalities: dedupedCodes,
              sectionsAdded: sectionsToAdd.length,
              sectionsRemoved: coveragesToRemove.length,
              totalRoundSections: finalSectionsCount
            })
          }
        });

        return {
          electionId: targetElection.id,
          electionSlug: targetElection.slug,
          roundId: freshRound.id,
          roundNumber: freshRound.roundNumber,
          coverageCodes: dedupedCodes,
          sectionsAdded: sectionsToAdd.length,
          sectionsRemoved: coveragesToRemove.length,
          totalSections: finalSectionsCount,
          coverageStatus: newCoverageStatus
        };
      });

      return NextResponse.json({
        success: true,
        ...result
      });
    } catch (txError: any) {
      if (txError?.message === 'ROUND_NOT_FOUND') {
        return NextResponse.json(
          { error: 'TURNO_NAO_ENCONTRADO', message: 'O turno eleitoral informado não foi encontrado.' },
          { status: 404 }
        );
      }
      if (txError?.message === 'ROUND_FINISHED') {
        return NextResponse.json(
          {
            error: 'Operação não permitida: Turno já está finalizado.',
            code: 'ROUND_FINISHED',
            message: 'Operação não permitida: Turno já está finalizado.'
          },
          { status: 403 }
        );
      }
      if (txError?.message === 'COVERAGE_HOMOLOGATED') {
        return NextResponse.json({
          error: 'Operação não permitida: A cobertura deste turno já foi oficialmente homologada e está bloqueada contra alterações.',
          code: 'COVERAGE_HOMOLOGATED',
          message: 'Operação não permitida: A cobertura deste turno já foi oficialmente homologada e está bloqueada contra alterações.'
        }, { status: 403 });
      }
      if (txError?.message === 'CONFLITO_DADOS_REAIS') {
        return NextResponse.json({
          error: 'CONFLITO_DADOS_REAIS',
          message: 'Não é possível remover da cobertura um município ou seção que já possui BUs reais processados.'
        }, { status: 409 });
      }
      if (txError instanceof ElectionInvariantError) {
        return NextResponse.json({
          error: txError.code,
          message: txError.message
        }, { status: 400 });
      }
      throw txError;
    }
  } catch (error) {
    console.error('Error updating coverage:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
