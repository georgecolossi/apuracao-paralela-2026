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
