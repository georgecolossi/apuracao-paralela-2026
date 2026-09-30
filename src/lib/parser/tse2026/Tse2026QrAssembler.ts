export interface QrPartInfo {
  partIndex: number;
  totalParts: number;
  sequenceId: string;
  payload: string;
}

export class Tse2026QrAssembler {
  parseHeader(content: string): QrPartInfo | { code: string; message: string } {
    // Expected header format: QRBU:n:x
    // e.g. "QRBU:1:2 VRQR:01.01 ORIG:BU ..."
    
    // As per TSE spec, parts are delimited or the header is at the start
    const match = content.match(/^QRBU:(\d+):(\d+)\s*([\s\S]*)$/);
    if (!match) {
      return { code: 'INVALID_HEADER', message: 'Cabeçalho oficial QRBU ausente ou mal formatado' };
    }

    const partIndex = parseInt(match[1], 10);
    const totalParts = parseInt(match[2], 10);
    const payload = match[3];

    if (partIndex < 1 || totalParts < 1 || partIndex > totalParts) {
      return { code: 'INVALID_PART_INDEX', message: 'Índice de parte inconsistente com o total' };
    }

    // Identificador para agrupar multipartes na sessão, usando a raiz do payload nas primeiras partes se possível
    // No TSE real, a sessão é atrelada à Urna ou gerada externamente no momento do scan.
    // Usaremos um sequenceId baseado na leitura para compatibilidade com nossa arquitetura.
    return {
      partIndex,
      totalParts,
      sequenceId: 'QRBU', // Will be overridden by the router logic (ScanSession UUID)
      payload
    };
  }

  reconstruct(partsContent: string[]): string | { code: string; message: string } {
    if (partsContent.length === 0) return { code: 'NO_PARTS', message: 'Nenhuma parte enviada' };

    const parsedParts: { index: number; total: number; payload: string }[] = [];

    for (const content of partsContent) {
      const match = content.match(/^QRBU:(\d+):(\d+)\s*([\s\S]*)$/);
      if (!match) return { code: 'INVALID_HEADER', message: 'Uma das partes não possui cabeçalho oficial' };
      parsedParts.push({
        index: parseInt(match[1], 10),
        total: parseInt(match[2], 10),
        payload: match[3]
      });
    }

    const totalParts = parsedParts[0].total;
    if (parsedParts.some(p => p.total !== totalParts)) {
      return { code: 'TOTAL_MISMATCH', message: 'As partes informam totais divergentes' };
    }

    const uniqueIndices = new Set(parsedParts.map(p => p.index));
    if (uniqueIndices.size !== parsedParts.length) {
      return { code: 'DUPLICATE_PARTS', message: 'Índices de partes duplicados' };
    }

    if (uniqueIndices.size < totalParts) {
      return { code: 'MISSING_PARTS', message: 'Faltam partes para a reconstrução' };
    }

    if (uniqueIndices.size > totalParts) {
      return { code: 'TOO_MANY_PARTS', message: 'Mais partes do que o total esperado' };
    }

    parsedParts.sort((a, b) => a.index - b.index);

    // Concatena as partes preservando exatamente como vieram (espaços, etc)
    return parsedParts.map(p => p.payload).join(' ');
  }
}
