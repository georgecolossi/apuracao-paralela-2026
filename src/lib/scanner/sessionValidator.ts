export interface ScanSessionSnapshot {
  isSimulation: boolean;
  expectedParts: number;
  operatorId: string | null;
}

export interface ScanSessionRequestContext {
  isSimulation: boolean;
  totalParts?: number;
  operatorId: string;
}

export type ScanSessionValidationResult =
  | { valid: true }
  | {
      valid: false;
      status: number;
      code:
        | 'SCAN_SESSION_MODE_MISMATCH'
        | 'SCAN_SESSION_PARTS_MISMATCH'
        | 'SCAN_SESSION_OPERATOR_MISMATCH';
      message: string;
    };

/**
 * Valida se uma requisição subsequente para uma `ScanSession` já existente
 * preserva integralmente o modo de leitura (`isSimulation`), o operador
 * autenticado responsável e a quantidade esperada de partes.
 */
export function validateScanSessionCompatibility(
  session: ScanSessionSnapshot,
  request: ScanSessionRequestContext
): ScanSessionValidationResult {
  if (session.isSimulation !== request.isSimulation) {
    return {
      valid: false,
      status: 409,
      code: 'SCAN_SESSION_MODE_MISMATCH',
      message:
        'A sessão de leitura já foi iniciada em outro modo (oficial ou simulação) e não pode alternar o contexto.'
    };
  }

  if (!session.operatorId || session.operatorId !== request.operatorId) {
    return {
      valid: false,
      status: 403,
      code: 'SCAN_SESSION_OPERATOR_MISMATCH',
      message: 'A sessão de leitura pertence a outro operador autenticado.'
    };
  }

  if (
    typeof request.totalParts === 'number' &&
    session.expectedParts !== request.totalParts
  ) {
    return {
      valid: false,
      status: 409,
      code: 'SCAN_SESSION_PARTS_MISMATCH',
      message:
        'A quantidade total de partes informada diverge da sessão de leitura original.'
    };
  }

  return { valid: true };
}
