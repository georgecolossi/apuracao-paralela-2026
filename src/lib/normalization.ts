/**
 * Utilitário universal de normalização textual e validação de confirmações administrativas.
 * 
 * Regras:
 * - Ações administrativas suportam variações de caixa (maiúsculas/minúsculas), acentuação (Unicode NFC/NFD) e espaçamento.
 * - Credenciais, senhas, hashes, assinaturas e tokens NUNCA devem ser normalizados por este utilitário.
 */

/**
 * Normaliza uma string para comparação textual flexível:
 * - Remove espaços extras nas extremidades e colapsa múltiplos espaços em um único.
 * - Decompõe caracteres Unicode em formato NFD e remove diacríticos (acentos, cedilhas, til).
 * - Converte símbolos ordinais comuns (º, ª, °) para facilitar digitação em celulares e teclados diversos.
 * - Converte para minúsculas.
 */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove marcas diacríticas
    .replace(/[ºª°]/g, '')          // Remove ordinais
    .toLowerCase()
    .replace(/\s+/g, ' ');          // Colapsa espaços internos
}

/**
 * Mapeamento de números ordinais por extenso para dígitos e vice-versa.
 */
const NUMBER_WORDS: Record<number, string[]> = {
  1: ['primeiro', '1', 'um'],
  2: ['segundo', '2', 'dois'],
  3: ['terceiro', '3', 'tres'],
  4: ['quarto', '4', 'quatro'],
};

/**
 * Retorna as frases de confirmação aceitas para uma ação administrativa em um determinado turno.
 * A primeira frase da lista é a frase canônica sugerida na interface.
 */
export function getConfirmationAliases(
  action: 'RESET' | 'ACTIVATE' | 'ACTIVATE_ELECTION',
  roundNumber?: number
): { canonical: string; aliases: string[] } {
  if (action === 'RESET') {
    if (!roundNumber) {
      // Reset global da apuração (aplicável apenas a operações globais explicitamente definidas)
      return {
        canonical: 'ZERAR APURAÇÃO',
        aliases: [
          'ZERAR APURAÇÃO',
          'ZERAR APURACAO'
        ]
      };
    }

    const ordinal = roundNumber === 1 ? 'PRIMEIRO' : roundNumber === 2 ? 'SEGUNDO' : `${roundNumber}º`;
    const canonical = `ZERAR ${ordinal} TURNO`;
    const wordList = NUMBER_WORDS[roundNumber] || [String(roundNumber)];

    // No reset contextual por turno, aceita exclusivamente equivalências ao turno especificado
    const aliases: string[] = [
      canonical,
      `ZERAR ${roundNumber}º TURNO`,
      `ZERAR ${roundNumber} TURNO`,
      `ZERAR TURNO ${roundNumber}`,
    ];

    for (const w of wordList) {
      aliases.push(`ZERAR ${w.toUpperCase()} TURNO`);
    }

    return {
      canonical,
      aliases: Array.from(new Set(aliases))
    };
  }

  if (action === 'ACTIVATE') {
    const round = roundNumber || 2;
    const ordinal = round === 1 ? 'PRIMEIRO' : round === 2 ? 'SEGUNDO' : `${round}º`;
    const canonical = `ATIVAR ${ordinal} TURNO`;
    const wordList = NUMBER_WORDS[round] || [String(round)];

    const aliases: string[] = [
      canonical,
      `ATIVAR ${round} TURNO`,
      `ATIVAR TURNO ${round}`,
    ];

    for (const w of wordList) {
      aliases.push(`ATIVAR ${w.toUpperCase()} TURNO`);
    }

    return {
      canonical,
      aliases: Array.from(new Set(aliases))
    };
  }

  if (action === 'ACTIVATE_ELECTION') {
    return {
      canonical: 'ATIVAR ELEIÇÃO',
      aliases: [
        'ATIVAR ELEIÇÃO',
        'ATIVAR ELEICAO',
        'ATIVAR',
        'ATIVAR ELEICAO PRINCIPAL',
        'ATIVAR ELEIÇÃO PRINCIPAL'
      ]
    };
  }

  return { canonical: '', aliases: [] };
}

/**
 * Valida se o texto digitado pelo operador corresponde à confirmação esperada,
 * tolerando variações de maiúsculas/minúsculas, acentos, espaçamento e sinônimos ordinais.
 */
export function validateAdminConfirmation(
  input: string | null | undefined,
  expected: string | string[]
): boolean {
  if (!input) return false;
  const normalizedInput = normalizeText(input);
  if (!normalizedInput) return false;

  const expectedList = Array.isArray(expected) ? expected : [expected];
  return expectedList.some(exp => normalizeText(exp) === normalizedInput);
}
