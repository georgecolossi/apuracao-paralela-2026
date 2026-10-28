/**
 * Gerenciador de Estado Multipartes do Scanner Mobile (PR 5)
 * 
 * Responsável por rastrear com precisão o progresso de leitura,
 * identificar partes faltantes em leituras fora de ordem,
 * detectar duplicidades na mesma sessão e gerar instruções claras
 * para o operador de campo.
 */

export interface MultipartProgress {
  totalParts: number;
  readCount: number;
  receivedIndices: number[];
  missingIndices: number[];
  lastReceivedIndex: number | null;
  isComplete: boolean;
  statusMessage: string;
}

export class MultipartTracker {
  private totalParts: number | null = null;
  private receivedParts = new Set<number>();
  private lastReceived: number | null = null;

  /**
   * Registra a leitura de uma parte.
   * Retorna true se a parte for inédita nesta sessão; false se for duplicada.
   */
  public registerPart(partIndex: number, totalParts: number): { isDuplicate: boolean; progress: MultipartProgress } {
    if (this.totalParts === null || this.totalParts !== totalParts) {
      // Inicializa ou reconfigura se for nova sequência
      this.totalParts = totalParts;
    }

    const isDuplicate = this.receivedParts.has(partIndex);
    if (!isDuplicate) {
      this.receivedParts.add(partIndex);
      this.lastReceived = partIndex;
    }

    return {
      isDuplicate,
      progress: this.getProgress()
    };
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

    const isComplete = missingIndices.length === 0 && receivedIndices.length === total;
    let statusMessage = '';

    if (total === 1) {
      statusMessage = isComplete
        ? 'Boletim de Urna (Parte Única) Lido com Sucesso!'
        : 'Aguardando leitura do QR Code do BU...';
    } else {
      if (isComplete) {
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
      isComplete,
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
   * Reinicia o estado da sessão multipartes.
   */
  public reset(): void {
    this.totalParts = null;
    this.receivedParts.clear();
    this.lastReceived = null;
  }
}
