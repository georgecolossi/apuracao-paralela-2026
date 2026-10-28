/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR BASE VRQR (TSE)
 * 
 * Implementação base para leitura, validação de integridade (SHA-512)
 * e interpretação semântica de QR Codes de Boletins de Urna no formato VRQR.
 */

import crypto from 'crypto';
import {
  QrBuAdapter,
  QrPartInfo,
  ParseError,
  BallotReportData,
  BallotVote,
  VoteType
} from './QrBuAdapter';

export const OFFICIAL_OFFICE_MAP: Record<string, { name: string; type: 'MAJORITARIO' | 'PROPORCIONAL' | 'CONSULTA' }> = {
  '1': { name: 'Presidente', type: 'MAJORITARIO' },
  '2': { name: 'Vice-Presidente', type: 'MAJORITARIO' },
  '3': { name: 'Governador', type: 'MAJORITARIO' },
  '4': { name: 'Vice-Governador', type: 'MAJORITARIO' },
  '5': { name: 'Senador', type: 'MAJORITARIO' },
  '6': { name: 'Deputado Federal', type: 'PROPORCIONAL' },
  '7': { name: 'Deputado Estadual', type: 'PROPORCIONAL' },
  '8': { name: 'Deputado Distrital', type: 'PROPORCIONAL' },
  '11': { name: 'Prefeito', type: 'MAJORITARIO' },
  '12': { name: 'Vice-Prefeito', type: 'MAJORITARIO' },
  '13': { name: 'Vereador', type: 'PROPORCIONAL' },
  '53': { name: 'Consulta Popular', type: 'CONSULTA' }
};

export abstract class BaseVrqrAdapter implements QrBuAdapter {
  abstract readonly version: string;
  abstract readonly supportedFormats: string[];
  abstract readonly description: string;

  canHandle(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    const vrqrMatch = trimmed.match(/VRQR:(\S+)/);
    if (vrqrMatch) {
      const detectedVersion = vrqrMatch[1];
      return this.supportedFormats.includes(detectedVersion) || this.version === `VRQR:${detectedVersion}`;
    }
    return false;
  }

  parsePart(content: string): QrPartInfo | ParseError {
    if (!content || typeof content !== 'string') {
      return { code: 'INVALID_HEADER', message: 'Conteúdo do QRBU vazio ou inválido.' };
    }

    const trimmed = content.trim();
    const match = trimmed.match(/^QRBU:(\d+):(\d+)\s*([\s\S]*)$/);
    if (!match) {
      return { code: 'INVALID_HEADER', message: 'Cabeçalho oficial QRBU ausente ou mal formatado.' };
    }

    const partIndex = parseInt(match[1], 10);
    const totalParts = parseInt(match[2], 10);
    const payload = match[3];

    if (isNaN(partIndex) || isNaN(totalParts) || partIndex < 1 || totalParts < 1 || partIndex > totalParts) {
      return {
        code: 'INVALID_PART_INDEX',
        message: `Índice de parte (${partIndex}) inconsistente com o total de partes (${totalParts}).`
      };
    }

    const vrqrMatch = payload.match(/VRQR:(\S+)/);
    const vrqrVersion = vrqrMatch ? vrqrMatch[1] : '';

    if (vrqrVersion && !this.supportedFormats.includes(vrqrVersion) && this.version !== `VRQR:${vrqrVersion}`) {
      return {
        code: 'UNSUPPORTED_VRQR_VERSION',
        message: `Versão do formato QRBU '${vrqrVersion}' não suportada por este adaptador (${this.version}).`
      };
    }

    return {
      partIndex,
      totalParts,
      vrqrVersion,
      sequenceId: 'QRBU',
      payload,
      rawContent: trimmed
    };
  }

  reconstruct(parts: string[]): string | ParseError {
    if (!parts || parts.length === 0) {
      return { code: 'NO_PARTS', message: 'Nenhuma parte enviada para reconstrução.' };
    }

    const parsedList: Array<{ index: number; total: number; version: string; payload: string }> = [];

    for (const part of parts) {
      const parsed = this.parsePart(part);
      if ('code' in parsed) {
        return parsed;
      }
      parsedList.push({
        index: parsed.partIndex,
        total: parsed.totalParts,
        version: parsed.vrqrVersion,
        payload: parsed.payload
      });
    }

    const expectedTotal = parsedList[0].total;

    // Validações estritas de consistência entre partes
    if (parsedList.some(p => p.total !== expectedTotal)) {
      return { code: 'TOTAL_MISMATCH', message: 'As partes informam totais de partes divergentes.' };
    }

    const versions = parsedList.map(p => p.version).filter(Boolean);
    const expectedVersion = versions[0];
    if (expectedVersion && versions.some(p => p !== expectedVersion)) {
      return { code: 'TOTAL_MISMATCH', message: 'As partes informam versões de formato QRBU divergentes.' };
    }

    const indices = parsedList.map(p => p.index);
    const uniqueIndices = new Set(indices);
    if (uniqueIndices.size !== parsedList.length) {
      return { code: 'DUPLICATE_PARTS', message: 'Detectadas partes com índices duplicados na mesma leitura.' };
    }

    if (uniqueIndices.size < expectedTotal) {
      return {
        code: 'MISSING_PARTS',
        message: `Faltam partes para a reconstrução completa do BU (recebidas: ${uniqueIndices.size}, esperadas: ${expectedTotal}).`
      };
    }

    if (uniqueIndices.size > expectedTotal) {
      return { code: 'TOO_MANY_PARTS', message: 'Quantidade de partes excede o total esperado.' };
    }

    // Ordenação estrita das partes
    parsedList.sort((a, b) => a.index - b.index);

    // Concatenação preservando os espaços originais
    return parsedList.map(p => p.payload).join(' ');
  }

  parseReport(fullPayload: string, rawParts?: string[]): BallotReportData | ParseError {
    if (!fullPayload || typeof fullPayload !== 'string') {
      return { code: 'CORRUPTED_PAYLOAD', message: 'Payload do BU vazio ou corrompido.' };
    }

    // Tokenização estruturada (KEY:VALUE)
    const tokens = this.tokenize(fullPayload);
    if (tokens.length === 0) {
      return { code: 'CORRUPTED_PAYLOAD', message: 'Não foi possível extrair nenhum token válido do QRBU.' };
    }

    // Mapeamento semântico
    const parsedDataOrError = this.parseSemanticTokens(tokens, fullPayload);
    if ('code' in parsedDataOrError) {
      return parsedDataOrError;
    }

    // Validação Criptográfica de Integridade (Hash SHA-512)
    const hashStatus = this.validateSha512Hash(rawParts, parsedDataOrError.hash);
    if (hashStatus === 'INVALID') {
      return {
        code: 'INVALID_HASH',
        message: 'O hash criptográfico SHA-512 não confere com o conteúdo dos QR Codes do Boletim de Urna.',
        details: { calculated: 'MISMATCH', provided: parsedDataOrError.hash }
      };
    }

    parsedDataOrError.hashStatus = hashStatus;

    // Validação da Assinatura Digital (ASSI)
    // A chave pública da urna eletrônica é disponibilizada pelo TSE fora de banda (off-band).
    // Sem as chaves e certificados de cadeia do TSE, a assinatura é classificada estritamente como UNAVAILABLE.
    parsedDataOrError.sigStatus = 'UNAVAILABLE';
    parsedDataOrError.sigValidationNote =
      'Assinatura digital presente no payload, porém validação indisponível sem certificados e chaves públicas oficiais do TSE.';

    return parsedDataOrError;
  }

  protected tokenize(payload: string): Array<{ key: string; value: string; raw: string }> {
    const tokens: Array<{ key: string; value: string; raw: string }> = [];
    const regex = /([A-Z0-9]+):(\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(payload)) !== null) {
      tokens.push({
        key: match[1],
        value: match[2],
        raw: match[0]
      });
    }

    return tokens;
  }

  protected parseSemanticTokens(
    tokens: Array<{ key: string; value: string; raw: string }>,
    rawPayload: string
  ): BallotReportData | ParseError {
    const metadata = new Map<string, string>();
    const unknownFields = new Set<string>();

    const knownStructuralFields = new Set([
      'ORIG', 'ORLC', 'PROC', 'DTPL', 'PLEI', 'TURN', 'FASE', 'UNFE',
      'MUNI', 'ZONA', 'SECA', 'AGRE', 'IDUE', 'IDCA', 'VERS', 'LOCA',
      'APTO', 'COMP', 'FALT', 'HBBM', 'HBBG', 'HBSB', 'DTAB', 'HRAB',
      'DTFC', 'HRFC', 'IDEL', 'CARG', 'TIPO', 'VERC', 'PART', 'NOMI',
      'LEGP', 'LEGC', 'BRAN', 'NULO', 'TOTC', 'TOTP', 'APTA', 'APTS',
      'APTT', 'HASH', 'ASSI', 'CERT', 'VRQR', 'HIQT', 'HICA'
    ]);

    let currentElectionPlei = '';
    let currentOfficeCode = '';
    let currentOfficeType: 'MAJORITARIO' | 'PROPORCIONAL' | 'CONSULTA' = 'MAJORITARIO';
    let currentPartyCode = '';

    const votes: BallotVote[] = [];

    for (const token of tokens) {
      // Coleta campos estruturais gerais
      if (/^[A-Z]+$/.test(token.key)) {
        if (!['CARG', 'PART', 'LEGP', 'LEGC', 'BRAN', 'NULO'].includes(token.key)) {
          metadata.set(token.key, token.value);
        }
        if (!knownStructuralFields.has(token.key)) {
          unknownFields.add(token.key);
        }
      }

      if (token.key === 'PLEI' && !currentElectionPlei) {
        currentElectionPlei = token.value;
      } else if (token.key === 'IDEL') {
        currentElectionPlei = token.value;
      } else if (token.key === 'CARG') {
        currentOfficeCode = token.value;
        currentPartyCode = '';
        const def = OFFICIAL_OFFICE_MAP[currentOfficeCode];
        currentOfficeType = def ? def.type : 'MAJORITARIO';
      } else if (token.key === 'TIPO') {
        if (token.value === '1') currentOfficeType = 'PROPORCIONAL';
        else if (token.value === '2') currentOfficeType = 'CONSULTA';
        else currentOfficeType = 'MAJORITARIO';
      } else if (token.key === 'PART') {
        if (token.value.includes(',')) {
          // Suporte legado sintético
          const [pNum, pQty] = token.value.split(',');
          const officeName = this.resolveOfficeName(currentOfficeCode);
          votes.push({
            officeCode: currentOfficeCode,
            officeName,
            officeType: currentOfficeType,
            partyNumber: pNum,
            type: 'LEGENDA',
            quantity: parseInt(pQty, 10),
            electionPlei: currentElectionPlei
          });
        } else {
          currentPartyCode = token.value;
        }
      } else if (token.key === 'LEGP') {
        // Votos de legenda para o partido atual
        const qty = parseInt(token.value, 10);
        if (!isNaN(qty) && qty > 0) {
          const officeName = this.resolveOfficeName(currentOfficeCode);
          votes.push({
            officeCode: currentOfficeCode,
            officeName,
            officeType: currentOfficeType,
            partyNumber: currentPartyCode,
            type: 'LEGENDA',
            quantity: qty,
            electionPlei: currentElectionPlei
          });
        }
      } else if (token.key === 'BRAN') {
        const qty = parseInt(token.value, 10);
        const officeName = this.resolveOfficeName(currentOfficeCode);
        votes.push({
          officeCode: currentOfficeCode,
          officeName,
          officeType: currentOfficeType,
          type: 'BRANCO',
          quantity: isNaN(qty) ? 0 : qty,
          electionPlei: currentElectionPlei
        });
      } else if (token.key === 'NULO') {
        const qty = parseInt(token.value, 10);
        const officeName = this.resolveOfficeName(currentOfficeCode);
        votes.push({
          officeCode: currentOfficeCode,
          officeName,
          officeType: currentOfficeType,
          type: 'NULO',
          quantity: isNaN(qty) ? 0 : qty,
          electionPlei: currentElectionPlei
        });
      } else if (token.key === 'NOMI' && token.value.includes(',')) {
        // Suporte legado sintético
        const [cNum, cQty] = token.value.split(',');
        const officeName = this.resolveOfficeName(currentOfficeCode);
        votes.push({
          officeCode: currentOfficeCode,
          officeName,
          officeType: currentOfficeType,
          candidateNumber: cNum,
          type: 'NOMINAL',
          quantity: parseInt(cQty, 10),
          electionPlei: currentElectionPlei
        });
      } else if (/^\d+$/.test(token.key)) {
        // Chave numérica pura = Voto Nominal em Candidato (<candidateNumber>:<votes>)
        const qty = parseInt(token.value, 10);
        const officeName = this.resolveOfficeName(currentOfficeCode);
        votes.push({
          officeCode: currentOfficeCode,
          officeName,
          officeType: currentOfficeType,
          candidateNumber: token.key,
          partyNumber: currentPartyCode || (token.key.length >= 2 ? token.key.substring(0, 2) : undefined),
          type: 'NOMINAL',
          quantity: isNaN(qty) ? 0 : qty,
          electionPlei: currentElectionPlei
        });
      }
    }

    // Verificação de campos obrigatórios mínimos de localização
    if (!metadata.has('MUNI') || !metadata.has('ZONA') || !metadata.has('SECA') || !metadata.has('IDUE')) {
      return {
        code: 'MISSING_FIELDS',
        message: 'Campos estruturais de identificação obrigatórios ausentes no Boletim de Urna (MUNI, ZONA, SECA ou IDUE).'
      };
    }

    // Validação da integridade de cada voto extraído
    for (const v of votes) {
      if (isNaN(v.quantity) || v.quantity < 0) {
        return {
          code: 'INVALID_VOTE_DATA',
          message: `Quantidade de votos inválida para ${v.officeName} (${v.type}).`,
          details: { officeCode: v.officeCode, type: v.type, quantity: v.quantity }
        };
      }
      if (v.type === 'NOMINAL' && !v.candidateNumber) {
        return {
          code: 'INVALID_VOTE_DATA',
          message: `Voto nominal sem número de candidato para ${v.officeName}.`,
          details: { officeCode: v.officeCode, type: v.type }
        };
      }
    }

    const aptoStr = metadata.get('APTO');
    const compStr = metadata.get('COMP');
    const faltStr = metadata.get('FALT');

    return {
      electionId: metadata.get('PLEI') || 'DESCONHECIDO',
      specificElectionId: metadata.get('IDEL') || undefined,
      roundNumber: parseInt(metadata.get('TURN') || '1', 10),
      stateCode: metadata.get('UNFE') || 'BR',
      cityCode: (metadata.get('MUNI') || '').padStart(5, '0'),
      zoneCode: metadata.get('ZONA') || '',
      sectionCode: metadata.get('SECA') || '',
      urnCode: metadata.get('IDUE') || '',
      vrqrVersion: metadata.get('VRQR') || this.version.replace('VRQR:', ''),
      hash: metadata.get('HASH') || '',
      signature: metadata.get('ASSI') || '',
      fase: metadata.get('FASE'),
      votes,
      apto: aptoStr && !isNaN(parseInt(aptoStr, 10)) ? parseInt(aptoStr, 10) : undefined,
      comp: compStr && !isNaN(parseInt(compStr, 10)) ? parseInt(compStr, 10) : undefined,
      falt: faltStr && !isNaN(parseInt(faltStr, 10)) ? parseInt(faltStr, 10) : undefined,
      warnings: unknownFields.size > 0 ? [`Campos opcionais não estruturais: ${Array.from(unknownFields).join(', ')}`] : [],
      rawPayload
    };
  }

  protected resolveOfficeName(code: string): string {
    const entry = OFFICIAL_OFFICE_MAP[code];
    return entry ? entry.name : `Cargo ${code}`;
  }

  protected validateSha512Hash(rawParts?: string[], providedHashHex?: string): 'VERIFIED' | 'INVALID' | 'UNAVAILABLE' {
    if (!providedHashHex) return 'UNAVAILABLE';
    if (!rawParts || rawParts.length === 0) return 'INVALID';

    // Algoritmo Criptográfico Oficial TSE:
    // 1. Ordena partes pelo índice QRBU:N:X
    const sortedParts = [...rawParts].sort((a, b) => {
      const idxA = parseInt(a.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
      const idxB = parseInt(b.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
      return idxA - idxB;
    });

    // 2. Remove o cabeçalho base "QRBU:N:X " e qualquer "VRQR:Y.Y " de todas as partes
    const processedParts = sortedParts.map((part, index) => {
      let processed = part.replace(/^QRBU:\d+:\d+\s+/, '').replace(/^VRQR:\S+\s+/, '');

      // 3. Apenas para a última parte, remove da chave " HASH:" (ou "HASH:") em diante
      if (index === sortedParts.length - 1) {
        const hashIdx = processed.indexOf(' HASH:');
        if (hashIdx !== -1) {
          processed = processed.substring(0, hashIdx);
        } else if (processed.startsWith('HASH:')) {
          processed = '';
        }
      }
      return processed;
    });

    // 4. Junta as partes com um único espaço e calcula o digest SHA-512
    const hashInput = processedParts.join(' ');
    const computedHash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();

    if (computedHash === providedHashHex.trim().toUpperCase()) {
      return 'VERIFIED';
    }

    return 'INVALID';
  }
}
