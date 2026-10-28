/**
 * Gerenciador de Estado Multipartes do Scanner Mobile (PR 5)
 * 
 * Responsável por rastrear com precisão o progresso de leitura,
 * identificar partes faltantes em leituras fora de ordem,
 * validar limites métricos, rejeitar envelopes misturados e
 * distinguir captura local de confirmação no backend.
 */

export interface MultipartProgress {
  totalParts: number;
  readCount: number;
  receivedIndices: number[];
  missingIndices: number[];
  lastReceivedIndex: number | null;
  allPartsCaptured: boolean;
  backendConfirmed: boolean;
  envelopeKey: string | null;
  statusMessage: string;
  /** Compatibilidade retroativa com código existente */
  isComplete: boolean;
}

export type MultipartErrorCode = 
  | 'INVALID_PART_INDEX' 
  | 'MISMATCHED_TOTAL_PARTS' 
  | 'BALLOT_ENVELOPE_MISMATCH' 
  | 'INVALID_PART_METRICS';

export interface RegisterPartResult {
  success: boolean;
  isDuplicate: boolean;
  errorCode?: MultipartErrorCode;
  errorMessage?: string;
  progress: MultipartProgress;
}

export class MultipartTracker {
  private totalParts: number | null = null;
  private receivedParts = new Set<number>();
  private lastReceived: number | null = null;
  private envelopeKey: string | null = null;
  private backendConfirmed = false;

  /**
   * Registra a leitura de uma parte com validações rigorosas de limites e envelope.
   */
  public registerPart(
    partIndex: number, 
    totalParts: number, 
    envelopeKey?: string | null
  ): RegisterPartResult {
    // 1. Validação de integridade numérica básica
    if (
      !Number.isInteger(partIndex) ||
      !Number.isInteger(totalParts) ||
      partIndex < 1 ||
      totalParts < 1 ||
      totalParts > 30
    ) {
      return {
        success: false,
        isDuplicate: false,
        errorCode: 'INVALID_PART_METRICS',
        errorMessage: `Métricas multipartes inválidas: parte=${partIndex}, total=${totalParts}.`,
        progress: this.getProgress()
      };
    }

    // 2. Validação do índice da parte em relação ao total declarado
    if (partIndex > totalParts) {
      return {
        success: false,
        isDuplicate: false,
        errorCode: 'INVALID_PART_INDEX',
        errorMessage: `Índice da parte (${partIndex}) excede o total previsto (${totalParts}).`,
        progress: this.getProgress()
      };
    }

    // 3. Validação de totalParts divergente na mesma sessão já iniciada
    if (this.totalParts !== null && this.totalParts !== totalParts) {
      return {
        success: false,
        isDuplicate: false,
        errorCode: 'MISMATCHED_TOTAL_PARTS',
        errorMessage: `Total de partes informado (${totalParts}) diverge da sequência iniciada (${this.totalParts}).`,
        progress: this.getProgress()
      };
    }

    // 4. Validação de chave de envelope (mistura de boletins diferentes na mesma sessão)
    if (envelopeKey) {
      if (this.envelopeKey === null) {
        this.envelopeKey = envelopeKey;
      } else if (this.envelopeKey !== envelopeKey) {
        return {
          success: false,
          isDuplicate: false,
          errorCode: 'BALLOT_ENVELOPE_MISMATCH',
          errorMessage: `Fragmento pertence a outro boletim (${envelopeKey} != ${this.envelopeKey}).`,
          progress: this.getProgress()
        };
      }
    }

    // Inicializa totalParts na primeira leitura válida
    if (this.totalParts === null) {
      this.totalParts = totalParts;
    }

    // 5. Verificação de duplicata
    const isDuplicate = this.receivedParts.has(partIndex);
    if (!isDuplicate) {
      this.receivedParts.add(partIndex);
      this.lastReceived = partIndex;
    }

    return {
      success: true,
      isDuplicate,
      progress: this.getProgress()
    };
  }

  /**
   * Marca a confirmação oficial emitida pelo backend (/api/scan status COMPLETO).
   */
  public confirmBackendSuccess(): void {
    this.backendConfirmed = true;
  }

  /**
   * Obtém o estado atual detalhado da reconstrução multipartes.
   */
  public getProgress(): MultipartProgress {
    const total = this.totalParts ?? 1;
    const receivedIndices = Array.from(this.receivedParts).sort((a, b) => a - b);
    const missingIndices: number[] = [];

    for (let i = 1; i <= total; i++) {
      if (!this.receivedParts.has(i)) {
        missingIndices.push(i);
      }
    }

    const allPartsCaptured = this.totalParts !== null && missingIndices.length === 0 && receivedIndices.length === total;
    let statusMessage = '';

    if (total === 1) {
      if (this.backendConfirmed) {
        statusMessage = 'Boletim de Urna (Parte Única) Lido e Confirmado pelo Servidor!';
      } else if (allPartsCaptured) {
        statusMessage = 'Boletim de Urna (Parte Única) Lido com Sucesso!';
      } else {
        statusMessage = 'Aguardando leitura do QR Code do BU...';
      }
    } else {
      if (this.backendConfirmed) {
        statusMessage = `Todas as ${total} partes foram confirmadas e processadas pelo servidor!`;
      } else if (allPartsCaptured) {
        statusMessage = `Todas as ${total} partes foram lidas com sucesso! Concluindo processamento...`;
      } else if (this.lastReceived !== null) {
        if (missingIndices.length === 1) {
          statusMessage = `Parte ${this.lastReceived} de ${total} capturada. Falta apenas a Parte ${missingIndices[0]}.`;
        } else {
          statusMessage = `Parte ${this.lastReceived} de ${total} capturada. Faltam as partes: ${missingIndices.join(', ')}.`;
        }
      } else {
        statusMessage = `Aponte a câmera para os QR Codes do BU (Total de ${total} partes).`;
      }
    }

    return {
      totalParts: total,
      readCount: receivedIndices.length,
      receivedIndices,
      missingIndices,
      lastReceivedIndex: this.lastReceived,
      allPartsCaptured,
      backendConfirmed: this.backendConfirmed,
      envelopeKey: this.envelopeKey,
      isComplete: allPartsCaptured, // preserva semântica anterior
      statusMessage
    };
  }

  /**
   * Verifica se uma parte específica já foi lida.
   */
  public hasPart(partIndex: number): boolean {
    return this.receivedParts.has(partIndex);
  }

  /**
   * Retorna a chave do envelope ativo, se houver.
   */
  public getEnvelopeKey(): string | null {
    return this.envelopeKey;
  }

  /**
   * Reinicia o estado da sessão multipartes.
   */
  public reset(): void {
    this.totalParts = null;
    this.receivedParts.clear();
    this.lastReceived = null;
    this.envelopeKey = null;
    this.backendConfirmed = false;
  }
}
