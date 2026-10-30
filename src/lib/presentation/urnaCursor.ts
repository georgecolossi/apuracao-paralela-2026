export interface UrnaCursorPayload {
  e: string;         // electionId (UUID)
  r: string;         // roundId (UUID)
  z: string | null;  // zona normalizada canônica ('9') ou null
  s: string | null;  // seção normalizada canônica ('13') ou null
  c: string | null;  // confirmedAt (ISO-8601 canônico com milissegundos) ou null
  t: string;         // createdAt (ISO-8601 canônico com milissegundos)
  i: string;         // id (UUID do BallotReport)
}

export interface CursorContext {
  electionId: string;
  roundId: string;
  zoneFilter: string | null;    // Já normalizado canonicamente
  sectionFilter: string | null; // Já normalizado canonicamente
}

export type CursorValidationResult =
  | { valid: true; cursor: UrnaCursorPayload }
  | { valid: false; errorCode: 'CURSOR_MALFORMADO' | 'CURSOR_INVALIDO' | 'CURSOR_CONTEXT_MISMATCH'; message: string };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_CANONICAL_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_TOKEN_LENGTH = 512;
const EXPECTED_PROPERTIES = new Set(['e', 'r', 'z', 's', 'c', 't', 'i']);

/**
 * Valida se um valor de zona/seção no cursor está em representação numérica canônica estrita:
 * - Tipo string
 * - De 1 a 4 dígitos sem zeros à esquerda: /^[1-9]\d{0,3}$/
 * - Valor numérico entre 1 e 9999
 * - Satisfaz estritamente String(Number(val)) === val
 */
export function isCanonicalTerritoryCode(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (!/^[1-9]\d{0,3}$/.test(val)) return false;
  const num = Number(val);
  return !isNaN(num) && num >= 1 && num <= 9999 && String(num) === val;
}

/**
 * Validação ISO-8601 canônica estrita com resolução de milissegundos.
 */
function isValidCanonicalIsoDate(str: string): boolean {
  if (!ISO_CANONICAL_REGEX.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime()) && d.toISOString() === str;
}

/**
 * Codificação determinística do cursor de paginação.
 */
export function encodeUrnaCursor(
  confirmedAt: Date | null,
  createdAt: Date,
  id: string,
  context: CursorContext
): string {
  const payload: UrnaCursorPayload = {
    e: context.electionId,
    r: context.roundId,
    z: context.zoneFilter,
    s: context.sectionFilter,
    c: confirmedAt ? confirmedAt.toISOString() : null,
    t: createdAt.toISOString(),
    i: id
  };

  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

/**
 * Validação rigorosa e decodificação do cursor contra o contexto da requisição atual.
 */
export function validateAndDecodeCursor(
  cursorToken: string,
  currentContext: CursorContext
): CursorValidationResult {
  // 1. Limite de Tamanho e Formato Base64URL
  if (typeof cursorToken !== 'string' || cursorToken.length === 0 || cursorToken.length > MAX_CURSOR_TOKEN_LENGTH) {
    return {
      valid: false,
      errorCode: 'CURSOR_MALFORMADO',
      message: `Token de cursor com tamanho inválido (máximo permitido: ${MAX_CURSOR_TOKEN_LENGTH} caracteres).`
    };
  }

  if (!BASE64URL_REGEX.test(cursorToken)) {
    return {
      valid: false,
      errorCode: 'CURSOR_MALFORMADO',
      message: 'Token de cursor contém caracteres incompatíveis com base64url.'
    };
  }

  let parsed: any;
  try {
    const rawJson = Buffer.from(cursorToken, 'base64url').toString('utf-8');
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      valid: false,
      errorCode: 'CURSOR_MALFORMADO',
      message: 'Token de cursor não pôde ser decodificado como JSON válido.'
    };
  }

  // 2. Rejeição de Propriedades Inesperadas (Object Sealing)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      errorCode: 'CURSOR_INVALIDO',
      message: 'Estrutura do cursor deve ser um objeto JSON.'
    };
  }

  const keys = Object.keys(parsed);
  if (keys.length !== EXPECTED_PROPERTIES.size || keys.some(k => !EXPECTED_PROPERTIES.has(k))) {
    return {
      valid: false,
      errorCode: 'CURSOR_INVALIDO',
      message: 'O payload do cursor contém chaves inesperadas ou incompletas.'
    };
  }

  // 3. Validação de Tipos e Formatos
  if (typeof parsed.e !== 'string' || !UUID_REGEX.test(parsed.e)) {
    return { valid: false, errorCode: 'CURSOR_INVALIDO', message: 'Campo electionId (e) inválido.' };
  }
  if (typeof parsed.r !== 'string' || !UUID_REGEX.test(parsed.r)) {
    return { valid: false, errorCode: 'CURSOR_INVALIDO', message: 'Campo roundId (r) inválido.' };
  }
  if (typeof parsed.i !== 'string' || !UUID_REGEX.test(parsed.i)) {
    return { valid: false, errorCode: 'CURSOR_INVALIDO', message: 'Campo id (i) inválido.' };
  }

  if (typeof parsed.t !== 'string' || !isValidCanonicalIsoDate(parsed.t)) {
    return { valid: false, errorCode: 'CURSOR_INVALIDO', message: 'Timestamp createdAt (t) não canônico ou inválido.' };
  }

  if (parsed.c !== null && (typeof parsed.c !== 'string' || !isValidCanonicalIsoDate(parsed.c))) {
    return { valid: false, errorCode: 'CURSOR_INVALIDO', message: 'Timestamp confirmedAt (c) não canônico ou inválido.' };
  }

  if (parsed.z !== null && !isCanonicalTerritoryCode(parsed.z)) {
    return { valid: false, errorCode: 'CURSOR_INVALIDO', message: 'Filtro de zona (z) no cursor não é uma representação numérica canônica válida.' };
  }

  if (parsed.s !== null && !isCanonicalTerritoryCode(parsed.s)) {
    return { valid: false, errorCode: 'CURSOR_INVALIDO', message: 'Filtro de seção (s) no cursor não é uma representação numérica canônica válida.' };
  }

  // 4. Vinculação Estrita de Contexto (Query Binding)
  if (parsed.e !== currentContext.electionId) {
    return {
      valid: false,
      errorCode: 'CURSOR_CONTEXT_MISMATCH',
      message: 'O cursor informado foi emitido para outra eleição.'
    };
  }
  if (parsed.r !== currentContext.roundId) {
    return {
      valid: false,
      errorCode: 'CURSOR_CONTEXT_MISMATCH',
      message: 'O cursor informado foi emitido para outro turno eleitoral.'
    };
  }
  if (parsed.z !== currentContext.zoneFilter) {
    return {
      valid: false,
      errorCode: 'CURSOR_CONTEXT_MISMATCH',
      message: 'O cursor informado foi emitido para filtro de zona eleitoral divergente da consulta atual.'
    };
  }
  if (parsed.s !== currentContext.sectionFilter) {
    return {
      valid: false,
      errorCode: 'CURSOR_CONTEXT_MISMATCH',
      message: 'O cursor informado foi emitido para filtro de seção eleitoral divergente da consulta atual.'
    };
  }

  return { valid: true, cursor: parsed as UrnaCursorPayload };
}
