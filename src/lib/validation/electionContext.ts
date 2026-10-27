/**
 * Validação de Invariantes Contextuais Multi-Eleição e Regras de Negócio (PR 1)
 */

export const VALID_BRAZILIAN_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
]);

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
 * Retorna uma mensagem de erro segura, padronizada e amigável ao operador,
 * sem vazar UUIDs ou estruturas de banco de dados no retorno HTTP.
 */
export function getSafeOperatorErrorMessage(code: string): string {
  switch (code) {
    case 'ROUND_ELECTION_MISMATCH':
      return 'O Boletim de Urna lido não corresponde à eleição ativa no sistema.';
    case 'OFFICE_ELECTION_MISMATCH':
      return 'O cargo eleitoral votado não pertence à eleição selecionada.';
    case 'CANDIDATE_OFFICE_MISMATCH':
      return 'Incompatibilidade: o candidato não concorre ao cargo informado no voto.';
    case 'CANDIDATE_ELECTION_MISMATCH':
      return 'Incompatibilidade: o candidato votado pertence a outra eleição.';
    case 'CANDIDATE_NUMBER_MISMATCH':
      return 'Divergência detectada no número do candidato votado.';
    case 'INVALID_CANDIDATE_FOR_TECHNICAL_VOTE':
      return 'Voto técnico (branco ou nulo) contém candidato associado indevidamente.';
    case 'TECHNICAL_VOTE_WITH_CANDIDATE_NUMBER':
      return 'Voto técnico (branco ou nulo) contém número de candidato indevido.';
    case 'INVALID_CANDIDATE_FOR_LEGENDA_VOTE':
      return 'Voto de legenda partidária contém candidato nominal associado indevidamente.';
    case 'PARTY_NUMBER_MISMATCH':
      return 'Divergência detectada na numeração da legenda partidária.';
    case 'ROUND_NOT_FOUND':
      return 'Turno eleitoral não encontrado.';
    case 'OFFICE_NOT_FOUND':
      return 'Cargo eleitoral não encontrado na eleição ativa.';
    case 'CANDIDATE_NOT_FOUND':
      return 'Candidato informado não foi localizado.';
    case 'PARTY_NOT_FOUND':
      return 'Legenda partidária informada não foi localizada.';
    default:
      return 'Inconsistência de validação eleitoral ao processar o Boletim de Urna.';
  }
}

/**
 * Constrói a chave canônica padronizada única para ElectionScope:
 * - Nacional: "NACIONAL:BR"
 * - Estadual: "ESTADUAL:<UF>" (ex: "ESTADUAL:SC")
 * - Municipal: "MUNICIPAL:<UF>:<CODIGO_TSE>" (ex: "MUNICIPAL:SC:80837")
 */
export function buildCanonicalScopeKey(scope: {
  scopeType: string;
  stateCode?: string | null;
  muniCode?: string | null;
}): string {
  const normType = scope.scopeType.trim().toUpperCase();
  if (normType === 'NACIONAL') {
    return 'NACIONAL:BR';
  }
  if (normType === 'ESTADUAL') {
    const uf = (scope.stateCode || '').trim().toUpperCase();
    if (!VALID_BRAZILIAN_UFS.has(uf)) {
      throw new ElectionInvariantError('INVALID_UF_CODE', `UF '${uf}' inválida para escopo estadual.`);
    }
    return `ESTADUAL:${uf}`;
  }
  if (normType === 'MUNICIPAL') {
    const uf = (scope.stateCode || '').trim().toUpperCase();
    if (!VALID_BRAZILIAN_UFS.has(uf)) {
      throw new ElectionInvariantError('INVALID_UF_CODE', `UF '${uf}' inválida para escopo municipal.`);
    }
    const muni = (scope.muniCode || '').trim();
    if (!muni || !/^\d+$/.test(muni)) {
      throw new ElectionInvariantError('INVALID_MUNICIPALITY_CODE', `Código TSE municipal '${muni}' inválido. Deve ser numérico.`);
    }
    return `MUNICIPAL:${uf}:${muni}`;
  }
  throw new ElectionInvariantError('INVALID_SCOPE_TYPE', `Tipo de escopo '${scope.scopeType}' inválido.`);
}

/**
 * Normaliza qualquer chave (inclusive legadas como "BR", "UF:SC", "MUNI:SC:80837", "MUN:SC:80837")
 * para a forma canônica única padrão:
 * - "NACIONAL:BR"
 * - "ESTADUAL:<UF>"
 * - "MUNICIPAL:<UF>:<CODIGO_TSE>"
 */
export function canonicalizeScopeKey(rawKey: string, fallbackType?: string): string {
  if (!rawKey || typeof rawKey !== 'string') {
    throw new ElectionInvariantError('INVALID_SCOPE_KEY', 'Chave de escopo não pode ser vazia.');
  }
  const clean = rawKey.trim().toUpperCase();
  if (clean === 'BR' || clean === 'NACIONAL' || clean === 'NACIONAL:BR') {
    return 'NACIONAL:BR';
  }

  const parts = clean.split(':');
  if (parts.length === 2 && (parts[0] === 'ESTADUAL' || parts[0] === 'UF')) {
    const uf = parts[1];
    if (!VALID_BRAZILIAN_UFS.has(uf)) {
      throw new ElectionInvariantError('INVALID_UF_CODE', `UF '${uf}' inválida na chave de escopo.`);
    }
    return `ESTADUAL:${uf}`;
  }

  if (parts.length === 3 && (parts[0] === 'MUNICIPAL' || parts[0] === 'MUNI' || parts[0] === 'MUN')) {
    const uf = parts[1];
    const muni = parts[2];
    if (!VALID_BRAZILIAN_UFS.has(uf)) {
      throw new ElectionInvariantError('INVALID_UF_CODE', `UF '${uf}' inválida na chave de escopo municipal.`);
    }
    if (!muni || !/^\d+$/.test(muni)) {
      throw new ElectionInvariantError('INVALID_MUNICIPALITY_CODE', `Código municipal '${muni}' inválido.`);
    }
    return `MUNICIPAL:${uf}:${muni}`;
  }

  if (fallbackType) {
    const normFallback = fallbackType.trim().toUpperCase();
    if (normFallback === 'NACIONAL') return 'NACIONAL:BR';
    if (normFallback === 'ESTADUAL' && VALID_BRAZILIAN_UFS.has(clean)) return `ESTADUAL:${clean}`;
  }

  throw new ElectionInvariantError(
    'MALFORMED_SCOPE_KEY',
    `Chave de escopo '${rawKey}' não atende ao padrão canônico ('NACIONAL:BR', 'ESTADUAL:<UF>', 'MUNICIPAL:<UF>:<CODIGO>').`
  );
}

/**
 * Decompõe uma chave canônica em seus componentes estruturados
 */
export function parseCanonicalScopeKey(canonicalKey: string): {
  scopeType: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL';
  stateCode?: string;
  muniCode?: string;
} {
  const norm = canonicalizeScopeKey(canonicalKey);
  const parts = norm.split(':');
  if (parts[0] === 'NACIONAL') {
    return { scopeType: 'NACIONAL' };
  }
  if (parts[0] === 'ESTADUAL') {
    return { scopeType: 'ESTADUAL', stateCode: parts[1] };
  }
  return { scopeType: 'MUNICIPAL', stateCode: parts[1], muniCode: parts[2] };
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
 * - Permite múltiplos municípios do mesmo estado ou de estados distintos.
 */
export function validateElectionScopeAddition(
  existingScopes: Array<{ scopeType: string; scopeKey: string }>,
  newScope: {
    scopeType: string;
    scopeKey?: string;
    stateCode?: string | null;
    muniCode?: string | null;
  }
): { canonicalKey: string; scopeType: string; stateCode?: string; muniCode?: string } {
  let canonicalKey: string;
  if (newScope.scopeKey) {
    canonicalKey = canonicalizeScopeKey(newScope.scopeKey, newScope.scopeType);
  } else {
    canonicalKey = buildCanonicalScopeKey({
      scopeType: newScope.scopeType,
      stateCode: newScope.stateCode,
      muniCode: newScope.muniCode
    });
  }

  const parsed = parseCanonicalScopeKey(canonicalKey);
  const normNewType = parsed.scopeType;

  // Normaliza as chaves existentes para a forma canônica
  const normalizedExisting = existingScopes.map(s => {
    try {
      const cKey = canonicalizeScopeKey(s.scopeKey, s.scopeType);
      const p = parseCanonicalScopeKey(cKey);
      return { scopeType: p.scopeType, canonicalKey: cKey, stateCode: p.stateCode, muniCode: p.muniCode };
    } catch {
      return { scopeType: s.scopeType.trim().toUpperCase(), canonicalKey: s.scopeKey.trim().toUpperCase(), stateCode: undefined, muniCode: undefined };
    }
  });

  const hasNational = normalizedExisting.some(s => s.scopeType === 'NACIONAL');

  // 1. Contradição Nacional
  if (hasNational && normNewType !== 'NACIONAL') {
    throw new ElectionInvariantError(
      'CONTRADICTORY_SCOPE_NATIONAL_EXISTS',
      `A eleição já possui abrangência NACIONAL ('${normalizedExisting.find(s => s.scopeType === 'NACIONAL')?.canonicalKey}'). Não é permitido adicionar escopo regional (${normNewType}: ${canonicalKey}) sem redefinir o escopo macro.`
    );
  }

  if (normNewType === 'NACIONAL' && normalizedExisting.length > 0 && !hasNational) {
    throw new ElectionInvariantError(
      'CONTRADICTORY_SCOPE_REGIONAL_EXISTS',
      `A eleição já possui escopos regionais configurados (${normalizedExisting.map(s => s.canonicalKey).join(', ')}). A expansão para NACIONAL exige remoção prévia das sub-abrangências para evitar ambiguidade.`
    );
  }

  // 2. Duplicidade exata de chave
  const isDuplicate = normalizedExisting.some(s => s.canonicalKey === canonicalKey);
  if (isDuplicate) {
    throw new ElectionInvariantError(
      'DUPLICATE_SCOPE_KEY',
      `O escopo com identificador canônico '${canonicalKey}' já está cadastrado nesta eleição.`
    );
  }

  // 3. Sobreposição Proibida: Estadual vs Municipal no mesmo Estado
  const newUf = parsed.stateCode;
  if (newUf) {
    if (normNewType === 'MUNICIPAL') {
      const stateScope = normalizedExisting.find(s => s.scopeType === 'ESTADUAL' && s.stateCode === newUf);
      if (stateScope) {
        throw new ElectionInvariantError(
          'OVERLAPPING_SCOPE_STATE_CONTAINS_MUNICIPALITY',
          `A eleição já possui abrangência ESTADUAL integral no estado '${newUf}' ('${stateScope.canonicalKey}'). Municípios isolados deste estado já estão integralmente contidos nessa abrangência.`
        );
      }
    }

    if (normNewType === 'ESTADUAL') {
      const existingMunicipalities = normalizedExisting.filter(s => s.scopeType === 'MUNICIPAL' && s.stateCode === newUf);
      if (existingMunicipalities.length > 0) {
        throw new ElectionInvariantError(
          'OVERLAPPING_SCOPE_MUNICIPALITY_EXISTS',
          `A eleição já possui ${existingMunicipalities.length} município(s) isolado(s) no estado '${newUf}' (${existingMunicipalities.map(m => m.canonicalKey).join(', ')}). A expansão para abrangência ESTADUAL integral exige a remoção ou conversão prévia dos escopos municipais existentes.`
        );
      }
    }
  }

  return { canonicalKey, scopeType: normNewType, stateCode: parsed.stateCode, muniCode: parsed.muniCode };
}

/**
 * Validação Canônica de um Conjunto Completo de Escopos Geográficos (PR 1 / v2.0):
 * - Valida chaves canônicas e decomposição estrutural.
 * - Valida integridade de UF e código numérico do TSE.
 * - Impede chaves canônicas duplicadas no conjunto.
 * - Impede contradição entre abrangência NACIONAL e escopos regionais.
 * - Impede sobreposição entre abrangência ESTADUAL e escopo MUNICIPAL no mesmo estado.
 */
export function validateElectionScopesSet(
  scopes: Array<{ scopeType: string; scopeKey?: string; stateCode?: string; muniCode?: string }>
): Array<{ canonicalKey: string; scopeType: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL'; stateCode?: string; muniCode?: string }> {
  const normalized = scopes.map(s => {
    let canonicalKey: string;
    if (s.scopeKey) {
      canonicalKey = canonicalizeScopeKey(s.scopeKey, s.scopeType);
    } else {
      canonicalKey = buildCanonicalScopeKey({
        scopeType: s.scopeType,
        stateCode: s.stateCode,
        muniCode: s.muniCode
      });
    }
    const parsed = parseCanonicalScopeKey(canonicalKey);
    return {
      canonicalKey,
      scopeType: parsed.scopeType,
      stateCode: parsed.stateCode,
      muniCode: parsed.muniCode
    };
  });

  // 1. Duplicidade exata de chaves
  const seenKeys = new Set<string>();
  for (const s of normalized) {
    if (seenKeys.has(s.canonicalKey)) {
      throw new ElectionInvariantError(
        'DUPLICATE_SCOPE_KEY',
        `Chave de escopo canônica duplicada no conjunto: '${s.canonicalKey}'.`
      );
    }
    seenKeys.add(s.canonicalKey);
  }

  // 2. Contradição Nacional vs Regional
  const hasNational = normalized.some(s => s.scopeType === 'NACIONAL');
  const hasRegional = normalized.some(s => s.scopeType === 'ESTADUAL' || s.scopeType === 'MUNICIPAL');
  if (hasNational && hasRegional) {
    throw new ElectionInvariantError(
      'CONTRADICTORY_SCOPE_NATIONAL_EXISTS',
      `O conjunto de escopos contém abrangência NACIONAL simultaneamente com escopos regionais (ESTADUAL/MUNICIPAL).`
    );
  }

  // 3. Sobreposição Estadual vs Municipal no mesmo Estado
  const stateScopesByUf = new Set(
    normalized.filter(s => s.scopeType === 'ESTADUAL' && s.stateCode).map(s => s.stateCode!)
  );
  for (const s of normalized) {
    if (s.scopeType === 'MUNICIPAL' && s.stateCode && stateScopesByUf.has(s.stateCode)) {
      throw new ElectionInvariantError(
        'OVERLAPPING_SCOPE_STATE_CONTAINS_MUNICIPALITY',
        `Sobreposição proibida: abrangência ESTADUAL no estado '${s.stateCode}' coexiste com escopo MUNICIPAL no mesmo estado ('${s.canonicalKey}').`
      );
    }
  }

  return normalized;
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
    scopeKey?: string;
    stateId?: string;
    municipalityId?: string;
    stateCode?: string;
    muniCode?: string;
    isCoverageArea?: boolean;
    userId?: string;
  }
) {
  const existingScopes = await tx.electionScope.findMany({
    where: { electionId },
    select: { scopeType: true, scopeKey: true }
  });

  const { canonicalKey, scopeType, stateCode, muniCode } = validateElectionScopeAddition(existingScopes, {
    scopeType: scopeData.scopeType,
    scopeKey: scopeData.scopeKey,
    stateCode: scopeData.stateCode,
    muniCode: scopeData.muniCode
  });

  // Validação relacional no banco de dados
  let finalStateId = scopeData.stateId || null;
  let finalMuniId = scopeData.municipalityId || null;

  if (finalStateId) {
    const st = await tx.state.findUnique({ where: { id: finalStateId } });
    if (!st) {
      throw new ElectionInvariantError('STATE_NOT_FOUND', `Estado ID '${finalStateId}' não encontrado.`);
    }
    if (stateCode && st.abbreviation.toUpperCase() !== stateCode.toUpperCase()) {
      throw new ElectionInvariantError(
        'MISMATCHED_STATE_UF',
        `A sigla do estado cadastrado '${st.abbreviation}' diverge da UF informada no escopo '${stateCode}'.`
      );
    }
  }

  if (finalMuniId) {
    const mun = await tx.municipality.findUnique({
      where: { id: finalMuniId },
      include: { state: true }
    });
    if (!mun) {
      throw new ElectionInvariantError('MUNICIPALITY_NOT_FOUND', `Município ID '${finalMuniId}' não encontrado.`);
    }
    if (muniCode && mun.officialCode !== muniCode) {
      throw new ElectionInvariantError(
        'MISMATCHED_MUNICIPALITY_CODE',
        `Código oficial do município cadastrado '${mun.officialCode}' diverge do informado '${muniCode}'.`
      );
    }
    if (stateCode && mun.state.abbreviation.toUpperCase() !== stateCode.toUpperCase()) {
      throw new ElectionInvariantError(
        'MISMATCHED_MUNICIPALITY_UF',
        `O município '${mun.name}' pertence ao estado '${mun.state.abbreviation}', mas o escopo foi registrado para '${stateCode}'.`
      );
    }
    if (!finalStateId) {
      finalStateId = mun.stateId;
    }
  }

  const createdScope = await tx.electionScope.create({
    data: {
      electionId,
      scopeType,
      scopeKey: canonicalKey,
      stateId: finalStateId,
      municipalityId: finalMuniId,
      isCoverageArea: scopeData.isCoverageArea ?? true
    }
  });

  if (scopeData.userId) {
    await tx.auditLog.create({
      data: {
        userId: scopeData.userId,
        electionId,
        action: 'ADD_ELECTION_SCOPE',
        identifiers: `Scope: ${canonicalKey}`,
        result: 'SUCCESS',
        newStatus: 'ACTIVE',
        metadata: JSON.stringify({ ...scopeData, canonicalKey })
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
