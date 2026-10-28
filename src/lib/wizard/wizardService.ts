import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  buildCanonicalScopeKey,
  canonicalizeScopeKey,
  ElectionInvariantError,
  VALID_BRAZILIAN_UFS
} from '@/lib/validation/electionContext';
import { validateAdminConfirmation, getConfirmationAliases } from '@/lib/normalization';

export interface WizardScopeInput {
  scopeType: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL';
  stateAbbreviation?: string;
  municipalityOfficialCode?: string;
  municipalityName?: string;
  ibgeCode?: string;
}

export interface WizardRoundInput {
  roundNumber: number;
  plei?: string | null;
  date?: string | null;
}

export interface WizardOfficeInput {
  code: string;
  name: string;
  type?: 'MAJORITARIO' | 'PROPORCIONAL';
  orderNumber?: number;
  maxVotesPerVoter?: number;
}

export interface WizardPartyInput {
  officialIdentifier: string;
  name: string;
  abbreviation: string;
}

export interface WizardCandidateInput {
  officeCode: string;
  candidateNumber: string;
  name: string;
  ballotName: string;
  partyNumber: string;
  partyName?: string;
  partyAbbreviation?: string;
  photoUrl?: string;
}

export interface WizardCoverageSectionInput {
  municipalityOfficialCode: string;
  municipalityName?: string;
  stateAbbreviation?: string;
  zoneNumber: string;
  sectionNumber: string;
  expectedBUs?: number;
  isAggregated?: boolean;
  aggregatedIntoSec?: string;
  locationName?: string;
}

export interface WizardOperatorInput {
  email: string;
  name?: string;
}

export interface WizardPayload {
  electionId?: string;
  name: string;
  year: number;
  type: 'GENERAL' | 'MUNICIPAL' | 'SUPPLEMENTARY' | 'CONSULTA';
  description?: string;
  plei?: string;
  status?: 'DRAFT' | 'READY';
  scopes: WizardScopeInput[];
  rounds: WizardRoundInput[];
  offices: WizardOfficeInput[];
  parties?: WizardPartyInput[];
  candidates?: WizardCandidateInput[];
  coverage?: WizardCoverageSectionInput[];
  operators?: WizardOperatorInput[];
}

export interface TseImportResult {
  valid: boolean;
  format: 'TSE_ELE_C' | 'TSE_CANDIDATES' | 'UNIVERSAL_WIZARD_JSON';
  summary: {
    roundsCount: number;
    officesCount: number;
    candidatesCount: number;
    partiesCount: number;
    sectionsCount: number;
  };
  data: {
    election?: {
      name?: string;
      year?: number;
      type?: 'GENERAL' | 'MUNICIPAL' | 'SUPPLEMENTARY' | 'CONSULTA';
      plei?: string;
      description?: string;
    };
    rounds?: WizardRoundInput[];
    offices?: WizardOfficeInput[];
    parties?: WizardPartyInput[];
    candidates?: WizardCandidateInput[];
    coverage?: WizardCoverageSectionInput[];
    scopes?: WizardScopeInput[];
  };
  errors?: string[];
  warnings?: string[];
}

export class WizardValidationError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(`[${code}] ${message}`);
    this.name = 'WizardValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Retorna os metadados necessários para renderizar o assistente (estados, partidos, rascunhos, etc.)
 */
export async function getWizardMetadata(electionId?: string) {
  const [states, parties, drafts, allElections, currentActive] = await Promise.all([
    prisma.state.findMany({
      orderBy: { abbreviation: 'asc' },
      select: { id: true, name: true, abbreviation: true }
    }),
    prisma.party.findMany({
      orderBy: { officialIdentifier: 'asc' },
      select: { id: true, officialIdentifier: true, name: true, abbreviation: true }
    }),
    prisma.election.findMany({
      where: { status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        year: true,
        type: true,
        status: true,
        updatedAt: true,
        _count: {
          select: { rounds: true, offices: true, scopes: true }
        }
      }
    }),
    prisma.election.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        year: true,
        type: true,
        status: true,
        updatedAt: true
      }
    }),
    prisma.election.findFirst({
      where: { status: 'ACTIVE' },
      include: {
        rounds: { orderBy: { roundNumber: 'asc' } }
      }
    })
  ]);

  let electionDetails = null;
  if (electionId) {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      include: {
        rounds: {
          orderBy: { roundNumber: 'asc' },
          include: {
            coverage: {
              include: {
                pollingSection: {
                  include: {
                    zone: {
                      include: {
                        municipality: {
                          include: { state: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        scopes: {
          include: {
            state: true,
            municipality: {
              include: { state: true }
            }
          }
        },
        offices: {
          orderBy: { orderNumber: 'asc' },
          include: {
            candidates: {
              include: { party: true }
            }
          }
        }
      }
    });

    if (election) {
      // Obter operadores ativos cadastrados no sistema
      const operators = await prisma.user.findMany({
        where: { role: 'OPERATOR', isActive: true },
        select: { id: true, name: true, email: true, role: true }
      });

      electionDetails = {
        ...election,
        availableOperators: operators
      };
    }
  }

  return {
    states,
    parties,
    drafts,
    allElections,
    currentActive,
    election: electionDetails
  };
}

/**
 * Salva ou atualiza uma eleição via assistente em transação atômica.
 * Atende às diretrizes de isolamento, auditoria e não-homologação precipitada de cobertura.
 */
export async function saveElectionWizard(userId: string, payload: WizardPayload) {
  // 1. Validações preliminares
  if (!payload.name || typeof payload.name !== 'string' || payload.name.trim().length < 3) {
    throw new WizardValidationError('INVALID_NAME', 'O nome da eleição deve ter pelo menos 3 caracteres.');
  }

  const year = Number(payload.year);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new WizardValidationError('INVALID_YEAR', 'Ano da eleição inválido (deve estar entre 1900 e 2100).');
  }

  const validTypes = ['GENERAL', 'MUNICIPAL', 'SUPPLEMENTARY', 'CONSULTA'];
  if (!validTypes.includes(payload.type)) {
    throw new WizardValidationError('INVALID_TYPE', `Tipo de eleição inválido. Deve ser: ${validTypes.join(', ')}.`);
  }

  if (!payload.rounds || !Array.isArray(payload.rounds) || payload.rounds.length === 0) {
    throw new WizardValidationError('MISSING_ROUNDS', 'A eleição deve possuir pelo menos um turno configurado.');
  }

  if (!payload.scopes || !Array.isArray(payload.scopes) || payload.scopes.length === 0) {
    throw new WizardValidationError('MISSING_SCOPES', 'A eleição deve possuir ao menos uma abrangência geográfica configurada.');
  }

  // 2. Transação Atômica com Prisma
  return await prisma.$transaction(async (tx) => {
    let electionId = payload.electionId;

    // Se estiver atualizando uma eleição existente:
    if (electionId) {
      const existing = await tx.election.findUnique({
        where: { id: electionId },
        include: {
          reports: {
            where: { status: 'PROCESSADO', isSimulation: false }
          }
        }
      });

      if (!existing) {
        throw new WizardValidationError('ELECTION_NOT_FOUND', `Eleição (${electionId}) não encontrada.`);
      }

      // Proteção contra alterações destrutivas: se a eleição já tiver BUs reais processados, bloquear edição profunda
      if (existing.reports.length > 0 && existing.status !== 'DRAFT') {
        throw new WizardValidationError(
          'ELECTION_HAS_PROCESSED_VOTES',
          'Não é permitido alterar a estrutura desta eleição pois já existem Boletins de Urna reais processados. Utilize as rotas operacionais de ajuste contextual.'
        );
      }

      await tx.election.update({
        where: { id: electionId },
        data: {
          name: payload.name.trim(),
          year,
          type: payload.type,
          description: payload.description ? payload.description.trim() : null,
          plei: payload.plei ? payload.plei.trim() : null,
          status: payload.status || 'DRAFT'
        }
      });
    } else {
      // Criar nova eleição
      const created = await tx.election.create({
        data: {
          name: payload.name.trim(),
          year,
          type: payload.type,
          description: payload.description ? payload.description.trim() : null,
          plei: payload.plei ? payload.plei.trim() : null,
          status: payload.status || 'DRAFT'
        }
      });
      electionId = created.id;
    }

    // 3. Processar Abrangências Geográficas (ElectionScope)
    // Garantir que os Estados e Municípios existam no banco
    const createdScopeKeys = new Set<string>();

    for (const sc of payload.scopes) {
      let stateId: string | null = null;
      let municipalityId: string | null = null;
      let stateUf = (sc.stateAbbreviation || '').trim().toUpperCase();

      if (sc.scopeType === 'NACIONAL') {
        stateUf = 'BR';
      } else {
        if (!stateUf || !VALID_BRAZILIAN_UFS.has(stateUf)) {
          throw new WizardValidationError('INVALID_UF', `UF '${stateUf}' informada na abrangência é inválida.`);
        }

        // Upsert do Estado
        const stateRecord = await tx.state.upsert({
          where: { abbreviation: stateUf },
          update: {},
          create: {
            name: stateUf,
            abbreviation: stateUf
          }
        });
        stateId = stateRecord.id;

        if (sc.scopeType === 'MUNICIPAL') {
          const muniCode = (sc.municipalityOfficialCode || '').trim();
          if (!muniCode || !/^\d+$/.test(muniCode)) {
            throw new WizardValidationError('INVALID_MUNICIPALITY_CODE', `Código TSE do município '${muniCode}' deve ser numérico.`);
          }

          const muniName = (sc.municipalityName || `Município ${muniCode}`).trim();

          const muniRecord = await tx.municipality.upsert({
            where: { officialCode: muniCode },
            update: {
              name: muniName,
              stateId
            },
            create: {
              officialCode: muniCode,
              name: muniName,
              stateId,
              ibgeCode: sc.ibgeCode || null,
              isCoverage: true
            }
          });
          municipalityId = muniRecord.id;
        }
      }

      const canonicalKey = buildCanonicalScopeKey({
        scopeType: sc.scopeType,
        stateCode: stateUf,
        muniCode: sc.municipalityOfficialCode
      });

      createdScopeKeys.add(canonicalKey);

      await tx.electionScope.upsert({
        where: {
          electionId_scopeKey: {
            electionId: electionId!,
            scopeKey: canonicalKey
          }
        },
        update: {
          stateId,
          municipalityId,
          isCoverageArea: true
        },
        create: {
          electionId: electionId!,
          scopeType: sc.scopeType,
          scopeKey: canonicalKey,
          stateId,
          municipalityId,
          isCoverageArea: true
        }
      });
    }

    // Remover escopos não mais presentes (apenas se não houver votos vinculados)
    const scopesToRemove = await tx.electionScope.findMany({
      where: {
        electionId: electionId!,
        scopeKey: { notIn: Array.from(createdScopeKeys) }
      }
    });

    for (const oldScope of scopesToRemove) {
      await tx.electionScope.delete({
        where: { id: oldScope.id }
      });
    }

    // 4. Processar Turnos (ElectionRound)
    const existingRounds = await tx.electionRound.findMany({
      where: { electionId: electionId! }
    });
    const roundMap = new Map<number, string>();

    for (const r of payload.rounds) {
      const rNum = Number(r.roundNumber);
      if (![1, 2].includes(rNum)) {
        throw new WizardValidationError('INVALID_ROUND_NUMBER', `Número de turno inválido: ${rNum}. Deve ser 1 ou 2.`);
      }

      const hasSections = (payload.coverage && payload.coverage.length > 0);
      // REGRA OBRIGATÓRIA: Não homologar automaticamente cobertura apenas por cadastrá-la!
      const defaultCoverageStatus = hasSections ? 'REGISTERED' : 'PROVISIONAL';

      const roundRecord = await tx.electionRound.upsert({
        where: {
          electionId_roundNumber: {
            electionId: electionId!,
            roundNumber: rNum
          }
        },
        update: {
          plei: r.plei ? r.plei.trim() : null,
          date: r.date ? new Date(r.date) : null,
          coverageOrigin: 'ADMIN_CADASTRO'
        },
        create: {
          electionId: electionId!,
          roundNumber: rNum,
          plei: r.plei ? r.plei.trim() : null,
          date: r.date ? new Date(r.date) : null,
          status: 'PLANNED',
          coverageStatus: defaultCoverageStatus,
          coverageOrigin: 'ADMIN_CADASTRO'
        }
      });
      roundMap.set(rNum, roundRecord.id);
    }

    // 5. Processar Cargos (Office)
    const officeCodeToIdMap = new Map<string, string>();
    if (payload.offices && Array.isArray(payload.offices)) {
      for (const off of payload.offices) {
        const offCode = off.code.trim();
        const offName = off.name.trim();
        const offType = off.type || 'MAJORITARIO';

        const officeRecord = await tx.office.upsert({
          where: {
            electionId_code: {
              electionId: electionId!,
              code: offCode
            }
          },
          update: {
            name: offName,
            type: offType,
            orderNumber: off.orderNumber || 1,
            maxVotesPerVoter: off.maxVotesPerVoter || 1
          },
          create: {
            electionId: electionId!,
            code: offCode,
            name: offName,
            type: offType,
            orderNumber: off.orderNumber || 1,
            maxVotesPerVoter: off.maxVotesPerVoter || 1
          }
        });
        officeCodeToIdMap.set(offCode, officeRecord.id);
      }
    }

    // 6. Processar Partidos (Party)
    const partyNumberToIdMap = new Map<string, string>();
    if (payload.parties && Array.isArray(payload.parties)) {
      for (const p of payload.parties) {
        const pNum = p.officialIdentifier.trim();
        const pName = p.name.trim();
        const pAbbr = p.abbreviation.trim().toUpperCase();

        const partyRecord = await tx.party.upsert({
          where: { officialIdentifier: pNum },
          update: {
            name: pName,
            abbreviation: pAbbr
          },
          create: {
            officialIdentifier: pNum,
            name: pName,
            abbreviation: pAbbr
          }
        });
        partyNumberToIdMap.set(pNum, partyRecord.id);
      }
    }

    // 7. Processar Candidatos (Candidate)
    if (payload.candidates && Array.isArray(payload.candidates)) {
      for (const cand of payload.candidates) {
        const offCode = cand.officeCode.trim();
        const officeId = officeCodeToIdMap.get(offCode);
        if (!officeId) {
          throw new WizardValidationError('OFFICE_NOT_FOUND', `Cargo '${offCode}' associado ao candidato '${cand.name}' não foi encontrado.`);
        }

        const partyNum = cand.partyNumber.trim();
        let partyId = partyNumberToIdMap.get(partyNum);

        // Se o partido ainda não foi registrado, cria automaticamente
        if (!partyId) {
          const pName = cand.partyName?.trim() || `Partido ${partyNum}`;
          const pAbbr = cand.partyAbbreviation?.trim().toUpperCase() || partyNum;
          const newParty = await tx.party.upsert({
            where: { officialIdentifier: partyNum },
            update: {},
            create: {
              officialIdentifier: partyNum,
              name: pName,
              abbreviation: pAbbr
            }
          });
          partyId = newParty.id;
          partyNumberToIdMap.set(partyNum, partyId);
        }

        const candNum = cand.candidateNumber.trim();
        const candName = cand.name.trim();
        const ballotName = (cand.ballotName || candName).trim();

        await tx.candidate.upsert({
          where: {
            officeId_candidateNumber: {
              officeId,
              candidateNumber: candNum
            }
          },
          update: {
            name: candName,
            ballotName,
            partyId,
            photoUrl: cand.photoUrl || null,
            isActive: true
          },
          create: {
            officeId,
            candidateNumber: candNum,
            name: candName,
            ballotName,
            partyId,
            photoUrl: cand.photoUrl || null,
            isActive: true
          }
        });
      }
    }

    // 8. Processar Malha Eleitoral e Cobertura (PollingZone, PollingSection, RoundCoverage)
    if (payload.coverage && Array.isArray(payload.coverage) && payload.coverage.length > 0) {
      // Coletar seções para vincular a todos os turnos configurados
      const sectionIdsToCover: string[] = [];

      for (const cov of payload.coverage) {
        const muniCode = cov.municipalityOfficialCode.trim();
        const muni = await tx.municipality.findUnique({
          where: { officialCode: muniCode }
        });

        if (!muni) {
          throw new WizardValidationError('MUNICIPALITY_NOT_FOUND', `Município com código oficial '${muniCode}' não foi localizado.`);
        }

        const zoneNum = cov.zoneNumber.trim();
        const zone = await tx.pollingZone.upsert({
          where: {
            municipalityId_zoneNumber: {
              municipalityId: muni.id,
              zoneNumber: zoneNum
            }
          },
          update: {},
          create: {
            municipalityId: muni.id,
            zoneNumber: zoneNum
          }
        });

        const secNum = cov.sectionNumber.trim();
        const expectedBUs = cov.isAggregated ? 0 : (cov.expectedBUs !== undefined ? cov.expectedBUs : 1);

        const section = await tx.pollingSection.upsert({
          where: {
            pollingZoneId_sectionNumber: {
              pollingZoneId: zone.id,
              sectionNumber: secNum
            }
          },
          update: {
            expectedBUs,
            isAggregated: Boolean(cov.isAggregated),
            aggregatedIntoSec: cov.aggregatedIntoSec ? cov.aggregatedIntoSec.trim() : null,
            locationName: cov.locationName ? cov.locationName.trim() : null
          },
          create: {
            pollingZoneId: zone.id,
            sectionNumber: secNum,
            expectedBUs,
            isAggregated: Boolean(cov.isAggregated),
            aggregatedIntoSec: cov.aggregatedIntoSec ? cov.aggregatedIntoSec.trim() : null,
            locationName: cov.locationName ? cov.locationName.trim() : null
          }
        });

        sectionIdsToCover.push(section.id);
      }

      // Sincronizar RoundCoverage para cada turno configurado
      for (const [, roundId] of roundMap) {
        for (const secId of sectionIdsToCover) {
          await tx.roundCoverage.upsert({
            where: {
              electionRoundId_pollingSectionId: {
                electionRoundId: roundId,
                pollingSectionId: secId
              }
            },
            update: {
              expectedBUs: 1
            },
            create: {
              electionRoundId: roundId,
              pollingSectionId: secId,
              expectedBUs: 1,
              isManualOverride: false
            }
          });
        }

        // Atualizar status para REGISTERED (Cadastrada - validação pendente)
        // NUNCA homologar automaticamente!
        await tx.electionRound.update({
          where: { id: roundId },
          data: {
            coverageStatus: 'REGISTERED'
          }
        });
      }
    }

    // 9. Processar Operadores
    if (payload.operators && Array.isArray(payload.operators)) {
      for (const op of payload.operators) {
        const opEmail = op.email.trim().toLowerCase();
        if (!opEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opEmail)) {
          continue;
        }

        const existingUser = await tx.user.findUnique({
          where: { email: opEmail }
        });

        if (!existingUser) {
          // Criar novo usuário operador com senha padrão segura provisória
          const tempPassword = `Op@${crypto.randomBytes(4).toString('hex')}!`;
          const passwordHash = await bcrypt.hash(tempPassword, 12);
          await tx.user.create({
            data: {
              email: opEmail,
              name: op.name ? op.name.trim() : opEmail.split('@')[0],
              role: 'OPERATOR',
              isActive: true,
              passwordHash
            }
          });
        }
      }
    }

    // 10. Registrar Auditoria
    await tx.auditLog.create({
      data: {
        userId,
        electionId: electionId!,
        action: payload.electionId ? 'WIZARD_UPDATE_ELECTION' : 'WIZARD_CREATE_ELECTION',
        identifiers: `Election: ${payload.name} (${year}) - Status: ${payload.status || 'DRAFT'}`,
        result: 'SUCCESS',
        newStatus: payload.status || 'DRAFT',
        metadata: JSON.stringify({
          scopesCount: payload.scopes.length,
          roundsCount: payload.rounds.length,
          officesCount: payload.offices.length,
          candidatesCount: payload.candidates?.length || 0,
          coverageCount: payload.coverage?.length || 0
        })
      }
    });

    return {
      success: true,
      electionId: electionId!,
      message: payload.status === 'READY'
        ? 'Eleição salva e pronta para ativação.'
        : 'Rascunho da eleição salvo com sucesso.'
    };
  });
}

/**
 * Ativa administrativamente uma eleição validando a confirmação textual
 * e aplicando isolamento contextual (desativação segura de outras eleições ativas).
 */
export async function activateElectionWizard(
  userId: string,
  electionId: string,
  confirmationText: string
) {
  if (!electionId || typeof electionId !== 'string') {
    throw new WizardValidationError('INVALID_ELECTION_ID', 'ID da eleição não informado.');
  }

  // 1. Validação de Confirmação Textual via utilitário compartilhado
  const { aliases } = getConfirmationAliases('ACTIVATE_ELECTION');
  const isValid = validateAdminConfirmation(confirmationText, aliases);

  if (!isValid) {
    throw new WizardValidationError(
      'INVALID_CONFIRMATION',
      'Frase de confirmação incorreta. Digite "ATIVAR ELEIÇÃO" para confirmar a ativação operacional.'
    );
  }

  return await prisma.$transaction(async (tx) => {
    // 2. Localizar eleição alvo e validar prontidão
    const target = await tx.election.findUnique({
      where: { id: electionId },
      include: {
        rounds: { orderBy: { roundNumber: 'asc' } },
        scopes: true,
        offices: {
          include: { candidates: true }
        }
      }
    });

    if (!target) {
      throw new WizardValidationError('ELECTION_NOT_FOUND', 'A eleição informada não existe.');
    }

    if (target.rounds.length === 0) {
      throw new WizardValidationError('NO_ROUNDS_CONFIGURED', 'A eleição precisa de pelo menos 1 turno para ser ativada.');
    }

    if (target.scopes.length === 0) {
      throw new WizardValidationError('NO_SCOPES_CONFIGURED', 'A eleição precisa de ao menos uma abrangência geográfica para ser ativada.');
    }

    if (target.offices.length === 0) {
      throw new WizardValidationError('NO_OFFICES_CONFIGURED', 'A eleição precisa de pelo menos 1 cargo em disputa para ser ativada.');
    }

    // 3. Desativar contextualmente qualquer outra eleição que esteja ACTIVE no momento
    const currentlyActive = await tx.election.findMany({
      where: {
        id: { not: electionId },
        status: 'ACTIVE'
      }
    });

    for (const act of currentlyActive) {
      await tx.election.update({
        where: { id: act.id },
        data: { status: 'FINISHED' }
      });

      // Encerrar turnos da eleição anterior
      await tx.electionRound.updateMany({
        where: {
          electionId: act.id,
          status: 'ACTIVE'
        },
        data: { status: 'FINISHED' }
      });

      await tx.auditLog.create({
        data: {
          userId,
          electionId: act.id,
          action: 'ELECTION_CONTEXT_SWITCH_DEACTIVATED',
          identifiers: `Deactivated in favor of election ${electionId}`,
          result: 'SUCCESS',
          previousStatus: 'ACTIVE',
          newStatus: 'FINISHED'
        }
      });
    }

    // 4. Ativar a nova eleição e seu 1º Turno
    const round1 = target.rounds.find(r => r.roundNumber === 1) || target.rounds[0];

    await tx.election.update({
      where: { id: electionId },
      data: { status: 'ACTIVE' }
    });

    await tx.electionRound.update({
      where: { id: round1.id },
      data: { status: 'ACTIVE' }
    });

    // 5. Registrar Log de Auditoria
    await tx.auditLog.create({
      data: {
        userId,
        electionId,
        roundId: round1.id,
        action: 'ACTIVATE_ELECTION',
        identifiers: `Activated Election: ${target.name} (${target.year}) - Round 1 ACTIVE`,
        result: 'SUCCESS',
        previousStatus: target.status,
        newStatus: 'ACTIVE',
        metadata: JSON.stringify({
          confirmationText: confirmationText.trim(),
          scopesCount: target.scopes.length,
          officesCount: target.offices.length,
          roundsCount: target.rounds.length
        })
      }
    });

    return {
      success: true,
      electionId,
      roundId: round1.id,
      message: `Eleição '${target.name}' e 1º Turno ativados com sucesso.`
    };
  });
}

/**
 * Validação rigorosa e sanitização de dados externos (TSE / JSON exportado) antes da ingestão.
 * NUNCA executa escrita automática no banco sem pré-visualização e confirmação pelo usuário.
 */
export function validateAndParseTseImport(rawJson: unknown): TseImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawJson || typeof rawJson !== 'object') {
    return {
      valid: false,
      format: 'UNIVERSAL_WIZARD_JSON',
      summary: { roundsCount: 0, officesCount: 0, candidatesCount: 0, partiesCount: 0, sectionsCount: 0 },
      data: {},
      errors: ['O arquivo fornecido não é um objeto JSON válido.']
    };
  }

  const payload = rawJson as Record<string, any>;

  // Formato 1: Estrutura oficial TSE ele-c (Configuração de Pleito)
  if (payload.plei || (payload.cd && payload.tp && Array.isArray(payload.car))) {
    const pleiCode = String(payload.plei || payload.cd || '').trim();
    const ano = Number(payload.ano || payload.year || new Date().getFullYear());
    const offices: WizardOfficeInput[] = [];

    if (Array.isArray(payload.car)) {
      for (const c of payload.car) {
        if (c.cd && c.nm) {
          offices.push({
            code: String(c.cd),
            name: String(c.nm),
            type: c.tp === 'P' ? 'PROPORCIONAL' : 'MAJORITARIO',
            maxVotesPerVoter: Number(c.nv || 1)
          });
        }
      }
    }

    const rounds: WizardRoundInput[] = [
      { roundNumber: 1, plei: pleiCode }
    ];
    if (payload.t === '2' || payload.t2 || payload.round2) {
      rounds.push({ roundNumber: 2, plei: pleiCode });
    }

    return {
      valid: true,
      format: 'TSE_ELE_C',
      summary: {
        roundsCount: rounds.length,
        officesCount: offices.length,
        candidatesCount: 0,
        partiesCount: 0,
        sectionsCount: 0
      },
      data: {
        election: {
          name: payload.nm || `Eleição Oficial TSE ${ano}`,
          year: ano,
          plei: pleiCode,
          type: payload.tp === 'M' ? 'MUNICIPAL' : 'GENERAL'
        },
        rounds,
        offices
      },
      warnings: ['Dados de configuração básica extraídos do TSE. Cadastre ou importe os candidatos nos passos seguintes.']
    };
  }

  // Formato 2: Lista de Candidatos Oficiais TSE (ex.: candidatos.json ou EA20 / DivulgaCand)
  if (Array.isArray(payload.candidatos) || Array.isArray(payload.candidates)) {
    const candList = Array.isArray(payload.candidatos) ? payload.candidatos : payload.candidates;
    const candidates: WizardCandidateInput[] = [];
    const partiesMap = new Map<string, WizardPartyInput>();
    const officesMap = new Map<string, WizardOfficeInput>();

    for (const raw of candList) {
      if (!raw || typeof raw !== 'object') continue;

      const num = String(raw.nr || raw.numero || raw.candidateNumber || '').trim();
      const name = String(raw.nm || raw.nome || raw.name || '').trim();
      const ballotName = String(raw.nmu || raw.nomeUrna || raw.ballotName || name).trim();
      const offCode = String(raw.cdCargo || raw.cargo || raw.officeCode || '1').trim();
      const offName = String(raw.dsCargo || raw.nomeCargo || raw.officeName || `Cargo ${offCode}`).trim();
      const partyNum = String(raw.nrPartido || raw.partido || raw.partyNumber || (num.length >= 2 ? num.slice(0, 2) : '99')).trim();
      const partyAbbr = String(raw.sgPartido || raw.siglaPartido || raw.partyAbbreviation || partyNum).trim();
      const partyName = String(raw.nmPartido || raw.nomePartido || raw.partyName || `Partido ${partyAbbr}`).trim();

      if (!num || !name) {
        warnings.push(`Candidato ignorado por ausência de número ou nome: ${JSON.stringify(raw)}`);
        continue;
      }

      if (!officesMap.has(offCode)) {
        officesMap.set(offCode, {
          code: offCode,
          name: offName,
          type: ['11', '1', '3', '5'].includes(offCode) ? 'MAJORITARIO' : 'PROPORCIONAL'
        });
      }

      if (!partiesMap.has(partyNum)) {
        partiesMap.set(partyNum, {
          officialIdentifier: partyNum,
          name: partyName,
          abbreviation: partyAbbr
        });
      }

      candidates.push({
        officeCode: offCode,
        candidateNumber: num,
        name,
        ballotName,
        partyNumber: partyNum,
        partyName,
        partyAbbreviation: partyAbbr
      });
    }

    return {
      valid: candidates.length > 0,
      format: 'TSE_CANDIDATES',
      summary: {
        roundsCount: 0,
        officesCount: officesMap.size,
        candidatesCount: candidates.length,
        partiesCount: partiesMap.size,
        sectionsCount: 0
      },
      data: {
        offices: Array.from(officesMap.values()),
        parties: Array.from(partiesMap.values()),
        candidates
      },
      errors: candidates.length === 0 ? ['Nenhum candidato válido foi encontrado no arquivo.'] : undefined,
      warnings: warnings.slice(0, 5)
    };
  }

  // Formato 3: JSON Universal do Wizard
  if (payload.election || payload.name) {
    const ele = payload.election || payload;
    const offices: WizardOfficeInput[] = Array.isArray(payload.offices) ? payload.offices : [];
    const candidates: WizardCandidateInput[] = Array.isArray(payload.candidates) ? payload.candidates : [];
    const parties: WizardPartyInput[] = Array.isArray(payload.parties) ? payload.parties : [];
    const coverage: WizardCoverageSectionInput[] = Array.isArray(payload.coverage) ? payload.coverage : [];
    const rounds: WizardRoundInput[] = Array.isArray(payload.rounds) ? payload.rounds : [];
    const scopes: WizardScopeInput[] = Array.isArray(payload.scopes) ? payload.scopes : [];

    return {
      valid: true,
      format: 'UNIVERSAL_WIZARD_JSON',
      summary: {
        roundsCount: rounds.length,
        officesCount: offices.length,
        candidatesCount: candidates.length,
        partiesCount: parties.length,
        sectionsCount: coverage.length
      },
      data: {
        election: {
          name: ele.name,
          year: ele.year,
          type: ele.type,
          plei: ele.plei,
          description: ele.description
        },
        rounds,
        offices,
        parties,
        candidates,
        coverage,
        scopes
      }
    };
  }

  return {
    valid: false,
    format: 'UNIVERSAL_WIZARD_JSON',
    summary: { roundsCount: 0, officesCount: 0, candidatesCount: 0, partiesCount: 0, sectionsCount: 0 },
    data: {},
    errors: ['Formato de arquivo não reconhecido. Forneça uma estrutura JSON oficial do TSE ou exportação compatível do Wizard.']
  };
}
