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
    partyNumber?: string | null;
    voteType: string;
    quantity: number;
  }>;
}

export class ElectionInvariantError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'ElectionInvariantError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Valida a integridade transacional de um Boletim de Urna e seus votos:
 * 1. O turno deve pertencer à mesma eleição informada no relatório.
 * 2. Cada cargo (Office) votado deve pertencer à mesma eleição do boletim.
 * 3. Se candidateId for informado, o candidato deve pertencer ao respectivo cargo.
 * 4. Não permite mistura de votos de eleições diferentes em uma mesma transação.
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

  // 2. Validação de Vínculo Office -> Election para cada voto
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

    // 3. Validação de Vínculo Candidate -> Office
    if (vote.candidateId) {
      const candidate = await tx.candidate.findUnique({
        where: { id: vote.candidateId },
        select: { id: true, officeId: true, candidateNumber: true, ballotName: true }
      });

      if (!candidate) {
        throw new ElectionInvariantError('CANDIDATE_NOT_FOUND', `Candidato (${vote.candidateId}) não encontrado.`);
      }

      if (candidate.officeId !== vote.officeId) {
        throw new ElectionInvariantError(
          'CANDIDATE_OFFICE_MISMATCH',
          `Invariante violada: O candidato '${candidate.ballotName}' (${candidate.candidateNumber}) pertence ao cargo ${candidate.officeId}, mas o voto foi vinculado ao cargo ${vote.officeId}.`,
          { candidateId: candidate.id, candidateOfficeId: candidate.officeId, voteOfficeId: vote.officeId }
        );
      }
    }
  }
}

/**
 * Validação de Não-Contradição de Escopos Geográficos (ElectionScope):
 * Impede que uma eleição com escopo 'NACIONAL' receba escopos sobrepostos ou contraditórios,
 * ou que escopos estaduais/municipais colidam de forma ambígua.
 */
export function validateElectionScopeAddition(
  existingScopes: Array<{ scopeType: string; scopeKey: string }>,
  newScope: { scopeType: string; scopeKey: string }
): void {
  const hasNational = existingScopes.some(s => s.scopeType === 'NACIONAL');

  if (hasNational && newScope.scopeType !== 'NACIONAL') {
    throw new ElectionInvariantError(
      'CONTRADICTORY_SCOPE_NATIONAL_EXISTS',
      `A eleição já possui abrangência NACIONAL ('${existingScopes.find(s => s.scopeType === 'NACIONAL')?.scopeKey}'). Não é permitido adicionar escopo regional (${newScope.scopeType}: ${newScope.scopeKey}) sem redefinir o escopo macro.`
    );
  }

  if (newScope.scopeType === 'NACIONAL' && existingScopes.length > 0 && !hasNational) {
    throw new ElectionInvariantError(
      'CONTRADICTORY_SCOPE_REGIONAL_EXISTS',
      `A eleição já possui escopos regionais configurados (${existingScopes.map(s => s.scopeKey).join(', ')}). A expansão para NACIONAL exige remoção prévia das sub-abrangências para evitar ambiguidade.`
    );
  }

  const isDuplicate = existingScopes.some(s => s.scopeKey === newScope.scopeKey);
  if (isDuplicate) {
    throw new ElectionInvariantError(
      'DUPLICATE_SCOPE_KEY',
      `O escopo com identificador canônico '${newScope.scopeKey}' já está cadastrado nesta eleição.`
    );
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
  }
): void {
  const VALID_STATUSES = ['PROVISIONAL', 'REGISTERED', 'HOMOLOGATED'];
  if (!VALID_STATUSES.includes(targetStatus)) {
    throw new ElectionInvariantError('INVALID_COVERAGE_STATUS', `Status de cobertura inválido: '${targetStatus}'.`);
  }

  if (currentStatus === targetStatus) return;

  // Não permite saltar de PROVISIONAL diretamente para HOMOLOGATED
  if (currentStatus === 'PROVISIONAL' && targetStatus === 'HOMOLOGATED') {
    throw new ElectionInvariantError(
      'INVALID_TRANSITION_PROVISIONAL_TO_HOMOLOGATED',
      'Não é permitido homologar uma cobertura em estado PROVISIONAL sem que haja uma malha de seções previamente cadastrada (REGISTERED).'
    );
  }

  // Para transicionar para REGISTERED, exige seções vinculadas
  if (targetStatus === 'REGISTERED') {
    if (params.sectionsCount !== undefined && params.sectionsCount <= 0) {
      throw new ElectionInvariantError(
        'CANNOT_REGISTER_EMPTY_COVERAGE',
        'Não é possível marcar a cobertura como REGISTERED sem nenhuma seção eleitoral vinculada.'
      );
    }
  }

  // Para homologar (HOMOLOGATED), exige evidências formais completas
  if (targetStatus === 'HOMOLOGATED') {
    if (!params.homologatedBy || params.homologatedBy.trim() === '') {
      throw new ElectionInvariantError(
        'MISSING_HOMOLOGATION_USER',
        'Homologação oficial rejeitada: Identificador do responsável (homologatedBy) é obrigatório.'
      );
    }

    const VALID_TYPES = ['ADMIN_HOMOLOGATION', 'TSE_OFFICIAL_CONFIRMATION'];
    if (!params.homologationType || !VALID_TYPES.includes(params.homologationType)) {
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
