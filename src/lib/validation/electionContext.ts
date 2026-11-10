/**
 * Validação de Invariantes Contextuais Multi-Eleição e Regras de Negócio (PR 1)
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

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
    case 'OFFICE_NOT_CONFIGURED':
      return 'Cargo eleitoral presente no Boletim de Urna não está configurado para a eleição ativa.';
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

export interface TseDnsRecord {
  address: string;
  family: 4 | 6;
}

export type TseDnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim?: boolean }
) => Promise<Array<{ address: string; family: number }>>;

export interface TseSourceUrlValidationOptions {
  /**
   * Permissao estrita para servidores HTTP de loopback em testes automatizados.
   * Estritamente ignorada quando NODE_ENV === 'production'.
   */
  allowTestLoopbackHttp?: boolean;
  /** Injetavel para testes unitarios de resolucao DNS / rebinding. */
  dnsLookup?: TseDnsLookupFn;
}

export type TseUrlValidationResult =
  | {
      valid: true;
      normalized: string;
      hostname: string;
      isIpLiteral: boolean;
      isTestLoopback: boolean;
      canonicalIp?: TseDnsRecord;
    }
  | {
      valid: false;
      reason: string;
    };

export type TseResolvedUrlValidationResult =
  | {
      valid: true;
      normalized: string;
      hostname: string;
      isIpLiteral: boolean;
      isTestLoopback: boolean;
      resolvedAddresses: TseDnsRecord[];
    }
  | {
      valid: false;
      errorType: 'SSRF_BLOCKED' | 'DNS_ERROR';
      reason: string;
    };

const BLOCKED_INTERNAL_EXACT_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'host.docker.internal',
  'gateway.docker.internal',
  'kubernetes.default',
  'kubernetes.default.svc'
]);

const BLOCKED_INTERNAL_SUFFIXES = [
  '.localhost',
  '.localhost.localdomain',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.arpa'
];

function isTestLoopbackRuntimeAllowed(options?: TseSourceUrlValidationOptions): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return (
    options?.allowTestLoopbackHttp === true &&
    process.env.NODE_ENV === 'test' &&
    process.env.VITEST === 'true'
  );
}

/**
 * Normaliza o hostname removendo colchetes IPv6, ponto final FQDN e caixa alta.
 */
export function normalizeHostnameForSsrf(hostname: string): string {
  let clean = hostname.trim();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  clean = clean.replace(/\.+$/, '');
  return clean.toLowerCase();
}

function parseIPv4Part(part: string): number | null {
  if (!part) return null;
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
    const val = Number.parseInt(part.slice(2), 16);
    return Number.isSafeInteger(val) && val >= 0 ? val : null;
  }
  if (/^0[0-7]*$/.test(part)) {
    const val = Number.parseInt(part, 8);
    return Number.isSafeInteger(val) && val >= 0 ? val : null;
  }
  if (/^[1-9]\d*$/.test(part)) {
    const val = Number.parseInt(part, 10);
    return Number.isSafeInteger(val) && val >= 0 ? val : null;
  }
  return null;
}

/**
 * Normaliza representacoes IPv4 (decimal, octal, hexadecimal, abreviada 1-3 partes ou padrao 4 octetos)
 * para inteiro sem sinal de 32 bits.
 */
export function parseAndNormalizeIPv4(rawIp: string): number | null {
  const clean = normalizeHostnameForSsrf(rawIp);
  if (!clean || clean.includes(':') || clean.includes('%') || /\s/.test(clean)) {
    return null;
  }

  const parts = clean.split('.');
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }

  const parsedParts: number[] = [];
  for (const part of parts) {
    const num = parseIPv4Part(part);
    if (num === null) return null;
    parsedParts.push(num);
  }

  if (parsedParts.length === 1) {
    const [a] = parsedParts;
    return a <= 0xffffffff ? a >>> 0 : null;
  }
  if (parsedParts.length === 2) {
    const [a, b] = parsedParts;
    if (a > 0xff || b > 0xffffff) return null;
    return ((a << 24) | b) >>> 0;
  }
  if (parsedParts.length === 3) {
    const [a, b, c] = parsedParts;
    if (a > 0xff || b > 0xff || c > 0xffff) return null;
    return ((a << 24) | (b << 16) | c) >>> 0;
  }

  const [a, b, c, d] = parsedParts;
  if (a > 0xff || b > 0xff || c > 0xff || d > 0xff) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseStrictDecimalDottedIPv4(raw: string): number | null {
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const val = Number.parseInt(part, 10);
    if (val < 0 || val > 255) return null;
    nums.push(val);
  }
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

/**
 * Formata um IPv4 de 32 bits sem sinal para notacao pontilhada canonica.
 */
export function formatIPv4Uint32(ipInt: number): string {
  return [
    (ipInt >>> 24) & 0xff,
    (ipInt >>> 16) & 0xff,
    (ipInt >>> 8) & 0xff,
    ipInt & 0xff
  ].join('.');
}

function isPublicIPv4Uint32(ipInt: number): boolean {
  const a = (ipInt >>> 24) & 0xff;
  const b = (ipInt >>> 16) & 0xff;
  const c = (ipInt >>> 8) & 0xff;

  if (a === 0) return false; // 0.0.0.0/8 (unspecified / this network)
  if (a === 10) return false; // 10.0.0.0/8 (private RFC 1918)
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 (CGNAT RFC 6598)
  if (a === 127) return false; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 (link-local & cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 (private RFC 1918)
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 88 && c === 99) return false; // 192.88.99.0/24 (6to4 relay deprecated)
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 (private RFC 1918)
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return false; // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)

  return true;
}

/**
 * Converte um endereco IPv6 (comprimido, completo ou com IPv4 embutido) em 8 hextetos de 16 bits.
 * Rejeita zone IDs (%) ou sintaxe invalida retornando null.
 */
export function parseIPv6ToHextets(rawIp: string): number[] | null {
  const clean = normalizeHostnameForSsrf(rawIp);
  if (!clean || !clean.includes(':') || clean.includes('%') || /\s/.test(clean)) {
    return null;
  }

  const doubleColonIndex = clean.indexOf('::');
  if (doubleColonIndex !== -1 && clean.indexOf('::', doubleColonIndex + 2) !== -1) {
    return null;
  }

  let leftGroups: string[] = [];
  let rightGroups: string[] = [];

  if (doubleColonIndex !== -1) {
    const leftPart = clean.slice(0, doubleColonIndex);
    const rightPart = clean.slice(doubleColonIndex + 2);
    leftGroups = leftPart ? leftPart.split(':') : [];
    rightGroups = rightPart ? rightPart.split(':') : [];
  } else {
    leftGroups = clean.split(':');
  }

  // Trata sufixo IPv4 embutido (ex: ::ffff:127.0.0.1)
  const targetGroups = doubleColonIndex !== -1 ? rightGroups : leftGroups;
  if (targetGroups.length > 0 && targetGroups[targetGroups.length - 1].includes('.')) {
    const ipv4Token = targetGroups.pop()!;
    const embeddedIpv4 = parseStrictDecimalDottedIPv4(ipv4Token);
    if (embeddedIpv4 === null) return null;
    targetGroups.push(((embeddedIpv4 >>> 16) & 0xffff).toString(16));
    targetGroups.push((embeddedIpv4 & 0xffff).toString(16));
  }

  if (doubleColonIndex === -1) {
    if (leftGroups.length !== 8) return null;
  } else {
    if (leftGroups.length + rightGroups.length >= 8) return null;
  }

  const parseHextet = (g: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    return Number.parseInt(g, 16);
  };

  const leftNums = leftGroups.map(parseHextet);
  const rightNums = rightGroups.map(parseHextet);
  if (leftNums.some(n => n === null) || rightNums.some(n => n === null)) {
    return null;
  }

  if (doubleColonIndex === -1) {
    return leftNums as number[];
  }

  const zeroCount = 8 - leftNums.length - rightNums.length;
  return [
    ...(leftNums as number[]),
    ...Array(zeroCount).fill(0),
    ...(rightNums as number[])
  ];
}

function formatIPv6FromHextets(h: number[]): string {
  return h.map(v => v.toString(16).padStart(4, '0')).join(':');
}

function isPublicIPv6Hextets(h: number[]): boolean {
  if (h.length !== 8) return false;

  const isZeroPrefix5 = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;

  // ::ffff:0:0/96 (IPv4-mapped IPv6): valida o IPv4 embutido
  if (isZeroPrefix5 && h[5] === 0xffff) {
    const mappedIpv4 = ((h[6] << 16) | h[7]) >>> 0;
    return isPublicIPv4Uint32(mappedIpv4);
  }

  // ::/128 (unspecified), ::1/128 (loopback) e ::a.b.c.d (IPv4-compatible depreciado)
  if (isZeroPrefix5 && h[5] === 0) {
    return false;
  }

  // fc00::/7 (Unique Local Address, incluindo fd00:ec2::254)
  if ((h[0] & 0xfe00) === 0xfc00) {
    return false;
  }

  // fe80::/10 (Link-Local) e fec0::/10 (Site-Local depreciado)
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) {
    return false;
  }

  // ff00::/8 (Multicast)
  if ((h[0] & 0xff00) === 0xff00) {
    return false;
  }

  // Apenas Global Unicast 2000::/3 e publicamente roteavel na Internet
  if (h[0] < 0x2000 || h[0] > 0x3fff) {
    return false;
  }

  // Bloqueia subfaixas especiais reservadas dentro de 2000::/3
  if (h[0] === 0x2001) {
    if (h[1] === 0x0000) return false; // 2001::/32 Teredo
    if (h[1] === 0x0002 && h[2] === 0x0000) return false; // 2001:2::/48 Benchmarking
    if ((h[1] & 0xfff0) === 0x0010 || (h[1] & 0xfff0) === 0x0020) return false; // ORCHID / ORCHIDv2
    if (h[1] === 0x0db8) return false; // 2001:db8::/32 Documentation
  }
  if (h[0] === 0x2002) {
    return false; // 2002::/16 6to4 depreciado (RFC 7526)
  }
  if (h[0] === 0x3fff && (h[1] & 0xf000) === 0x0000) {
    return false; // 3fff::/20 Documentation (RFC 9637)
  }

  return true;
}

/**
 * Normaliza e verifica se um endereco IP (IPv4 em qualquer representacao ou IPv6) e estritamente publico.
 * Opera em modo fail-closed.
 */
export function isPublicIpAddress(rawIp: string): boolean {
  const clean = rawIp.trim();
  if (!clean || clean.includes('%')) {
    return false;
  }

  const ipv4Int = parseAndNormalizeIPv4(clean);
  if (ipv4Int !== null) {
    return isPublicIPv4Uint32(ipv4Int);
  }

  const ipv6Hextets = parseIPv6ToHextets(clean);
  if (ipv6Hextets !== null) {
    return isPublicIPv6Hextets(ipv6Hextets);
  }

  return false;
}

function normalizeIpRecord(rawIp: string): TseDnsRecord | null {
  if (!rawIp || rawIp.includes('%')) return null;

  const ipv4Int = parseAndNormalizeIPv4(rawIp);
  if (ipv4Int !== null) {
    return { address: formatIPv4Uint32(ipv4Int), family: 4 };
  }

  const ipv6Hextets = parseIPv6ToHextets(rawIp);
  if (ipv6Hextets !== null) {
    return { address: formatIPv6FromHextets(ipv6Hextets), family: 6 };
  }

  return null;
}

function isLoopbackHostOrIp(cleanHost: string): boolean {
  if (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost === 'localhost.localdomain'
  ) {
    return true;
  }

  const ipv4Int = parseAndNormalizeIPv4(cleanHost);
  if (ipv4Int !== null) {
    return ((ipv4Int >>> 24) & 0xff) === 127;
  }

  const ipv6Hextets = parseIPv6ToHextets(cleanHost);
  if (ipv6Hextets !== null) {
    const isLoopbackV6 =
      ipv6Hextets[0] === 0 &&
      ipv6Hextets[1] === 0 &&
      ipv6Hextets[2] === 0 &&
      ipv6Hextets[3] === 0 &&
      ipv6Hextets[4] === 0 &&
      ipv6Hextets[5] === 0 &&
      ipv6Hextets[6] === 0 &&
      ipv6Hextets[7] === 1;
    if (isLoopbackV6) return true;

    const isMappedLoopback =
      ipv6Hextets[0] === 0 &&
      ipv6Hextets[1] === 0 &&
      ipv6Hextets[2] === 0 &&
      ipv6Hextets[3] === 0 &&
      ipv6Hextets[4] === 0 &&
      ipv6Hextets[5] === 0xffff &&
      ((ipv6Hextets[6] >>> 8) & 0xff) === 127;
    if (isMappedLoopback) return true;
  }

  return false;
}

function isBlockedInternalHostname(cleanHost: string): boolean {
  if (
    !cleanHost ||
    /\s/.test(cleanHost) ||
    cleanHost.includes('%') ||
    cleanHost.includes('{') ||
    cleanHost.includes('}')
  ) {
    return true;
  }
  if (BLOCKED_INTERNAL_EXACT_HOSTS.has(cleanHost)) {
    return true;
  }
  if (BLOCKED_INTERNAL_SUFFIXES.some(suffix => cleanHost.endsWith(suffix))) {
    return true;
  }
  // Hostnames de rotulo unico (sem ponto, ex: "metadata", "redis") nao sao dominios publicos
  if (!cleanHost.includes('.')) {
    return true;
  }
  return false;
}

/**
 * Valida URL de origem externa para integracao TSE contra esquemas inseguros e SSRF
 * em IPs privados/reservados (IPv4 e IPv6, incluindo representacoes alternativas) e hosts internos.
 * Em producao, nunca permite HTTP nem localhost.
 */
export function validateTseSourceUrl(
  rawUrl: string,
  options?: TseSourceUrlValidationOptions
): TseUrlValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'URL de origem externa malformada.' };
  }

  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'URL de origem externa malformada.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Credenciais embutidas na URL externa não são permitidas.' };
  }

  if (parsed.port === '0') {
    return { valid: false, reason: 'Porta de destino da URL externa inválida.' };
  }

  const rawHost = parsed.hostname;
  if (!rawHost || rawHost.includes('%') || rawHost.includes('{') || rawHost.includes('}')) {
    return { valid: false, reason: 'Host de destino da URL externa não é permitido.' };
  }

  const cleanHost = normalizeHostnameForSsrf(rawHost);
  if (!cleanHost) {
    return { valid: false, reason: 'Host de destino da URL externa não é permitido.' };
  }

  const allowLoopback = isTestLoopbackRuntimeAllowed(options) && isLoopbackHostOrIp(cleanHost);

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowLoopback)) {
    return { valid: false, reason: 'Protocolo da URL de origem externa não é permitido.' };
  }

  if (allowLoopback) {
    return {
      valid: true,
      normalized: trimmed,
      hostname: cleanHost,
      isIpLiteral: normalizeIpRecord(cleanHost) !== null,
      isTestLoopback: true,
      canonicalIp: { address: '127.0.0.1', family: 4 }
    };
  }

  const ipRecord = normalizeIpRecord(cleanHost);
  if (ipRecord !== null) {
    if (!isPublicIpAddress(cleanHost)) {
      return { valid: false, reason: 'Host de destino da URL externa não é permitido.' };
    }
    return {
      valid: true,
      normalized: trimmed,
      hostname: cleanHost,
      isIpLiteral: true,
      isTestLoopback: false,
      canonicalIp: ipRecord
    };
  }

  if (isBlockedInternalHostname(cleanHost)) {
    return { valid: false, reason: 'Host de destino da URL externa não é permitido.' };
  }

  return {
    valid: true,
    normalized: trimmed,
    hostname: cleanHost,
    isIpLiteral: false,
    isTestLoopback: false
  };
}

/**
 * Valida a URL e resolve todos os registros DNS (A/AAAA), bloqueando em modo fail-closed
 * qualquer destino cujo DNS resolva total ou parcialmente para enderecos nao publicos.
 */
export async function resolveAndValidateTseSourceUrl(
  rawUrl: string,
  options?: TseSourceUrlValidationOptions
): Promise<TseResolvedUrlValidationResult> {
  const lexical = validateTseSourceUrl(rawUrl, options);
  if (!lexical.valid) {
    return {
      valid: false,
      errorType: 'SSRF_BLOCKED',
      reason: lexical.reason
    };
  }

  if (lexical.isTestLoopback) {
    return {
      valid: true,
      normalized: lexical.normalized,
      hostname: lexical.hostname,
      isIpLiteral: lexical.isIpLiteral,
      isTestLoopback: true,
      resolvedAddresses: [{ address: '127.0.0.1', family: 4 }]
    };
  }

  if (lexical.isIpLiteral && lexical.canonicalIp) {
    return {
      valid: true,
      normalized: lexical.normalized,
      hostname: lexical.hostname,
      isIpLiteral: true,
      isTestLoopback: false,
      resolvedAddresses: [lexical.canonicalIp]
    };
  }

  const lookupFn: TseDnsLookupFn =
    options?.dnsLookup ?? ((host, opts) => dns.promises.lookup(host, opts));

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookupFn(lexical.hostname, { all: true, verbatim: true });
  } catch {
    return {
      valid: false,
      errorType: 'DNS_ERROR',
      reason: 'Não foi possível resolver o host DNS da URL externa.'
    };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return {
      valid: false,
      errorType: 'DNS_ERROR',
      reason: 'O host DNS da URL externa não retornou endereços válidos.'
    };
  }

  const validatedAddresses: TseDnsRecord[] = [];
  for (const record of records) {
    if (!record || typeof record.address !== 'string' || !isPublicIpAddress(record.address)) {
      return {
        valid: false,
        errorType: 'SSRF_BLOCKED',
        reason: 'O host da URL externa resolve para um endereço IP não público.'
      };
    }

    const normalized = normalizeIpRecord(record.address);
    if (!normalized) {
      return {
        valid: false,
        errorType: 'SSRF_BLOCKED',
        reason: 'O host da URL externa resolve para um endereço IP não público.'
      };
    }

    validatedAddresses.push(normalized);
  }

  return {
    valid: true,
    normalized: lexical.normalized,
    hostname: lexical.hostname,
    isIpLiteral: false,
    isTestLoopback: false,
    resolvedAddresses: validatedAddresses
  };
}

/**
 * Cria funcao customizada de lookup DNS com fixacao dos IPs previamente validados,
 * impedindo nova consulta DNS no momento da conexao TCP (protecao contra DNS rebinding).
 */
export function createPinnedDnsLookup(
  expectedHostname: string,
  validatedAddresses: TseDnsRecord[],
  options?: { allowTestLoopbackHttp?: boolean }
) {
  const allowLoopback = isTestLoopbackRuntimeAllowed(options);
  const cleanExpectedHost = normalizeHostnameForSsrf(expectedHostname);

  const safeAddresses = validatedAddresses.filter(rec => {
    if (allowLoopback && (rec.address === '127.0.0.1' || rec.address === '::1')) {
      return true;
    }
    return isPublicIpAddress(rec.address);
  });

  if (safeAddresses.length === 0) {
    return (
      _hostname: string,
      opts: any,
      cb?: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void
    ) => {
      const callback = typeof opts === 'function' ? opts : cb!;
      callback(new Error('PINNED_DNS_NO_PUBLIC_ADDRESS'));
    };
  }

  // Prioriza IPv4 na ordem preservada caso ambos existam, mantendo todos os IPs validados
  const ordered = [
    ...safeAddresses.filter(a => a.family === 4),
    ...safeAddresses.filter(a => a.family === 6)
  ];

  return (
    hostname: string,
    opts: any,
    cb?: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void
  ) => {
    const callback = typeof opts === 'function' ? opts : cb!;
    if (normalizeHostnameForSsrf(hostname) !== cleanExpectedHost) {
      callback(new Error('PINNED_DNS_HOSTNAME_MISMATCH'));
      return;
    }

    const familyFilter = typeof opts === 'object' && opts !== null ? opts.family : undefined;
    const filtered =
      familyFilter === 4 || familyFilter === 6
        ? ordered.filter(a => a.family === familyFilter)
        : ordered;
    const candidates = filtered.length > 0 ? filtered : ordered;

    if (typeof opts === 'object' && opts !== null && opts.all) {
      callback(
        null,
        candidates.map(c => ({ address: c.address, family: c.family }))
      );
      return;
    }

    callback(null, candidates[0].address, candidates[0].family);
  };
}

const MAX_TSE_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Executa GET HTTPS/HTTP fixando o IP validado no socket (anti-DNS-rebinding),
 * bloqueando redirecionamentos HTTP (3xx) e respeitando timeout/AbortSignal.
 */
export async function executePinnedHttpGetJson(
  urlString: string,
  resolved: Extract<TseResolvedUrlValidationResult, { valid: true }>,
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    allowTestLoopbackHttp?: boolean;
    maxBytes?: number;
  }
): Promise<{ ok: boolean; status: number; isRedirect?: boolean; json: () => Promise<any> }> {
  const urlObj = new URL(urlString);
  const allowLoopback = isTestLoopbackRuntimeAllowed(options) && resolved.isTestLoopback;

  if (urlObj.protocol !== 'https:' && !(urlObj.protocol === 'http:' && allowLoopback)) {
    throw new Error('UNSAFE_PROTOCOL_BLOCKED');
  }

  const maxBytes = options?.maxBytes ?? MAX_TSE_RESPONSE_BYTES;
  const pinnedLookup = createPinnedDnsLookup(resolved.hostname, resolved.resolvedAddresses, {
    allowTestLoopbackHttp: allowLoopback
  });

  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new Error('TSE_FETCH_ABORTED'));
      return;
    }

    let settled = false;
    const cleanupAndReject = (err: Error) => {
      if (settled) return;
      settled = true;
      options?.signal?.removeEventListener('abort', onAbort);
      reject(err);
    };

    const transport = urlObj.protocol === 'http:' ? http : https;
    const requestOptions: https.RequestOptions = {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      lookup: pinnedLookup as unknown as NonNullable<https.RequestOptions['lookup']>,
      timeout: options?.timeoutMs,
      ...(urlObj.protocol === 'https:'
        ? {
            servername: urlObj.hostname,
            rejectUnauthorized: true
          }
        : {})
    };

    const req = transport.request(urlObj, requestOptions, res => {
      const statusCode = res.statusCode ?? 0;

      // Bloqueia redirecionamentos para impedir salto para hosts internos via Location
      if (statusCode >= 300 && statusCode < 400) {
        res.resume();
        settled = true;
        options?.signal?.removeEventListener('abort', onAbort);
        resolve({
          ok: false,
          status: statusCode,
          isRedirect: true,
          json: async () => {
            throw new Error('REDIRECT_BLOCKED');
          }
        });
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        settled = true;
        options?.signal?.removeEventListener('abort', onAbort);
        resolve({
          ok: false,
          status: statusCode,
          json: async () => {
            throw new Error(`HTTP_${statusCode}`);
          }
        });
        return;
      }

      const chunks: Buffer[] = [];
      let totalLength = 0;

      res.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalLength += buf.length;
        if (totalLength > maxBytes) {
          req.destroy(new Error('RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(buf);
      });

      res.on('end', () => {
        if (settled) return;
        settled = true;
        options?.signal?.removeEventListener('abort', onAbort);
        const bodyText = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: true,
          status: statusCode,
          json: async () => JSON.parse(bodyText)
        });
      });

      res.on('error', err => {
        cleanupAndReject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    const onAbort = () => {
      req.destroy(new Error('TSE_FETCH_ABORTED'));
    };

    options?.signal?.addEventListener('abort', onAbort, { once: true });

    req.on('timeout', () => {
      req.destroy(new Error('TSE_FETCH_TIMEOUT'));
    });

    req.on('error', err => {
      cleanupAndReject(err instanceof Error ? err : new Error(String(err)));
    });

    req.end();
  });
}
