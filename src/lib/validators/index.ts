export type ValidationResult = 'VALID' | 'INVALID' | 'UNAVAILABLE';

export class StructuralValidator {
  validate(asn1Decoded: unknown): ValidationResult {
    // Sem o esquema ASN.1 oficial de 2026, não podemos validar a árvore.
    return 'UNAVAILABLE';
  }
}

export class SemanticValidator {
  validate(parsedData: unknown): ValidationResult {
    // Validação de regras de negócio (votos nulos não negativos, totalização, etc)
    // Requer o modelo exato de 2026 preenchido.
    return 'UNAVAILABLE';
  }
}
