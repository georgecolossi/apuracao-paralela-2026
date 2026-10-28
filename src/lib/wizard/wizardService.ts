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
      // Se a eleição estiver FINISHED ou ARCHIVED, também bloquear modificações estruturais
      if (existing.status === 'FINISHED' || existing.status === 'ARCHIVED') {
        const structuralChangeAttempted =
          payload.scopes !== undefined ||
          payload.offices !== undefined ||
          payload.candidates !== undefined ||
          payload.rounds !== undefined ||
          payload.coverage !== undefined;

        if (structuralChangeAttempted) {
          throw new WizardValidationError(
            'CANNOT_MODIFY_CLOSED_ELECTION',
            `A eleição está no status '${existing.status}' e não permite modificações estruturais (escopos, turnos, cargos, candidatos ou cobertura). Apenas edições administrativas de identificação/descrição são permitidas.`
          );
        }
      }

      const hasBoundReports = existing.reports.length > 0;
      if (hasBoundReports) {
        // Verificar se alteração estrutural incompatível com BUs foi enviada:
        const structuralChangeAttempted =
          payload.scopes !== undefined ||
          payload.offices !== undefined ||
          payload.candidates !== undefined ||
          payload.rounds !== undefined;

        if (structuralChangeAttempted) {
          throw new WizardValidationError(
            'ELECTION_HAS_BOUND_REPORTS',
            `A eleição possui ${existing.reports.length} Boletim(ns) de Urna vinculado(s) (processados ou pendentes). Alterações estruturais (escopos, turnos, cargos ou candidatos) estão bloqueadas para preservar a integridade do pleito.`
          );
        }
      }

      // ITEM 1 DA AUDITORIA: Preservar estritamente o status de eleições existentes (ACTIVE, FINISHED, ARCHIVED, DRAFT)
      await tx.election.update({
        where: { id: electionId },
        data: {
          name: payload.name.trim(),
          year,
          type: payload.type,
          description: payload.description !== undefined ? (payload.description ? payload.description.trim() : null) : undefined,
          plei: payload.plei !== undefined ? (payload.plei ? payload.plei.trim() : null) : undefined,
          status: existing.status // Preserva rigorosamente o estado existente sem reverter para DRAFT
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
    // ITEM 3 DA AUDITORIA: Algoritmo de diff transacional exato por turno
    if (payload.coverage !== undefined) {
      // 8.1 Verificar se algum turno da eleição já possui cobertura homologada
      for (const [, roundId] of roundMap) {
        const roundRec = await tx.electionRound.findUnique({
          where: { id: roundId },
          select: { id: true, roundNumber: true, coverageStatus: true }
        });
        if (roundRec?.coverageStatus === 'HOMOLOGATED') {
          throw new WizardValidationError(
            'CANNOT_MODIFY_HOMOLOGATED_COVERAGE',
            `A cobertura do ${roundRec.roundNumber}º Turno está homologada e não pode ser modificada pelo assistente.`
          );
        }
      }

      // 8.2 Mapear seções desejadas por turno
      interface DesiredCoverageItem {
        pollingSectionId: string;
        expectedBUs: number;
        isAggregated: boolean;
        municipalityCode: string;
        zoneNumber: string;
        sectionNumber: string;
      }
      const desiredByRound = new Map<number, Map<string, DesiredCoverageItem>>();

      for (const cov of payload.coverage) {
        const muniCode = cov.municipalityOfficialCode.trim();
        const muni = await tx.municipality.findUnique({
          where: { officialCode: muniCode }
        });

        if (!muni) {
          throw new WizardValidationError('MUNICIPALITY_NOT_FOUND', `Município com código oficial '${muniCode}' não foi localizado.`);
        }

        const zoneNum = cov.zoneNumber.trim();
        let zone = await tx.pollingZone.findUnique({
          where: {
            municipalityId_zoneNumber: {
              municipalityId: muni.id,
              zoneNumber: zoneNum
            }
          }
        });
        if (!zone) {
          zone = await tx.pollingZone.create({
            data: {
              municipalityId: muni.id,
              zoneNumber: zoneNum
            }
          });
        }

        const secNum = cov.sectionNumber.trim();
        const targetExpectedBUs = cov.isAggregated ? 0 : (cov.expectedBUs !== undefined ? Number(cov.expectedBUs) : 1);

        // Obter ou criar PollingSection preservando atributos compartilhados sem sobrescrita destrutiva
        let section = await tx.pollingSection.findUnique({
          where: {
            pollingZoneId_sectionNumber: {
              pollingZoneId: zone.id,
              sectionNumber: secNum
            }
          }
        });

        if (!section) {
          section = await tx.pollingSection.create({
            data: {
              pollingZoneId: zone.id,
              sectionNumber: secNum,
              expectedBUs: targetExpectedBUs,
              isAggregated: Boolean(cov.isAggregated),
              aggregatedIntoSec: cov.aggregatedIntoSec ? cov.aggregatedIntoSec.trim() : null,
              locationName: cov.locationName ? cov.locationName.trim() : null
            }
          });
        } else if (cov.locationName && !section.locationName) {
          await tx.pollingSection.update({
            where: { id: section.id },
            data: { locationName: cov.locationName.trim() }
          });
        }

        // Determinar a quais turnos esta seção pertence
        const targetRounds = cov.roundNumber !== undefined
          ? [Number(cov.roundNumber)]
          : Array.from(roundMap.keys());

        for (const rNum of targetRounds) {
          if (!roundMap.has(rNum)) continue;
          if (!desiredByRound.has(rNum)) {
            desiredByRound.set(rNum, new Map());
          }
          desiredByRound.get(rNum)!.set(section.id, {
            pollingSectionId: section.id,
            expectedBUs: targetExpectedBUs,
            isAggregated: Boolean(cov.isAggregated),
            municipalityCode: muniCode,
            zoneNumber: zoneNum,
            sectionNumber: secNum
          });
        }
      }

      // 8.3 Executar diff transacional por turno preservando turnos/eleições não selecionados
      for (const [rNum, roundId] of roundMap) {
        const desiredMap = desiredByRound.get(rNum) || new Map<string, DesiredCoverageItem>();

        const existingCoverages = await tx.roundCoverage.findMany({
          where: { electionRoundId: roundId },
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

        const existingMap = new Map<string, typeof existingCoverages[0]>();
        for (const ec of existingCoverages) {
          existingMap.set(ec.pollingSectionId, ec);
        }

        // 1) Identificar vínculos a remover
        const toRemove = existingCoverages.filter(ec => !desiredMap.has(ec.pollingSectionId));

        // 2) Identificar vínculos a inserir e atualizar
        const toInsert: DesiredCoverageItem[] = [];
        const toUpdate: { id: string; expectedBUs: number }[] = [];

        for (const [secId, desired] of desiredMap) {
          const existing = existingMap.get(secId);
          if (!existing) {
            toInsert.push(desired);
          } else if (existing.expectedBUs !== desired.expectedBUs) {
            toUpdate.push({ id: existing.id, expectedBUs: desired.expectedBUs });
          }
        }

        // 3) Bloquear remoção de seções que possuam BUs reais vinculados (erro específico por seção)
        for (const covToRemove of toRemove) {
          const sec = covToRemove.pollingSection;
          const boundBu = await tx.ballotReport.findFirst({
            where: {
              electionId: electionId!,
              roundId: roundId,
              cityCode: sec.zone.municipality.officialCode,
              zoneCode: sec.zone.zoneNumber,
              sectionCode: sec.sectionNumber,
              isSimulation: false
            }
          });

          if (boundBu) {
            throw new WizardValidationError(
              'CANNOT_REMOVE_SECTION_WITH_REAL_BUS',
              `Não é possível remover a seção ${sec.sectionNumber} (Zona ${sec.zone.zoneNumber}, Município ${sec.zone.municipality.officialCode}) do ${rNum}º Turno, pois ela possui Boletim de Urna real vinculado (status: ${boundBu.status}).`
            );
          }
        }

        // ITEM 1 DA AUDITORIA: Bloquear alterações de cobertura quando o turno possuir BUs reais vinculados
        // Permitir apenas reenvio idempotente idêntico (hasCoverageChanges = false)
        const realBUsCount = await tx.ballotReport.count({
          where: {
            electionId: electionId!,
            roundId,
            isSimulation: false
          }
        });

        const hasCoverageChanges = toRemove.length > 0 || toInsert.length > 0 || toUpdate.length > 0;

        if (realBUsCount > 0 && hasCoverageChanges) {
          throw new WizardValidationError(
            'CANNOT_MODIFY_COVERAGE_WITH_REAL_BUS',
            `O ${rNum}º Turno possui ${realBUsCount} Boletim(ns) de Urna real(is) vinculado(s). Alterações na malha de cobertura (adição, remoção ou alteração de urnas esperadas) estão bloqueadas no assistente para garantir a integridade da apuração.`
          );
        }

        // 4) Remover vínculos obsoletos
        if (toRemove.length > 0) {
          await tx.roundCoverage.deleteMany({
            where: { id: { in: toRemove.map(c => c.id) } }
          });
        }

        // 5) Atualizar expectedBUs dos mantidos
        for (const up of toUpdate) {
          await tx.roundCoverage.update({
            where: { id: up.id },
            data: { expectedBUs: up.expectedBUs }
          });
        }

        // 6) Inserir novos vínculos
        for (const ins of toInsert) {
          await tx.roundCoverage.create({
            data: {
              electionRoundId: roundId,
              pollingSectionId: ins.pollingSectionId,
              expectedBUs: ins.expectedBUs,
              isManualOverride: false
            }
          });
        }

        // 7) Atualizar coverageStatus com base no estado final real da malha
        const finalCoverageCount = await tx.roundCoverage.count({
          where: { electionRoundId: roundId }
        });

        const newCoverageStatus = finalCoverageCount > 0 ? 'REGISTERED' : 'PROVISIONAL';
        await tx.electionRound.update({
          where: { id: roundId },
          data: { coverageStatus: newCoverageStatus }
        });
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

    // ITEM 2 DA AUDITORIA: Eleições FINISHED não podem ser reativadas implicitamente
    if (target.status === 'FINISHED') {
      throw new WizardValidationError(
        'CANNOT_ACTIVATE_FINISHED_ELECTION',
        'Eleições já finalizadas não podem ser reativadas.'
      );
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

    // ITEM 2 DA AUDITORIA: Se a eleição alvo já estiver ACTIVE com um turno ACTIVE, repetir a ativação é idempotente
    const alreadyActiveRoundInTarget = target.rounds.find(r => r.status === 'ACTIVE');
    if (target.status === 'ACTIVE' && alreadyActiveRoundInTarget) {
      return {
        success: true,
        electionId,
        roundId: alreadyActiveRoundInTarget.id,
        alreadyActive: true,
        message: `A eleição '${target.name}' e o ${alreadyActiveRoundInTarget.roundNumber}º Turno já estão ativos. Nenhuma alteração efetuada.`
      };
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

      // ITEM 2 DA AUDITORIA: Se expressamente autorizado, arquiva contextualmente a eleição anterior
      // Nenhuma eleição ARCHIVED permanece com turno operacional ACTIVE
      // Turnos ACTIVE passam para PLANNED, preservando votos, BUs e status FINISHED dos turnos já concluídos
      for (const act of otherActive) {
        const activeRoundsOfAct = await tx.electionRound.findMany({
          where: { electionId: act.id, status: 'ACTIVE' }
        });

        await tx.election.update({
          where: { id: act.id },
          data: { status: 'ARCHIVED' }
        });

        await tx.electionRound.updateMany({
          where: {
            electionId: act.id,
            status: 'ACTIVE'
          },
          data: { status: 'PLANNED' }
        });

        for (const actRound of activeRoundsOfAct) {
          await tx.auditLog.create({
            data: {
              userId,
              electionId: act.id,
              roundId: actRound.id,
              action: 'ELECTION_CONTEXT_SWITCH_ARCHIVED',
              identifiers: `Archived contextually in favor of activating ${electionId}. Paused Round ${actRound.roundNumber} to PLANNED.`,
              result: 'SUCCESS',
              previousStatus: 'ACTIVE',
              newStatus: 'ARCHIVED',
              metadata: JSON.stringify({ pausedRoundNumber: actRound.roundNumber, pausedRoundId: actRound.id })
            }
          });
        }
      }
    }

    // 4. Identificar e Ativar inequivocamente o Turno Adequado da Eleição
    let roundToActivate: typeof target.rounds[0] | undefined;

    if (target.status === 'ARCHIVED') {
      // Retomada de eleição arquivada:
      // Identificar inequivocamente o turno anteriormente pausado através do log de auditoria
      const lastPausedLog = await tx.auditLog.findFirst({
        where: {
          electionId: target.id,
          action: 'ELECTION_CONTEXT_SWITCH_ARCHIVED',
          roundId: { not: null }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (lastPausedLog?.roundId) {
        roundToActivate = target.rounds.find(
          r => r.id === lastPausedLog.roundId && r.status !== 'FINISHED'
        );
      }

      // Fallback para turno não finalizado se não houver log
      if (!roundToActivate) {
        const nonFinishedRounds = target.rounds.filter(r => r.status !== 'FINISHED');
        roundToActivate = nonFinishedRounds.find(r => r.status === 'PLANNED') || nonFinishedRounds[0];
      }
    } else {
      // Eleição nova (DRAFT): deve iniciar obrigatoriamente pelo 1º Turno (roundNumber 1)
      // NUNCA ativar automaticamente o 2º turno!
      const round1 = target.rounds.find(r => r.roundNumber === 1);
      if (round1 && round1.status === 'PLANNED') {
        roundToActivate = round1;
      } else {
        roundToActivate = target.rounds.find(r => r.status === 'PLANNED');
      }
    }

    if (!roundToActivate || roundToActivate.status === 'FINISHED') {
      throw new WizardValidationError(
        'ALL_ROUNDS_FINISHED',
        'Todos os turnos desta eleição já foram finalizados ou não há turno válido disponível para ativação.'
      );
    }

    // Garantir unicidade: nenhum outro turno desta eleição pode estar ACTIVE
    await tx.electionRound.updateMany({
      where: {
        electionId,
        id: { not: roundToActivate.id },
        status: 'ACTIVE'
      },
      data: { status: 'PLANNED' }
    });

    await tx.election.update({
      where: { id: electionId },
      data: { status: 'ACTIVE' }
    });

    await tx.electionRound.update({
      where: { id: roundToActivate.id },
      data: { status: 'ACTIVE' }
    });

    // 5. Registrar Log de Auditoria
    await tx.auditLog.create({
      data: {
        userId,
        electionId,
        roundId: roundToActivate.id,
        action: 'ACTIVATE_ELECTION',
        identifiers: `Activated Election: ${target.name} (${target.year}) - Round ${roundToActivate.roundNumber} ACTIVE`,
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
      roundId: roundToActivate.id,
      message: `Eleição '${target.name}' e ${roundToActivate.roundNumber}º Turno ativados com sucesso.`
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
