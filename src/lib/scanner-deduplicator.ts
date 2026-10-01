export class ScannerDeduplicator {
  private lastScanned: string | null = null;

  /**
   * Tenta registrar uma leitura.
   * Retorna true se for uma leitura inédita em relação à imediatamente anterior.
   * Retorna false se for uma repetição exata do conteúdo corrente.
   */
  public shouldProcess(content: string): boolean {
    if (this.lastScanned === content) {
      return false;
    }
    this.lastScanned = content;
    return true;
  }

  /**
   * Limpa a memória da leitura atual. Usado em resets de sessão
   * ou quando o processo falha e queremos permitir que o usuário
   * tente novamente o mesmo QR sem precisar intercalar.
   */
  public clearIfMatches(content: string) {
    if (this.lastScanned === content) {
      this.lastScanned = null;
    }
  }

  /**
   * Reseta completamente a memória.
   */
  public clear() {
    this.lastScanned = null;
  }
}
