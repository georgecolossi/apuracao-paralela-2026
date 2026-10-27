/**
 * Validação de Invariantes Contextuais Multi-Eleição e Regras de Negócio (PR 1)
 */

export interface BallotIngestionContext {
  electionId: string;
  roundId: string;
  votes: Array<{
    officeId: string;
    officeCode?: string;
    candidateId?: string | null;
    candidateNumber?: string | null;
    partyId?: string | null;
    partyNumber?: string | null;
    voteType: string;
    quantity: number;
  }>;
}

export class ElectionInvariantError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(`[${code}] ${message}`);
    this.name = 'ElectionInvariantError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Valida a integridade transacional de um Boletim de Urna e seus votos:
 * 1. O turno deve pertencer à mesma eleição informada no relatório.
 * 2. Cada cargo (Office) votado deve pertencer à mesma eleição do boletim.
 * 3. Validação real de votos nominais por cargo, número e contexto de eleição.
 * 4. Rejeição de votos atribuídos a candidatos de outra eleição ou outro cargo.
 * 5. Tratamento de votos de legenda, brancos, nulos e candidatos pendentes de catálogo.
 */
export async function validateBallotIngestionInvariants(
  tx: any,
  context: BallotIngestionContext
): Promise<void> {
  const { electionId, roundId, votes } = context;

  // 1. Validação de Vínculo Round -> Election
  const round = await tx.electionRound.findUnique({
    where: { id: roundId },
    select: { id: true, electionId: true, roundNumber: true }
  });

  if (!round) {
    throw new ElectionInvariantError('ROUND_NOT_FOUND', 'O turno eleitoral informado não existe.');
  }

  if (round.electionId !== electionId) {
    throw new ElectionInvariantError(
      'ROUND_ELECTION_MISMATCH',
      `Invariante violada: O turno ${round.roundNumber} pertence à eleição ${round.electionId}, mas o relatório foi submetido para a eleição ${electionId}.`,
      { expectedElectionId: round.electionId, receivedElectionId: electionId }
    );
  }

  // 2. Validação de Vínculo Office -> Election e validação real de cada voto
  for (const vote of votes) {
    const office = await tx.office.findUnique({
      where: { id: vote.officeId },
      select: { id: true, electionId: true, code: true, name: true }
    });

    if (!office) {
      throw new ElectionInvariantError('OFFICE_NOT_FOUND', `Cargo eleitoral (${vote.officeId}) não encontrado.`);
    }

    if (office.electionId !== electionId) {
      throw new ElectionInvariantError(
        'OFFICE_ELECTION_MISMATCH',
        `Invariante violada: O cargo '${office.name}' (${office.code}) pertence à eleição ${office.electionId}, não podendo receber votos da eleição ${electionId}.`,
        { officeId: office.id, officeElectionId: office.electionId, reportElectionId: electionId }
      );
    }

    const normType = vote.voteType.trim().toUpperCase();

    // 3. Votos Técnicos (BRANCO / NULO)
    if (normType === 'BRANCO' || normType === 'NULO') {
      if (vote.candidateId) {
        throw new ElectionInvariantError(
          'INVALID_CANDIDATE_FOR_TECHNICAL_VOTE',
          `Votos do tipo '${normType}' não podem possuir candidato associado (${vote.candidateId}).`,
          { voteType: normType, candidateId: vote.candidateId }
        );
      }
      if (vote.candidateNumber && vote.candidateNumber.trim() !== '') {
        throw new ElectionInvariantError(
          'TECHNICAL_VOTE_WITH_CANDIDATE_NUMBER',
          `Votos do tipo '${normType}' não podem conter número de candidato (${vote.candidateNumber}).`,
          { voteType: normType, candidateNumber: vote.candidateNumber }
        );
      }
    }

    // 4. Votos de Legenda (LEGENDA)
    if (normType === 'LEGENDA') {
      if (vote.candidateId) {
        throw new ElectionInvariantError(
          'INVALID_CANDIDATE_FOR_LEGENDA_VOTE',
          `Votos de legenda partidária não podem vincular candidato nominal (${vote.candidateId}).`,
          { candidateId: vote.candidateId }
        );
      }
      if (vote.partyId) {
        const party = await tx.party.findUnique({
          where: { id: vote.partyId },
          select: { id: true, officialIdentifier: true, abbreviation: true }
        });
        if (!party) {
          throw new ElectionInvariantError('PARTY_NOT_FOUND', `Partido (${vote.partyId}) não encontrado.`);
        }
        if (vote.partyNumber && party.officialIdentifier !== vote.partyNumber) {
          throw new ElectionInvariantError(
            'PARTY_NUMBER_MISMATCH',
            `Divergência partidária: número informado '${vote.partyNumber}' diverge do cadastro '${party.officialIdentifier}'.`
          );
        }
      }
    }

    // 5. Votos Nominais com CandidateId explicitamente associado
    if (vote.candidateId) {
      const candidate = await tx.candidate.findUnique({
        where: { id: vote.candidateId },
        include: { office: true }
      });

      if (!candidate) {
        throw new ElectionInvariantError('CANDIDATE_NOT_FOUND', `Candidato (${vote.candidateId}) não encontrado.`);
      }

      if (candidate.officeId !== vote.officeId) {
        throw new ElectionInvariantError(
          'CANDIDATE_OFFICE_MISMATCH',
          `Invariante violada: O candidato '${candidate.ballotName}' (${candidate.candidateNumber}) pertence ao cargo '${candidate.office.name}' (${candidate.officeId}), mas o voto foi vinculado ao cargo '${office.name}' (${vote.officeId}).`,
          { candidateId: candidate.id, candidateOfficeId: candidate.officeId, voteOfficeId: vote.officeId }
        );
      }

      if (candidate.office.electionId !== electionId) {
        throw new ElectionInvariantError(
          'CANDIDATE_ELECTION_MISMATCH',
          `Invariante violada: O candidato '${candidate.ballotName}' pertence à eleição ${candidate.office.electionId}, não podendo receber votos da eleição ${electionId}.`,
          { candidateId: candidate.id, candidateElectionId: candidate.office.electionId, reportElectionId: electionId }
        );
      }

      if (vote.candidateNumber && candidate.candidateNumber !== vote.candidateNumber) {
        throw new ElectionInvariantError(
          'CANDIDATE_NUMBER_MISMATCH',
          `Divergência de número: candidato cadastrado possui número '${candidate.candidateNumber}', mas o voto registra '${vote.candidateNumber}'.`
        );
      }
    }

    // 6. Votos Nominais sem CandidateId (Candidato ainda pendente de resolução no catálogo)
    // Se não há candidateId mas há candidateNumber:
    // Aceita o voto preservando o candidateNumber no relatório oficial, sem atribuir
    // a candidatos de outros cargos ou eleições por aproximação ou ambiguidade.
  }
}

/**
 * Validação de Não-Contradição e Não-Sobreposição de Escopos Geográficos (ElectionScope):
 * - Impede contradição macro entre NACIONAL e âmbitos regionais.
 * - Impede sobreposição entre abrangência ESTADUAL integral e municípios isolados do mesmo estado.
 * - Impede duplicidade de chave canônica de escopo.
 */
export function validateElectionScopeAddition(
  existingScopes: Array<{ scopeType: string; scopeKey: string }>,
  newScope: { scopeType: string; scopeKey: string; stateCode?: string; municipalityCode?: string }
): void {
  const normNewType = newScope.scopeType.trim().toUpperCase();
  const normNewKey = newScope.scopeKey.trim().toUpperCase();

  const hasNational = existingScopes.some(s => s.scopeType.trim().toUpperCase() === 'NACIONAL');

  // 1. Contradição Nacional
  if (hasNational && normNewType !== 'NACIONAL') {
    throw new ElectionInvariantError(
      'CONTRADICTORY_SCOPE_NATIONAL_EXISTS',
      `A eleição já possui abrangência NACIONAL ('${existingScopes.find(s => s.scopeType === 'NACIONAL')?.scopeKey}'). Não é permitido adicionar escopo regional (${normNewType}: ${normNewKey}) sem redefinir o escopo macro.`
    );
  }

  if (normNewType === 'NACIONAL' && existingScopes.length > 0 && !hasNational) {
    throw new ElectionInvariantError(
      'CONTRADICTORY_SCOPE_REGIONAL_EXISTS',
      `A eleição já possui escopos regionais configurados (${existingScopes.map(s => s.scopeKey).join(', ')}). A expansão para NACIONAL exige remoção prévia das sub-abrangências para evitar ambiguidade.`
    );
  }

  // 2. Duplicidade exata de chave
  const isDuplicate = existingScopes.some(s => s.scopeKey.trim().toUpperCase() === normNewKey);
  if (isDuplicate) {
    throw new ElectionInvariantError(
      'DUPLICATE_SCOPE_KEY',
      `O escopo com identificador canônico '${newScope.scopeKey}' já está cadastrado nesta eleição.`
    );
  }

  // Extrai UF de chaves canônicas (ex: UF:SC ou MUNI:SC:80837)
  const extractUf = (key: string): string | null => {
    const parts = key.split(':');
    if (parts.length >= 2 && (parts[0] === 'UF' || parts[0] === 'MUNI')) {
      return parts[1];
    }
    return null;
  };

  const newUf = newScope.stateCode ? newScope.stateCode.trim().toUpperCase() : extractUf(normNewKey);

  // 3. Sobreposição Estadual vs Municipal
  if (newUf) {
    // Se o novo escopo é MUNICIPAL, verificar se o estado já possui cobertura ESTADUAL integral
    if (normNewType === 'MUNICIPAL') {
      const stateScope = existingScopes.find(s => {
        const t = s.scopeType.trim().toUpperCase();
        const k = s.scopeKey.trim().toUpperCase();
        return t === 'ESTADUAL' && (extractUf(k) === newUf || k === `UF:${newUf}`);
      });
      if (stateScope) {
        throw new ElectionInvariantError(
          'OVERLAPPING_SCOPE_STATE_CONTAINS_MUNICIPALITY',
          `A eleição já possui abrangência ESTADUAL integral no estado '${newUf}' ('${stateScope.scopeKey}'). Municípios isolados deste estado já estão integralmente contidos nessa abrangência.`
        );
      }
    }

    // Se o novo escopo é ESTADUAL, verificar se já existem municípios isolados do mesmo estado
    if (normNewType === 'ESTADUAL') {
      const existingMunicipalities = existingScopes.filter(s => {
        const t = s.scopeType.trim().toUpperCase();
        const k = s.scopeKey.trim().toUpperCase();
        return t === 'MUNICIPAL' && (extractUf(k) === newUf || k.startsWith(`MUNI:${newUf}:`));
      });
      if (existingMunicipalities.length > 0) {
        throw new ElectionInvariantError(
          'OVERLAPPING_SCOPE_MUNICIPALITY_EXISTS',
          `A eleição já possui ${existingMunicipalities.length} município(s) isolado(s) no estado '${newUf}' (${existingMunicipalities.map(m => m.scopeKey).join(', ')}). A expansão para abrangência ESTADUAL integral exige a remoção ou conversão prévia dos escopos municipais existentes.`
        );
      }
    }
  }
}

/**
 * Validação de Transição de Estado de Cobertura (CoverageStatus):
 * PROVISIONAL -> REGISTERED -> HOMOLOGATED
 */
export function validateCoverageTransition(
  currentStatus: string,
  targetStatus: string,
  params: {
    sectionsCount?: number;
    homologatedBy?: string | null;
    homologationType?: string | null;
    evidenceNotes?: string | null;
    allowUnhomologation?: boolean;
  }
): void {
  const VALID_STATUSES = ['PROVISIONAL', 'REGISTERED', 'HOMOLOGATED'];
  const cur = currentStatus.trim().toUpperCase();
  const tgt = targetStatus.trim().toUpperCase();

  if (!VALID_STATUSES.includes(tgt)) {
    throw new ElectionInvariantError('INVALID_COVERAGE_STATUS', `Status de cobertura inválido: '${targetStatus}'.`);
  }

  if (cur === tgt) return;

  // Bloqueio de deshomologação sem autorização explícita
  if (cur === 'HOMOLOGATED' && !params.allowUnhomologation) {
    throw new ElectionInvariantError(
      'HOMOLOGATED_COVERAGE_LOCKED',
      'A cobertura deste turno já foi oficialmente homologada e está bloqueada contra alterações não autorizadas.'
    );
  }

  // Não permite saltar de PROVISIONAL diretamente para HOMOLOGATED
  if (cur === 'PROVISIONAL' && tgt === 'HOMOLOGATED') {
    throw new ElectionInvariantError(
      'INVALID_TRANSITION_PROVISIONAL_TO_HOMOLOGATED',
      'Não é permitido homologar uma cobertura em estado PROVISIONAL sem que haja uma malha de seções previamente cadastrada (REGISTERED).'
    );
  }

  // Para transicionar para REGISTERED, exige seções vinculadas
  if (tgt === 'REGISTERED') {
    if (params.sectionsCount !== undefined && params.sectionsCount <= 0) {
      throw new ElectionInvariantError(
        'CANNOT_REGISTER_EMPTY_COVERAGE',
        'Não é possível marcar a cobertura como REGISTERED sem nenhuma seção eleitoral vinculada.'
      );
    }
  }

  // Para homologar (HOMOLOGATED), exige evidências formais completas e seções
  if (tgt === 'HOMOLOGATED') {
    if (params.sectionsCount !== undefined && params.sectionsCount <= 0) {
      throw new ElectionInvariantError(
        'CANNOT_HOMOLOGATE_EMPTY_COVERAGE',
        'Homologação rejeitada: Cobertura não possui nenhuma seção eleitoral cadastrada.'
      );
    }

    if (!params.homologatedBy || params.homologatedBy.trim() === '') {
      throw new ElectionInvariantError(
        'MISSING_HOMOLOGATION_USER',
        'Homologação oficial rejeitada: Identificador do responsável (homologatedBy) é obrigatório.'
      );
    }

    const VALID_TYPES = ['ADMIN_HOMOLOGATION', 'TSE_OFFICIAL_CONFIRMATION'];
    if (!params.homologationType || !VALID_TYPES.includes(params.homologationType.trim())) {
      throw new ElectionInvariantError(
        'INVALID_HOMOLOGATION_TYPE',
        `Tipo de homologação inválido. Deve ser 'ADMIN_HOMOLOGATION' ou 'TSE_OFFICIAL_CONFIRMATION'.`
      );
    }

    if (!params.evidenceNotes || params.evidenceNotes.trim().length < 10) {
      throw new ElectionInvariantError(
        'INSUFFICIENT_HOMOLOGATION_EVIDENCE',
        'Homologação oficial rejeitada: Notas de evidência ou checksum oficial com no mínimo 10 caracteres são obrigatórios.'
      );
    }
  }
}

/**
 * Operação Transacional: Adiciona um novo escopo eleitoral validando integridade em transação atômica.
 */
export async function addElectionScopeTransaction(
  tx: any,
  electionId: string,
  scopeData: {
    scopeType: string;
    scopeKey: string;
    stateId?: string;
    municipalityId?: string;
    stateCode?: string;
    isCoverageArea?: boolean;
    userId?: string;
  }
) {
  const existingScopes = await tx.electionScope.findMany({
    where: { electionId },
    select: { scopeType: true, scopeKey: true }
  });

  validateElectionScopeAddition(existingScopes, {
    scopeType: scopeData.scopeType,
    scopeKey: scopeData.scopeKey,
    stateCode: scopeData.stateCode
  });

  const createdScope = await tx.electionScope.create({
    data: {
      electionId,
      scopeType: scopeData.scopeType,
      scopeKey: scopeData.scopeKey,
      stateId: scopeData.stateId || null,
      municipalityId: scopeData.municipalityId || null,
      isCoverageArea: scopeData.isCoverageArea ?? true
    }
  });

  if (scopeData.userId) {
    await tx.auditLog.create({
      data: {
        userId: scopeData.userId,
        electionId,
        action: 'ADD_ELECTION_SCOPE',
        identifiers: `Scope: ${scopeData.scopeType}:${scopeData.scopeKey}`,
        result: 'SUCCESS',
        newStatus: 'ACTIVE',
        metadata: JSON.stringify(scopeData)
      }
    });
  }

  return createdScope;
}

/**
 * Operação Transacional: Aplica transição de status de cobertura validando evidências em transação atômica.
 */
export async function applyCoverageTransitionTransaction(
  tx: any,
  roundId: string,
  targetStatus: string,
  metadata: {
    sectionsCount?: number;
    homologatedBy?: string;
    homologationType?: string;
    evidenceNotes?: string;
    allowUnhomologation?: boolean;
    userId?: string;
  }
) {
  const round = await tx.electionRound.findUnique({
    where: { id: roundId },
    select: {
      id: true,
      electionId: true,
      roundNumber: true,
      coverageStatus: true,
      coverageOrigin: true,
      coverageHomologatedAt: true,
      coverageHomologatedBy: true,
      coverageHomologationType: true,
      coverageEvidenceNotes: true
    }
  });

  if (!round) {
    throw new ElectionInvariantError('ROUND_NOT_FOUND', `Turno (${roundId}) não encontrado.`);
  }

  validateCoverageTransition(round.coverageStatus, targetStatus, metadata);

  const updatedRound = await tx.electionRound.update({
    where: { id: roundId },
    data: {
      coverageStatus: targetStatus,
      coverageHomologatedAt: targetStatus === 'HOMOLOGATED' ? new Date() : (targetStatus === 'REGISTERED' ? null : round.coverageHomologatedAt),
      coverageHomologatedBy: targetStatus === 'HOMOLOGATED' ? metadata.homologatedBy : (targetStatus === 'REGISTERED' ? null : round.coverageHomologatedBy),
      coverageHomologationType: targetStatus === 'HOMOLOGATED' ? metadata.homologationType : (targetStatus === 'REGISTERED' ? null : round.coverageHomologationType),
      coverageEvidenceNotes: metadata.evidenceNotes || round.coverageEvidenceNotes
    }
  });

  if (metadata.userId) {
    await tx.auditLog.create({
      data: {
        userId: metadata.userId,
        electionId: round.electionId,
        roundId: round.id,
        action: 'UPDATE_COVERAGE_STATUS',
        identifiers: `Round ${round.roundNumber} Coverage -> ${targetStatus}`,
        result: 'SUCCESS',
        previousStatus: round.coverageStatus,
        newStatus: targetStatus,
        metadata: JSON.stringify(metadata)
      }
    });
  }

  return updatedRound;
}

/**
 * Gera a chave canônica determinística para configuração do TSE (TseSyncConfig)
 */
export function buildTseSyncConfigKey(params: {
  roundNumber: number;
  officeCode?: string | null;
  scopeType: string;
  uf?: string | null;
  muniTseCode?: string | null;
}): string {
  const r = params.roundNumber;
  const off = params.officeCode ? params.officeCode.trim() : 'ALL';
  const scope = params.scopeType.trim().toUpperCase();
  const uf = params.uf ? params.uf.trim().toUpperCase() : 'BR';
  const mun = params.muniTseCode ? params.muniTseCode.trim() : 'GLOBAL';

  return `R${r}:OFFICE-${off}:${scope}:${uf}:${mun}`;
}
