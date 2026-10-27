import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCanonicalScopeKey } from '@/lib/validation/electionContext';

/**
 * ROTA ADMINISTRATIVA DE COBERTURA GEOGRÁFICA CONTEXTUAL (PR 1 / v2.0)
 * 
 * NOTA ARQUITETURAL:
 * - A cobertura agora é contextual por Eleição (`ElectionScope`) e Turno (`RoundCoverage`).
 * - Alterações na cobertura de uma eleição não afetam implicitamente outras eleições cadastradas.
 * - Coberturas oficialmente homologadas (`coverageStatus === 'HOMOLOGATED'`) ou turnos
 *   finalizados (`FINISHED`) são estritamente bloqueados contra alteração.
 * - Preserva ponte de compatibilidade temporária com `Municipality.isCoverage` para componentes
 *   legados de 2026 até a introdução do Wizard multi-eleição no PR 3.
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
      return NextResponse.json({ error: 'Invalid payload: coverageCodes deve ser um array de strings.' }, { status: 400 });
    }

    const dedupedCodes = Array.from(new Set(coverageCodes)).sort();

    // 1. Validação prévia de existência dos municípios informados
    let validMunicipalities: Array<{ id: string; officialCode: string; stateId: string; state: { abbreviation: string } }> = [];
    if (dedupedCodes.length > 0) {
      validMunicipalities = await prisma.municipality.findMany({
        where: { officialCode: { in: dedupedCodes } },
        include: { state: true }
      });
      if (validMunicipalities.length !== dedupedCodes.length) {
        return NextResponse.json(
          { error: 'Invalid municipalities', message: 'Um ou mais códigos de municípios informados são inválidos.' },
          { status: 400 }
        );
      }
    }

    // 2. Resolução do Contexto da Eleição
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
        return NextResponse.json({ error: 'Eleição informada não encontrada.' }, { status: 404 });
      }
    } else {
      const activeElections = await prisma.election.findMany({
        where: { status: 'ACTIVE' },
        include: { rounds: true }
      });

      if (activeElections.length > 1) {
        return NextResponse.json({
          error: 'AMBIGUOUS_ELECTION',
          message: 'Múltiplas eleições ativas no sistema. Especifique electionId ou electionSlug para definir o escopo de cobertura.'
        }, { status: 400 });
      }

      targetElection = activeElections.length === 1
        ? activeElections[0]
        : await prisma.election.findFirst({ orderBy: { createdAt: 'desc' }, include: { rounds: true } });
    }

    // Modo Legado de Compatibilidade: se nenhuma eleição existe no banco (ex: testes legados sem seed de eleição)
    if (!targetElection) {
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

    // 3. Resolução do Turno Alvo (Round)
    let targetRound = targetElection.rounds.find(r =>
      (roundId && r.id === roundId) ||
      (roundNumber !== undefined && r.roundNumber === Number(roundNumber))
    );

    if (!targetRound) {
      targetRound = targetElection.rounds.find(r => r.status === 'ACTIVE') || targetElection.rounds[0];
    }

    // 4. Execução Atômica de Validações e Alterações na Mesma Transação
    try {
      await prisma.$transaction(async (tx) => {
        // Validação de estado do turno dentro da transação
        if (targetRound) {
          const freshRound = await tx.electionRound.findUnique({
            where: { id: targetRound.id },
            select: { id: true, status: true, coverageStatus: true, roundNumber: true }
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

          // Checagem de BUs reais processados para municípios que seriam removidos
          const existingScopes = await tx.electionScope.findMany({
            where: {
              electionId: targetElection.id,
              scopeType: 'MUNICIPAL'
            },
            include: { municipality: true }
          });

          let currentCodes = existingScopes
            .map(s => s.municipality?.officialCode)
            .filter((c): c is string => Boolean(c));

          // Fallback: se a eleição ainda não possui ElectionScope cadastrado (ex: teste ou transição),
          // utiliza a cobertura de Municipality.isCoverage
          if (currentCodes.length === 0) {
            const legacyMunicipalities = await tx.municipality.findMany({
              where: { isCoverage: true },
              select: { officialCode: true }
            });
            currentCodes = legacyMunicipalities.map(m => m.officialCode);
          }

          const removedCodes = currentCodes.filter(c => !dedupedCodes.includes(c));

          if (removedCodes.length > 0) {
            const reportsInRemoved = await tx.ballotReport.findFirst({
              where: {
                electionId: targetElection.id,
                roundId: freshRound.id,
                cityCode: { in: removedCodes },
                isSimulation: false,
                status: 'PROCESSADO'
              }
            });

            if (reportsInRemoved) {
              throw new Error('CONFLITO_DADOS_REAIS');
            }
          }

          // 4. Atualização Contextual de ElectionScope para a eleição alvo
          if (removedCodes.length > 0) {
            await tx.electionScope.deleteMany({
              where: {
                electionId: targetElection.id,
                scopeType: 'MUNICIPAL',
                municipality: { officialCode: { in: removedCodes } }
              }
            });
          }

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

          // 5. Atualização de RoundCoverage
          const sections = await tx.pollingSection.findMany({
            where: {
              zone: {
                municipality: { officialCode: { in: dedupedCodes } }
              }
            },
            select: { id: true }
          });

          if (freshRound.coverageStatus === 'PROVISIONAL' && sections.length > 0) {
            await tx.electionRound.update({
              where: { id: freshRound.id },
              data: { coverageStatus: 'REGISTERED' }
            });
          }

          // 6. Ponte de Compatibilidade Temporária com Modelo Legado
          // Mantém sincronizado Municipality.isCoverage para consultas do painel atual até o Wizard (PR 3)
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

          // 7. Registro em AuditLog
          await tx.auditLog.create({
            data: {
              action: 'UPDATE_COVERAGE',
              result: 'SUCCESS',
              electionId: targetElection.id,
              roundId: freshRound.id,
              identifiers: `election=${targetElection.slug};round=${freshRound.roundNumber};before=${currentCodes.join(',')};after=${dedupedCodes.join(',')}`,
              userId: auth.user.userId
            }
          });
        }
      });

      return NextResponse.json({
        success: true,
        electionId: targetElection.id,
        roundId: targetRound?.id || null,
        coverageCodes: dedupedCodes
      });
    } catch (txError: any) {
      if (txError?.message === 'INVALID_MUNICIPALITIES') {
        return NextResponse.json({ error: 'Invalid municipalities: um ou mais códigos informados não existem no banco.' }, { status: 400 });
      }
      if (txError?.message === 'ROUND_FINISHED') {
        return NextResponse.json({ error: 'Operação não permitida: Turno já está finalizado.' }, { status: 403 });
      }
      if (txError?.message === 'COVERAGE_HOMOLOGATED') {
        return NextResponse.json({
          error: 'Operação não permitida: A cobertura deste turno já foi oficialmente homologada e está bloqueada contra alterações.'
        }, { status: 403 });
      }
      if (txError?.message === 'CONFLITO_DADOS_REAIS') {
        return NextResponse.json({
          error: 'CONFLITO_DADOS_REAIS',
          message: 'Não é possível remover da cobertura um município que já possui BUs reais processados.'
        }, { status: 409 });
      }
      throw txError;
    }
  } catch (error) {
    console.error('Error updating coverage:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
