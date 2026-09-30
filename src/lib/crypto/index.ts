export type VerificationState = 'VERIFIED' | 'NOT_VERIFIED' | 'INVALID' | 'UNAVAILABLE';

export class SignatureVerifier {
  verify(payload: string, signature: string): VerificationState {
    // TODO: Implementar extração de chave pública do TSE e verificação ED25519/RSA
    // Retornamos UNAVAILABLE pois as chaves do TSE para 2026 não estão publicadas no sistema atual.
    return 'UNAVAILABLE';
  }
}

export class HashVerifier {
  verify(payload: string, hash: string): VerificationState {
    // TODO: Implementar SHA-256 ou outro padrão TSE oficial
    return 'UNAVAILABLE';
  }
}
