export interface TerritoryFilterValidation {
  valid: boolean;
  canonicalValue: string | null;
  error?: string;
}

/**
 * Validação estrita de parâmetros de filtro de zona ou seção.
 * Sem trim(): espaços em branco provocam rejeição imediata.
 * Somente null ou undefined representam ausência de filtro.
 */
export function validateTerritoryCode(
  raw: string | null | undefined,
  field: 'zone' | 'section'
): TerritoryFilterValidation {
  // 1. Somente null e undefined representam ausência de filtro
  if (raw === null || raw === undefined) {
    return { valid: true, canonicalValue: null };
  }

  // 2. Rejeita strings vazias, com espaços ou caracteres não numéricos
  if (!/^\d{1,4}$/.test(raw)) {
    return {
      valid: false,
      canonicalValue: null,
      error: `O parâmetro '${field}' deve conter exatamente de 1 a 4 dígitos numéricos sem espaços (recebido: '${raw}').`
    };
  }

  const num = Number(raw);
  if (num < 1 || num > 9999) {
    return {
      valid: false,
      canonicalValue: null,
      error: `O valor de '${field}' deve estar no intervalo entre 1 e 9999 (recebido: '${raw}').`
    };
  }

  // 3. Normalização canônica para equivalência entre '9' e '0009'
  return { valid: true, canonicalValue: String(num) };
}

/**
 * Retorna todas as variantes de representação numérica (1 a 4 dígitos com zeros à esquerda)
 * para compatibilidade de busca com bancos de dados onde zonas e seções podem ter sido
 * importadas em diferentes formatos (ex: '9', '09', '009', '0009' ou '42', '042', '0042').
 */
export function getTerritoryVariants(canonicalCode: string): string[] {
  const num = parseInt(canonicalCode, 10);
  if (isNaN(num) || num < 1 || num > 9999) {
    return [canonicalCode];
  }
  const s1 = String(num);
  const s2 = s1.padStart(2, '0');
  const s3 = s1.padStart(3, '0');
  const s4 = s1.padStart(4, '0');
  return Array.from(new Set([s1, s2, s3, s4]));
}

