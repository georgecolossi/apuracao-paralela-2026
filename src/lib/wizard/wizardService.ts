import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  buildCanonicalScopeKey,
  canonicalizeScopeKey,
  validateElectionScopesSet,
  ElectionInvariantError,
  VALID_BRAZILIAN_UFS
} from '@/lib/validation/electionContext';
import { validateAdminConfirmation, getConfirmationAliases } from '@/lib/normalization';
import { validatePasswordStrength } from '@/lib/validation/password';

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
  coverage?: WizardCoverageSectionInput[];
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
  roundNumber?: number; // Opcional: vincula a um turno específico. Se omitido, aplica a todos os turnos configurados
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
  initialPassword?: string;
}

export interface WizardPayload {
  electionId?: string;
  name: string;
  year: number;
  type: 'GENERAL' | 'MUNICIPAL' | 'SUPPLEMENTARY' | 'CONSULTA';
  description?: string;
  plei?: string;
  status?: 'DRAFT';
  scopes?: WizardScopeInput[];
  rounds?: WizardRoundInput[];
  offices?: WizardOfficeInput[];
  parties?: WizardPartyInput[];
  candidates?: WizardCandidateInput[];
  coverage?: WizardCoverageSectionInput[];
  operators?: WizardOperatorInput[];
}

export interface TseCandidateValidationItem {
  officeCode: string;
  candidateNumber: string;
  name: string;
  ballotName: string;
  partyNumber: string;
  partyName?: string;
  partyAbbreviation?: string;
  isConfirmed: boolean;
  missingFields: string[];
  suggestions: Record<string, string>;
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
    confirmedRecordsCount: number;
    recordsWithWarningsCount: number;
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
  validationDetails?: TseCandidateValidationItem[];
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
          select: { rounds: true, offices: true, scopes: true, reports: true }
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
        updatedAt: true,
        _count: {
          select: { rounds: true, offices: true, scopes: true, reports: true }
        }
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
        },
        reports: {
          select: { id: true, status: true, isSimulation: false }
        }
      }
    });

    if (election) {
      const operators = await prisma.user.findMany({
        where: { role: 'OPERATOR', isActive: true },
        select: { id: true, name: true, email: true, role: true }
      });

      electionDetails = {
        ...election,
        hasBoundReports: election.reports.length > 0,
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
 * Atende às diretrizes de isolamento, integridade global e não-homologação precipitada de cobertura.
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

  // 2. Transação Atômica com Prisma
  return await prisma.$transaction(async (tx) => {
    let electionId = payload.electionId;
    let isNewElection = false;

    // Se estiver atualizando uma eleição existente:
    if (electionId) {
      const existing = await tx.election.findUnique({
        where: { id: electionId },
        include: {
          reports: {
            where: { isSimulation: false }
          },
          scopes: true,
          rounds: true,
          offices: { include: { candidates: true } }
        }
      });

      if (!existing) {
        throw new WizardValidationError('ELECTION_NOT_FOUND', `Eleição (${electionId}) não encontrada.`);
      }

      // ITEM 1 DA AUDITORIA: Bloquear alterações estruturais se houver BUs vinculados (independentemente de DRAFT, ACTIVE ou FINISHED)
      const hasBoundReports = existing.reports.length > 0;

      if (hasBoundReports) {
        // Verificar se alguma alteração estrutural foi enviada:
        const structuralChangeAttempted =
          payload.scopes !== undefined ||
          payload.offices !== undefined ||
          payload.candidates !== undefined ||
          payload.rounds !== undefined ||
          payload.coverage !== undefined;

        if (structuralChangeAttempted) {
          throw new WizardValidationError(
            'ELECTION_HAS_BOUND_REPORTS',
            `A eleição possui ${existing.reports.length} Boletim(ns) de Urna vinculado(s) (processados ou pendentes). Alterações estruturais (escopos, turnos, cargos, candidatos ou cobertura) estão bloqueadas para preservar a integridade do pleito.`
          );
        }
      }

      await tx.election.update({
        where: { id: electionId },
        data: {
          name: payload.name.trim(),
          year,
          type: payload.type,
          description: payload.description !== undefined ? (payload.description ? payload.description.trim() : null) : undefined,
          plei: payload.plei !== undefined ? (payload.plei ? payload.plei.trim() : null) : undefined,
          status: 'DRAFT' // O wizard salva exclusivamente no estado DRAFT
        }
      });
    } else {
      // Criar nova eleição
      isNewElection = true;
      const created = await tx.election.create({
        data: {
          name: payload.name.trim(),
          year,
          type: payload.type,
          description: payload.description ? payload.description.trim() : null,
          plei: payload.plei ? payload.plei.trim() : null,
          status: 'DRAFT'
        }
      });
      electionId = created.id;
    }

    // 3. Processar Abrangências Geográficas (ElectionScope) - Se fornecido
    if (payload.scopes !== undefined) {
      if (payload.scopes.length === 0) {
        // Se a lista foi explicitamente fornecida vazia
        const reportsInScope = await tx.ballotReport.count({ where: { electionId: electionId! } });
        if (reportsInScope > 0) {
          throw new WizardValidationError('CANNOT_CLEAR_SCOPES', 'Não é possível remover todos os escopos pois existem relatórios vinculados à eleição.');
        }
        await tx.electionScope.deleteMany({ where: { electionId: electionId! } });
      } else {
        // Validar e normalizar cada escopo
        const normalizedScopesForValidation: Array<{ scopeType: string; stateCode?: string; muniCode?: string; canonicalKey: string }> = [];
        const scopeDefinitions: Array<{
          canonicalKey: string;
          scopeType: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL';
          stateId: string | null;
          municipalityId: string | null;
        }> = [];

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

            // Localizar ou criar Estado sem sobrescrever nomes divergentes
            const existingState = await tx.state.findUnique({
              where: { abbreviation: stateUf }
            });

            if (existingState) {
              stateId = existingState.id;
            } else {
              const newState = await tx.state.create({
                data: {
                  name: stateUf,
                  abbreviation: stateUf
                }
              });
              stateId = newState.id;
            }

            if (sc.scopeType === 'MUNICIPAL') {
              const muniCode = (sc.municipalityOfficialCode || '').trim();
              if (!muniCode || !/^\d+$/.test(muniCode)) {
                throw new WizardValidationError('INVALID_MUNICIPALITY_CODE', `Código TSE do município '${muniCode}' deve ser numérico.`);
              }

              // ITEM 2 DA AUDITORIA: Não permitir que cadastrar uma eleição altere silenciosamente dados municipais existentes
              const existingMuni = await tx.municipality.findUnique({
                where: { officialCode: muniCode },
                include: { state: true }
              });

              if (existingMuni) {
                // Verificar se a UF corresponde
                if (existingMuni.state.abbreviation.toUpperCase() !== stateUf) {
                  throw new WizardValidationError(
                    'MUNICIPALITY_STATE_CONFLICT',
                    `Conflito cadastral: O município com código TSE ${muniCode} já está registrado como '${existingMuni.name}' no estado ${existingMuni.state.abbreviation}, divergindo da UF informada (${stateUf}).`
                  );
                }

                // Verificar se o nome informado diverge flagrantemente do existente
                if (sc.municipalityName && sc.municipalityName.trim()) {
                  const cleanNameInput = sc.municipalityName.trim().toLowerCase();
                  const cleanExistingName = existingMuni.name.toLowerCase();
                  if (cleanNameInput !== cleanExistingName && !cleanExistingName.includes(cleanNameInput) && !cleanNameInput.includes(cleanExistingName)) {
                    throw new WizardValidationError(
                      'MUNICIPALITY_NAME_CONFLICT',
                      `Conflito cadastral: O código TSE ${muniCode} já corresponde ao município "${existingMuni.name}". Não é permitido sobrescrever dados municipais de referência.`
                    );
                  }
                }

                municipalityId = existingMuni.id;
              } else {
                // Criar município novo
                const muniName = (sc.municipalityName || `Município ${muniCode}`).trim();
                const newMuni = await tx.municipality.create({
                  data: {
                    officialCode: muniCode,
                    name: muniName,
                    stateId: stateId!,
                    ibgeCode: sc.ibgeCode ? sc.ibgeCode.trim() : null,
                    isCoverage: true
                  }
                });
                municipalityId = newMuni.id;
              }
            }
          }

          const canonicalKey = buildCanonicalScopeKey({
            scopeType: sc.scopeType,
            stateCode: stateUf,
            muniCode: sc.municipalityOfficialCode
          });

          normalizedScopesForValidation.push({
            scopeType: sc.scopeType,
            stateCode: stateUf,
            muniCode: sc.municipalityOfficialCode,
            canonicalKey
          });

          scopeDefinitions.push({
            canonicalKey,
            scopeType: sc.scopeType,
            stateId,
            municipalityId
          });
        }

        // ITEM 6 DA AUDITORIA: Aplicar validateElectionScopesSet() ao conjunto final de escopos antes da persistência
        validateElectionScopesSet(normalizedScopesForValidation);

        const currentScopeKeys = new Set(scopeDefinitions.map(s => s.canonicalKey));

        // Remover escopos desta eleição que não constam mais no payload
        const scopesToDelete = await tx.electionScope.findMany({
          where: {
            electionId: electionId!,
            scopeKey: { notIn: Array.from(currentScopeKeys) }
          }
        });

        for (const oldScope of scopesToDelete) {
          await tx.electionScope.delete({ where: { id: oldScope.id } });
        }

        // Upsert dos escopos validados
        for (const def of scopeDefinitions) {
          await tx.electionScope.upsert({
            where: {
              electionId_scopeKey: {
                electionId: electionId!,
                scopeKey: def.canonicalKey
              }
            },
            update: {
              stateId: def.stateId,
              municipalityId: def.municipalityId,
              isCoverageArea: true
            },
            create: {
              electionId: electionId!,
              scopeType: def.scopeType,
              scopeKey: def.canonicalKey,
              stateId: def.stateId,
              municipalityId: def.municipalityId,
              isCoverageArea: true
            }
          });
        }
      }
    }

    // 4. Processar Turnos (ElectionRound) - Se fornecido
    const roundMap = new Map<number, string>();
    if (payload.rounds !== undefined) {
      if (payload.rounds.length === 0) {
        throw new WizardValidationError('MISSING_ROUNDS', 'A eleição deve possuir pelo menos um turno configurado.');
      }

      const activeRoundNumbers = new Set(payload.rounds.map(r => Number(r.roundNumber)));

      // Verificar remoção de turnos
      const roundsToDelete = await tx.electionRound.findMany({
        where: {
          electionId: electionId!,
          roundNumber: { notIn: Array.from(activeRoundNumbers) }
        },
        include: { reports: true }
      });

      for (const oldRound of roundsToDelete) {
        if (oldRound.reports.length > 0) {
          throw new WizardValidationError(
            'CANNOT_REMOVE_REFERENCED_ROUND',
            `Não é possível remover o ${oldRound.roundNumber}º Turno pois ele já possui Boletins de Urna vinculados.`
          );
        }
        await tx.electionRound.delete({ where: { id: oldRound.id } });
      }

      for (const r of payload.rounds) {
        const rNum = Number(r.roundNumber);
        if (![1, 2].includes(rNum)) {
          throw new WizardValidationError('INVALID_ROUND_NUMBER', `Número de turno inválido: ${rNum}. Deve ser 1 ou 2.`);
        }

        const roundRecord = await tx.electionRound.upsert({
          where: {
            electionId_roundNumber: {
              electionId: electionId!,
              roundNumber: rNum
            }
          },
          update: {
            plei: r.plei ? r.plei.trim() : null,
            date: r.date ? new Date(r.date) : null
          },
          create: {
            electionId: electionId!,
            roundNumber: rNum,
            plei: r.plei ? r.plei.trim() : null,
            date: r.date ? new Date(r.date) : null,
            status: 'PLANNED',
            coverageStatus: 'PROVISIONAL',
            coverageOrigin: 'ADMIN_CADASTRO'
          }
        });
        roundMap.set(rNum, roundRecord.id);
      }
    } else {
      // Carregar turnos existentes
      const currentRounds = await tx.electionRound.findMany({
        where: { electionId: electionId! }
      });
      for (const cr of currentRounds) {
        roundMap.set(cr.roundNumber, cr.id);
      }
    }

    // 5. Processar Cargos (Office) - Se fornecido
    const officeCodeToIdMap = new Map<string, string>();
    if (payload.offices !== undefined) {
      const incomingCodes = new Set(payload.offices.map(o => o.code.trim()));

      // Verificar cargos removidos
      const officesToDelete = await tx.office.findMany({
        where: {
          electionId: electionId!,
          code: { notIn: Array.from(incomingCodes) }
        },
        include: { votes: true, candidates: { include: { votes: true } } }
      });

      for (const oldOffice of officesToDelete) {
        const hasVotes = oldOffice.votes.length > 0 || oldOffice.candidates.some(c => c.votes.length > 0);
        if (hasVotes) {
          throw new WizardValidationError(
            'CANNOT_REMOVE_REFERENCED_OFFICE',
            `Não é possível remover o cargo '${oldOffice.name}' (${oldOffice.code}) pois existem votos vinculados.`
          );
        }
        await tx.office.delete({ where: { id: oldOffice.id } });
      }

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
    } else {
      // Carregar cargos existentes
      const currentOffices = await tx.office.findMany({
        where: { electionId: electionId! }
      });
      for (const co of currentOffices) {
        officeCodeToIdMap.set(co.code, co.id);
      }
    }

    // 6. Processar Partidos (Party) - Se fornecido
    // ITEM 2 DA AUDITORIA: Não permitir sobrescrita global de partidos
    const partyNumberToIdMap = new Map<string, string>();
    if (payload.parties !== undefined) {
      for (const p of payload.parties) {
        const pNum = p.officialIdentifier.trim();
        const pName = p.name.trim();
        const pAbbr = p.abbreviation.trim().toUpperCase();

        const existingParty = await tx.party.findUnique({
          where: { officialIdentifier: pNum }
        });

        if (existingParty) {
          // Se o partido já existe, validar se há conflito nos dados fundamentais
          if (existingParty.abbreviation.toUpperCase() !== pAbbr && pAbbr.length > 0) {
            throw new WizardValidationError(
              'PARTY_DATA_CONFLICT',
              `Conflito partidário: O partido número ${pNum} já está registrado como "${existingParty.name} (${existingParty.abbreviation})". Não é permitido sobrescrever a sigla para "${pAbbr}".`
            );
          }
          partyNumberToIdMap.set(pNum, existingParty.id);
        } else {
          const newParty = await tx.party.create({
            data: {
              officialIdentifier: pNum,
              name: pName,
              abbreviation: pAbbr
            }
          });
          partyNumberToIdMap.set(pNum, newParty.id);
        }
      }
    }

    // 7. Processar Candidatos (Candidate) - Se fornecido
    if (payload.candidates !== undefined) {
      const incomingCandidateTuples = new Set<string>();

      for (const cand of payload.candidates) {
        const offCode = cand.officeCode.trim();
        const officeId = officeCodeToIdMap.get(offCode);
        if (!officeId) {
          throw new WizardValidationError('OFFICE_NOT_FOUND', `Cargo '${offCode}' associado ao candidato '${cand.name}' não foi encontrado.`);
        }

        const partyNum = cand.partyNumber.trim();
        let partyId = partyNumberToIdMap.get(partyNum);

        // Se o partido ainda não foi registrado, busca ou cria com segurança
        if (!partyId) {
          const existingP = await tx.party.findUnique({
            where: { officialIdentifier: partyNum }
          });

          if (existingP) {
            partyId = existingP.id;
          } else {
            const pName = cand.partyName?.trim() || `Partido ${partyNum}`;
            const pAbbr = cand.partyAbbreviation?.trim().toUpperCase() || partyNum;
            const createdParty = await tx.party.create({
              data: {
                officialIdentifier: partyNum,
                name: pName,
                abbreviation: pAbbr
              }
            });
            partyId = createdParty.id;
          }
          partyNumberToIdMap.set(partyNum, partyId);
        }

        const candNum = cand.candidateNumber.trim();
        const candName = cand.name.trim();
        const ballotName = (cand.ballotName || candName).trim();
        incomingCandidateTuples.add(`${officeId}:${candNum}`);

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
            photoUrl: cand.photoUrl ? cand.photoUrl.trim() : null,
            isActive: true
          },
          create: {
            officeId,
            candidateNumber: candNum,
            name: candName,
            ballotName,
            partyId,
            photoUrl: cand.photoUrl ? cand.photoUrl.trim() : null,
            isActive: true
          }
        });
      }

      // Remover candidatos excluídos (verificando antes se possuem votos)
      const currentCandidates = await tx.candidate.findMany({
        where: { office: { electionId: electionId! } },
        include: { votes: true }
      });

      for (const cc of currentCandidates) {
        if (!incomingCandidateTuples.has(`${cc.officeId}:${cc.candidateNumber}`)) {
          if (cc.votes.length > 0) {
            throw new WizardValidationError(
              'CANNOT_REMOVE_REFERENCED_CANDIDATE',
              `Não é possível remover o candidato "${cc.ballotName}" (${cc.candidateNumber}) pois ele possui votos vinculados.`
            );
          }
          await tx.candidate.delete({ where: { id: cc.id } });
        }
      }
    }

    // 8. Processar Malha Eleitoral e Cobertura (PollingZone, PollingSection, RoundCoverage)
    // ITEM 6 DA AUDITORIA: Permitir configuração de RoundCoverage por turno (não presumir cobertura idêntica)
    if (payload.coverage !== undefined) {
      if (payload.coverage.length === 0) {
        // Se a malha foi esvaziada explicitamente
        for (const [, roundId] of roundMap) {
          const reportsCount = await tx.ballotReport.count({ where: { roundId } });
          if (reportsCount === 0) {
            await tx.roundCoverage.deleteMany({ where: { electionRoundId: roundId } });
            await tx.electionRound.update({
              where: { id: roundId },
              data: { coverageStatus: 'PROVISIONAL' }
            });
          }
        }
      } else {
        // Mapear seções por turno
        // Se item não tiver roundNumber especificado, aplica a todos os turnos
        const sectionsByRound = new Map<number, string[]>();

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

          // Determinar a quais turnos esta seção pertence
          const targetRounds = cov.roundNumber !== undefined
            ? [cov.roundNumber]
            : Array.from(roundMap.keys());

          for (const rNum of targetRounds) {
            if (!sectionsByRound.has(rNum)) {
              sectionsByRound.set(rNum, []);
            }
            sectionsByRound.get(rNum)!.push(section.id);
          }
        }

        // Sincronizar RoundCoverage para cada turno configurado
        for (const [rNum, roundId] of roundMap) {
          const sectionIds = sectionsByRound.get(rNum) || [];

          if (sectionIds.length > 0) {
            for (const secId of sectionIds) {
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

            // REGRA OBRIGATÓRIA: Nunca promover automaticamente para HOMOLOGATED
            // Permanece como REGISTERED (Cadastrada — validação pendente)
            await tx.electionRound.update({
              where: { id: roundId },
              data: {
                coverageStatus: 'REGISTERED'
              }
            });
          }
        }
      }
    }

    // 9. Processar Operadores - ITEM 7 DA AUDITORIA: Fluxo seguro, sem senhas temporárias desconhecidas
    if (payload.operators !== undefined) {
      for (const op of payload.operators) {
        const opEmail = op.email.trim().toLowerCase();
        if (!opEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opEmail)) {
          continue;
        }

        const existingUser = await tx.user.findUnique({
          where: { email: opEmail }
        });

        if (existingUser) {
          // Bloquear rebaixamento ou alteração automática de papéis de usuários existentes
          if (existingUser.role !== 'OPERATOR') {
            throw new WizardValidationError(
              'OPERATOR_ROLE_CONFLICT',
              `O usuário '${opEmail}' já possui o perfil '${existingUser.role}'. Não é permitido alterar o papel de contas existentes pelo assistente.`
            );
          }
        } else {
          // Criar nova conta de operador com política segura
          let passwordHash: string;
          let isActive = false;

          if (op.initialPassword) {
            // Validar senha fornecida pelo administrador
            const val = validatePasswordStrength(op.initialPassword);
            if (!val.valid) {
              throw new WizardValidationError(
                'INVALID_OPERATOR_PASSWORD',
                `A senha inicial informada para o operador ${opEmail} não cumpre os requisitos: ${val.errors.join(' ')}`
              );
            }
            passwordHash = await bcrypt.hash(op.initialPassword, 12);
            isActive = true;
          } else {
            // Conta inativa aguardando definição de senha pelo administrador
            // Hash gerado com CSPRNG de 256 bits, impossível de ser adivinhado
            const unusableEntropy = crypto.randomBytes(32).toString('hex');
            passwordHash = await bcrypt.hash(unusableEntropy, 12);
            isActive = false;
          }

          await tx.user.create({
            data: {
              email: opEmail,
              name: op.name ? op.name.trim() : opEmail.split('@')[0],
              role: 'OPERATOR',
              isActive,
              passwordHash
            }
          });
        }
      }
    }

    // 10. Registrar Auditoria Transacional
    await tx.auditLog.create({
      data: {
        userId,
        electionId: electionId!,
        action: isNewElection ? 'WIZARD_CREATE_ELECTION' : 'WIZARD_UPDATE_ELECTION',
        identifiers: `Election: ${payload.name} (${year}) - Status: DRAFT`,
        result: 'SUCCESS',
        newStatus: 'DRAFT',
        metadata: JSON.stringify({
          isNewElection,
          scopesProvided: payload.scopes !== undefined,
          roundsProvided: payload.rounds !== undefined,
          officesProvided: payload.offices !== undefined,
          candidatesProvided: payload.candidates !== undefined,
          coverageProvided: payload.coverage !== undefined,
          operatorsProvided: payload.operators !== undefined
        })
      }
    });

    return {
      success: true,
      electionId: electionId!,
      message: 'Rascunho da eleição salvo com sucesso.'
    };
  });
}

/**
 * ITEM 4 DA AUDITORIA: Ativa administrativamente uma eleição sem encerrar silenciosamente outras apurações.
 * Exige resolução de concorrência ou confirmação explícita de desativação contextual.
 */
export async function activateElectionWizard(
  userId: string,
  electionId: string,
  confirmationText: string,
  options?: {
    allowDeactivateCurrent?: boolean;
  }
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

    // 3. Verificar Concorrência de Eleição Ativa
    const otherActive = await tx.election.findMany({
      where: {
        id: { not: electionId },
        status: 'ACTIVE'
      },
      select: { id: true, name: true, year: true }
    });

    if (otherActive.length > 0) {
      if (!options?.allowDeactivateCurrent) {
        throw new WizardValidationError(
          'ACTIVE_ELECTION_CONFLICT',
          `Já existe uma eleição ativa no sistema: "${otherActive[0].name}" (${otherActive[0].year}). Conclua ou pause a apuração em andamento antes de ativar um novo pleito, ou solicite a desativação contextual explícita.`,
          {
            activeElectionId: otherActive[0].id,
            activeElectionName: otherActive[0].name,
            activeElectionYear: otherActive[0].year
          }
        );
      }

      // Se expressamente autorizado, arquiva contextualmente a eleição anterior (NÃO marca FINISHED nem altera votos!)
      for (const act of otherActive) {
        await tx.election.update({
          where: { id: act.id },
          data: { status: 'ARCHIVED' }
        });

        await tx.auditLog.create({
          data: {
            userId,
            electionId: act.id,
            action: 'ELECTION_CONTEXT_SWITCH_ARCHIVED',
            identifiers: `Archived contextually in favor of activating ${electionId}`,
            result: 'SUCCESS',
            previousStatus: 'ACTIVE',
            newStatus: 'ARCHIVED'
          }
        });
      }
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
 * ITEM 5 DA AUDITORIA: Validação rigorosa e sanitização de dados externos (TSE / JSON) antes da ingestão.
 * Não infere silenciosamente campos não confirmados pela fonte e distingue campos confirmados de sugestões.
 */
export function validateAndParseTseImport(rawJson: unknown): TseImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validationDetails: TseCandidateValidationItem[] = [];

  if (!rawJson || typeof rawJson !== 'object') {
    return {
      valid: false,
      format: 'UNIVERSAL_WIZARD_JSON',
      summary: {
        roundsCount: 0,
        officesCount: 0,
        candidatesCount: 0,
        partiesCount: 0,
        sectionsCount: 0,
        confirmedRecordsCount: 0,
        recordsWithWarningsCount: 0
      },
      data: {},
      errors: ['O arquivo fornecido não é um objeto JSON válido.']
    };
  }

  const payload = rawJson as Record<string, any>;

  // Formato 1: Estrutura oficial TSE ele-c (Configuração de Pleito)
  if (payload.plei || (payload.cd && payload.tp && Array.isArray(payload.car))) {
    const pleiCode = String(payload.plei || payload.cd || '').trim();
    const ano = Number(payload.ano || payload.year);

    if (!Number.isInteger(ano) || ano < 1900 || ano > 2100) {
      errors.push('Ano da eleição ausente ou fora do intervalo válido no arquivo TSE.');
    }

    const offices: WizardOfficeInput[] = [];

    if (Array.isArray(payload.car)) {
      for (const c of payload.car) {
        if (!c.cd || !c.nm) {
          warnings.push(`Cargo com identificador ou nome ausente foi ignorado: ${JSON.stringify(c)}`);
          continue;
        }

        const offCode = String(c.cd).trim();
        const offName = String(c.nm).trim();
        const offType = c.tp === 'P' ? 'PROPORCIONAL' : (c.tp === 'M' ? 'MAJORITARIO' : undefined);

        if (!offType) {
          warnings.push(`Tipo de disputa não informado explicitamente pelo TSE para o cargo ${offName}. Requer validação manual.`);
        }

        offices.push({
          code: offCode,
          name: offName,
          type: offType || 'MAJORITARIO',
          maxVotesPerVoter: Number(c.nv || 1)
        });
      }
    }

    const rounds: WizardRoundInput[] = [
      { roundNumber: 1, plei: pleiCode }
    ];
    if (payload.t === '2' || payload.t2 || payload.round2) {
      rounds.push({ roundNumber: 2, plei: pleiCode });
    }

    const isValid = errors.length === 0 && offices.length > 0;

    return {
      valid: isValid,
      format: 'TSE_ELE_C',
      summary: {
        roundsCount: rounds.length,
        officesCount: offices.length,
        candidatesCount: 0,
        partiesCount: 0,
        sectionsCount: 0,
        confirmedRecordsCount: offices.length,
        recordsWithWarningsCount: warnings.length
      },
      data: {
        election: {
          name: payload.nm ? String(payload.nm).trim() : `Eleições Oficiais TSE ${ano}`,
          year: ano,
          plei: pleiCode,
          type: payload.tp === 'M' ? 'MUNICIPAL' : 'GENERAL'
        },
        rounds,
        offices
      },
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : ['Dados básicos da eleição extraídos do TSE. Cadastre candidatos nos passos seguintes.']
    };
  }

  // Formato 2: Catálogo de Candidatos Oficiais TSE (ex.: candidatos.json ou EA20 / DivulgaCand)
  if (Array.isArray(payload.candidatos) || Array.isArray(payload.candidates)) {
    const candList = Array.isArray(payload.candidatos) ? payload.candidatos : payload.candidates;
    const candidates: WizardCandidateInput[] = [];
    const partiesMap = new Map<string, WizardPartyInput>();
    const officesMap = new Map<string, WizardOfficeInput>();
    const seenCandidateKeys = new Set<string>();

    let confirmedCount = 0;
    let warningCount = 0;

    for (const raw of candList) {
      if (!raw || typeof raw !== 'object') continue;

      const num = String(raw.nr || raw.numero || raw.candidateNumber || '').trim();
      const name = String(raw.nm || raw.nome || raw.name || '').trim();
      const ballotName = String(raw.nmu || raw.nomeUrna || raw.ballotName || name).trim();
      const offCode = String(raw.cdCargo || raw.cargo || raw.officeCode || '').trim();
      const offName = String(raw.dsCargo || raw.nomeCargo || raw.officeName || '').trim();
      const partyNum = String(raw.nrPartido || raw.partido || raw.partyNumber || '').trim();
      const partyAbbr = String(raw.sgPartido || raw.siglaPartido || raw.partyAbbreviation || '').trim().toUpperCase();
      const partyName = String(raw.nmPartido || raw.nomePartido || raw.partyName || '').trim();

      const missing: string[] = [];
      const suggestions: Record<string, string> = {};

      if (!num || !/^\d{1,5}$/.test(num)) missing.push('candidateNumber');
      if (!name || name.length > 150) missing.push('name');
      if (!offCode) missing.push('officeCode');
      if (!partyNum || !/^\d{1,3}$/.test(partyNum)) missing.push('partyNumber');
      if (!partyAbbr || partyAbbr.length > 15) missing.push('partyAbbreviation');

      // Detecção de duplicidade dentro do mesmo cargo
      const candidateKey = `${offCode}:${num}`;
      if (seenCandidateKeys.has(candidateKey)) {
        errors.push(`Candidato duplicado detectado: número ${num} para o cargo ${offCode}.`);
        continue;
      }
      seenCandidateKeys.add(candidateKey);

      const isRecordConfirmed = missing.length === 0;
      if (isRecordConfirmed) {
        confirmedCount++;
      } else {
        warningCount++;
        warnings.push(`Candidato '${name || num}' possui campos obrigatórios ausentes: ${missing.join(', ')}.`);
      }

      if (offCode && !officesMap.has(offCode)) {
        officesMap.set(offCode, {
          code: offCode,
          name: offName || `Cargo ${offCode}`,
          type: 'MAJORITARIO'
        });
      }

      if (partyNum && partyAbbr && !partiesMap.has(partyNum)) {
        partiesMap.set(partyNum, {
          officialIdentifier: partyNum,
          name: partyName || `Partido ${partyAbbr}`,
          abbreviation: partyAbbr
        });
      }

      if (isRecordConfirmed) {
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

      validationDetails.push({
        officeCode: offCode,
        candidateNumber: num,
        name,
        ballotName,
        partyNumber: partyNum,
        partyName,
        partyAbbreviation: partyAbbr,
        isConfirmed: isRecordConfirmed,
        missingFields: missing,
        suggestions
      });
    }

    const isValid = errors.length === 0 && candidates.length > 0;

    return {
      valid: isValid,
      format: 'TSE_CANDIDATES',
      summary: {
        roundsCount: 0,
        officesCount: officesMap.size,
        candidatesCount: candidates.length,
        partiesCount: partiesMap.size,
        sectionsCount: 0,
        confirmedRecordsCount: confirmedCount,
        recordsWithWarningsCount: warningCount
      },
      data: {
        offices: Array.from(officesMap.values()),
        parties: Array.from(partiesMap.values()),
        candidates
      },
      validationDetails: validationDetails.slice(0, 50),
      errors: errors.length > 0 ? errors : (candidates.length === 0 ? ['Nenhum candidato completamente confirmado foi encontrado no arquivo.'] : undefined),
      warnings: warnings.slice(0, 10)
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
        sectionsCount: coverage.length,
        confirmedRecordsCount: candidates.length + offices.length,
        recordsWithWarningsCount: 0
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
    summary: {
      roundsCount: 0,
      officesCount: 0,
      candidatesCount: 0,
      partiesCount: 0,
      sectionsCount: 0,
      confirmedRecordsCount: 0,
      recordsWithWarningsCount: 0
    },
    data: {},
    errors: ['Formato de arquivo não reconhecido. Forneça uma estrutura JSON oficial do TSE ou exportação compatível do Wizard.']
  };
}
