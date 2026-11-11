/**
 * Identificador Oficial de Envelope Eleitoral do Scanner Mobile (PR 5)
 * 
 * Extrai a identidade estável e verificável do envelope eleitoral a partir de um fragmento de BU.
 * 
 * Utiliza exclusivamente metadados estruturais oficiais e verificáveis:
 * - PLEI (Código do Pleito TSE)
 * - UNFE / UF (Unidade Federativa)
 * - MUNI (Código Oficial do Município)
 * - ZONA (Zona Eleitoral)
 * - SECA (Seção Eleitoral)
 * - IDUE (Identificador da Urna Eletrônica, quando disponível)
 * 
 * LIMITAÇÃO DOCUMENTADA E AUDITADA:
 * No padrão VRQR 6.0 oficial do TSE, os metadados estruturais do cabeçalho constam
 * apenas na primeira parte (ou em fragmentos com cabeçalho completo). Fragmentos de
 * continuação (ex: Parte 2 de 2) contêm apenas tokens de continuação de votos e resumo.
 * Se a identidade completa não puder ser determinada a partir de um fragmento isolado,
 * esta função retorna `null`, sem recorrer a identificadores presumidos ou hashes de partes
 * isoladas. A garantia integral e final de integridade e não-mistura de votos é assegurada
 * pela validação criptográfica (SHA-512) e invariantes eleitorais na remontagem no backend.
 */

export function extractEnvelopeKeyFromContent(content: string): string | null {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();

  // 1. Suporte a Formato de Simulação (Ambiente de Testes)
  if (trimmed.startsWith('SIMULATION|')) {
    const parts = trimmed.split('|');
    // Estrutura: SIMULATION|partIndex|totalParts|sequenceId|electionId|round|state|city|zone|section|urn
    if (parts.length >= 11) {
      const electionId = parts[4]?.trim();
      const stateCode = (parts[6] || 'BR').trim().toUpperCase();
      const cityCode = parts[7]?.trim();
      const zoneCode = parts[8]?.trim();
      const sectionCode = parts[9]?.trim();
      const urnCode = parts[10]?.trim();

      if (electionId && cityCode && zoneCode && sectionCode) {
        return urnCode
          ? `SIM-${electionId}-${stateCode}-${cityCode}-${zoneCode}-${sectionCode}-${urnCode}`
          : `SIM-${electionId}-${stateCode}-${cityCode}-${zoneCode}-${sectionCode}`;
      }
    }
    return null;
  }

  // 2. Formato Oficial QRBU / VRQR
  // Extração estrita via regex com limites de palavra para evitar falsos positivos
  const pleiMatch = trimmed.match(/\bPLEI:(\d+)\b/);
  const muniMatch = trimmed.match(/\bMUNI:(\d+)\b/);
  const zonaMatch = trimmed.match(/\bZONA:(\d+)\b/);
  const secaMatch = trimmed.match(/\bSECA:(\d+)\b/);
  const unfeMatch = trimmed.match(/\b(?:UNFE|UF):([A-Z]{2})\b/i);
  const idueMatch = trimmed.match(/\bIDUE:(\d+)\b/);

  // Exige rigorosamente os 4 pilares eleitorais mínimos para composição do envelope
  if (pleiMatch && muniMatch && zonaMatch && secaMatch) {
    const plei = pleiMatch[1];
    const uf = unfeMatch ? unfeMatch[1].toUpperCase() : 'BR';
    const muni = muniMatch[1];
    const zona = zonaMatch[1];
    const seca = secaMatch[1];
    const idue = idueMatch ? idueMatch[1] : '';

    return idue
      ? `ENV-${plei}-${uf}-${muni}-${zona}-${seca}-${idue}`
      : `ENV-${plei}-${uf}-${muni}-${zona}-${seca}`;
  }

  // Fragmento de continuação sem cabeçalho estrutural
  return null;
}
