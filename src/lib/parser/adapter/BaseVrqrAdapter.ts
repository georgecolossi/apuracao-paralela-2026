/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR BASE VRQR (TSE)
 * 
 * Implementação base estrita para leitura, validação criptográfica (SHA-512),
 * reconstrução fiel e interpretação semântica fail-closed de Boletins de Urna (BUs).
 */

import crypto from 'crypto';
import {
  QrBuAdapter,
  QrPartInfo,
  ParseError,
  BallotReportData,
  BallotVote
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

export function parseStrictNonNegativeInt(val: string | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < 0) return null;
  return num;
}

export abstract class BaseVrqrAdapter implements QrBuAdapter {
  abstract readonly version: string;
  abstract readonly supportedFormats: string[];
  abstract readonly description: string;

  /**
   * Valida se o cargo informado é permitido para a família de eleições do adaptador.
   * Pode ser sobrescrito por adaptadores com escopos específicos (ex: Municipais vs Gerais).
   */
  protected validateOfficeAllowed(_officeCode: string): boolean {
    return true;
  }

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

    // Preserva bytes e espaços internos, removendo apenas quebras de linha de ponta
    const sanitized = content.replace(/^[\r\n]+|[\r\n]+$/g, '');
    const match = sanitized.match(/^QRBU:(\d+):(\d+)\s*([\s\S]*)$/);
    if (!match) {
      return { code: 'INVALID_HEADER', message: 'Cabeçalho oficial QRBU ausente ou mal formatado.' };
    }

    const partIndex = parseStrictNonNegativeInt(match[1]);
    const totalParts = parseStrictNonNegativeInt(match[2]);
    const payload = match[3];

    if (partIndex === null || totalParts === null || partIndex < 1 || totalParts < 1 || partIndex > totalParts) {
      return {
        code: 'INVALID_PART_INDEX',
        message: `Índice de parte (${match[1]}) inconsistente com o total de partes (${match[2]}).`
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
      rawContent: sanitized
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

    // Ordenação estrita das partes por índice
    parsedList.sort((a, b) => a.index - b.index);

    // Concatenação preservando a separação exata sem duplicar espaços
    let reconstructed = '';
    for (let i = 0; i < parsedList.length; i++) {
      const cur = parsedList[i].payload.replace(/^[\r\n]+|[\r\n]+$/g, '');
      if (i === 0) {
        reconstructed = cur;
      } else {
        if (reconstructed.endsWith(' ') || cur.startsWith(' ')) {
          reconstructed = reconstructed + cur;
        } else {
          reconstructed = reconstructed + ' ' + cur;
        }
      }
    }

    return reconstructed;
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

    // Validação Criptográfica Prévia de Integridade (Hash SHA-512)
    // O envelope criptográfico deve ser validado antes do parse semântico dos votos
    // O hash oficial do BU situa-se ao final do envelope (último token HASH)
    const hashTokens = tokens.filter(t => t.key === 'HASH');
    const hashToken = hashTokens.length > 0 ? hashTokens[hashTokens.length - 1].value : undefined;
    const hashValidation = this.validateSha512Hash(rawParts, hashToken);
    if (hashValidation === 'INVALID') {
      return {
        code: 'INVALID_HASH',
        message: 'O hash criptográfico SHA-512 não confere com o conteúdo dos QR Codes do Boletim de Urna.',
        details: { calculated: 'MISMATCH', provided: hashToken }
      };
    }

    // Mapeamento semântico fail-closed
    const parsedDataOrError = this.parseSemanticTokens(tokens, fullPayload);
    if ('code' in parsedDataOrError) {
      return parsedDataOrError;
    }

    parsedDataOrError.hashStatus = hashValidation;

    // Validação da Assinatura Digital (ASSI)
    // As chaves públicas da urna eletrônica são disponibilizadas fora de banda pelo TSE.
    // Sem os certificados da cadeia da urna em tempo real, a assinatura é estritamente UNAVAILABLE.
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
      'APTT', 'HASH', 'ASSI', 'CERT', 'VRQR', 'HIQT', 'HICA',
      'DTEM', 'HREM', 'JUNT', 'TURM', 'MAJO', 'PROP'
    ]);

    type ParserState = 'HEADER' | 'IN_OFFICE' | 'BETWEEN_OFFICES' | 'IN_SUMMARY';
    let state: ParserState = 'HEADER';

    let currentElectionPlei = '';
    let currentOfficeCode = '';
    let currentOfficeName = '';
    let currentOfficeType: 'MAJORITARIO' | 'PROPORCIONAL' | 'CONSULTA' = 'MAJORITARIO';
    let currentPartyCode = '';

    const votes: BallotVote[] = [];
    const seenFieldsInOffice = new Set<string>();

    // Estrutura para conferência de totalizadores por cargo (TOTC vs soma dos votos)
    interface OfficeBlock {
      officeCode: string;
      officeName: string;
      expectedTotc?: number;
      votes: BallotVote[];
    }
    const officeBlocks: OfficeBlock[] = [];
    let currentBlock: OfficeBlock | null = null;

    // Estrutura para totalizadores globais do resumo do BU
    interface BuSummaryData {
      apta?: number;
      apts?: number;
      aptt?: number;
      nomi?: number;
      bran?: number;
      nulo?: number;
      totc?: number;
    }
    const summaryData: BuSummaryData = {};
    const seenSummaryFields = new Set<string>();

    const summaryAllowedKeys = new Set([
      'APTA', 'APTS', 'APTT', 'NOMI', 'LEGC', 'BRAN', 'NULO', 'TOTC',
      'HASH', 'ASSI', 'CERT', 'HIQT', 'HICA', 'IDEL', 'PLEI', 'VRQR', 'QRBU'
    ]);

    const closeCurrentOfficeBlock = (): ParseError | null => {
      if (!currentBlock) return null;
      if (currentBlock.expectedTotc === undefined) {
        return {
          code: 'INCOMPLETE_OFFICE_BLOCK',
          message: `Bloco de cargo incompleto: totalizador oficial (TOTC) ausente para o cargo ${currentBlock.officeName} (${currentBlock.officeCode}).`,
          details: { officeCode: currentBlock.officeCode, officeName: currentBlock.officeName }
        };
      }
      const sum = currentBlock.votes.reduce((acc, v) => acc + v.quantity, 0);
      if (sum !== currentBlock.expectedTotc) {
        return {
          code: 'VOTE_TOTAL_MISMATCH',
          message: `Inconsistência no cargo ${currentBlock.officeName} (${currentBlock.officeCode}): a soma dos votos apurados (${sum}) diverge do totalizador oficial (TOTC:${currentBlock.expectedTotc}).`,
          details: {
            officeCode: currentBlock.officeCode,
            calculatedSum: sum,
            expectedTotc: currentBlock.expectedTotc
          }
        };
      }
      return null;
    };

    for (const token of tokens) {
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
        // Se estiver em um cargo anterior, fecha e valida o bloco
        if (state === 'IN_OFFICE') {
          const err = closeCurrentOfficeBlock();
          if (err) return err;
        }

        if (!/^\d+$/.test(token.value)) {
          return {
            code: 'INVALID_OFFICE_CODE',
            message: `Código de cargo não numérico: '${token.value}'.`
          };
        }

        currentOfficeCode = token.value;
        currentPartyCode = '';
        currentOfficeName = this.resolveOfficeName(currentOfficeCode);

        const def = OFFICIAL_OFFICE_MAP[currentOfficeCode];
        currentOfficeType = def ? def.type : 'MAJORITARIO';

        if (!this.validateOfficeAllowed(currentOfficeCode)) {
          return {
            code: 'INVALID_OFFICE_FOR_LAYOUT',
            message: `O cargo '${currentOfficeName}' (${currentOfficeCode}) não é compatível com o layout ${this.version}.`
          };
        }

        currentBlock = {
          officeCode: currentOfficeCode,
          officeName: currentOfficeName,
          votes: []
        };
        officeBlocks.push(currentBlock);
        seenFieldsInOffice.clear();
        state = 'IN_OFFICE';
      } else if (token.key === 'TIPO') {
        if (token.value === '1') currentOfficeType = 'PROPORCIONAL';
        else if (token.value === '2') currentOfficeType = 'CONSULTA';
        else currentOfficeType = 'MAJORITARIO';
      } else if (token.key === 'TOTC') {
        const totc = parseStrictNonNegativeInt(token.value);
        if (totc === null) {
          return {
            code: 'INVALID_VOTE_DATA',
            message: `Totalizador de votos (TOTC) inválido: '${token.value}'.`
          };
        }

        if (state === 'HEADER' || state === 'BETWEEN_OFFICES') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Totalizador de votos (TOTC) encontrado fora de um cargo ativo e fora do bloco de resumo do BU.'
          };
        }

        if (state === 'IN_SUMMARY') {
          if (seenSummaryFields.has('TOTC')) {
            return {
              code: 'DUPLICATE_SUMMARY_FIELD',
              message: 'Totalizador geral de votos (TOTC) duplicado no bloco de resumo do BU.'
            };
          }
          seenSummaryFields.add('TOTC');
          summaryData.totc = totc;
          metadata.set('SUMMARY_TOTC', token.value);
          continue;
        }

        // state === 'IN_OFFICE'
        if (seenFieldsInOffice.has('TOTC')) {
          return {
            code: 'DUPLICATE_OFFICE_FIELD',
            message: `Totalizador (TOTC) duplicado no mesmo cargo (${currentOfficeName}).`
          };
        }
        seenFieldsInOffice.add('TOTC');

        if (currentBlock) {
          currentBlock.expectedTotc = totc;
          const err = closeCurrentOfficeBlock();
          if (err) return err;
          // Cargo finalizado com sucesso pelo seu totalizador TOTC
          currentBlock = null;
          currentOfficeCode = '';
          currentPartyCode = '';
          seenFieldsInOffice.clear();
          state = 'BETWEEN_OFFICES';
        }
      } else if (token.key === 'APTA' || token.key === 'APTS' || token.key === 'APTT') {
        // Marcador de totalizadores gerais do BU ou resumo eleitoral
        if (state === 'IN_OFFICE') {
          // Dentro do cargo, o TSE registra os aptos intermediários antes do encerramento
          metadata.set(token.key, token.value);
        } else if (state === 'HEADER') {
          // No cabeçalho antes do primeiro cargo, registra os eleitores aptos da seção
          metadata.set(token.key, token.value);
        } else {
          // Fora de cargo ativo (BETWEEN_OFFICES ou IN_SUMMARY), transita formalmente para o bloco de resumo global do BU
          state = 'IN_SUMMARY';
          if (seenSummaryFields.has(token.key)) {
            return {
              code: 'DUPLICATE_SUMMARY_FIELD',
              message: `Campo de eleitores aptos (${token.key}) duplicado no resumo do BU.`
            };
          }
          seenSummaryFields.add(token.key);
          const parsedVal = parseStrictNonNegativeInt(token.value);
          if (parsedVal !== null) {
            if (token.key === 'APTA') summaryData.apta = parsedVal;
            if (token.key === 'APTS') summaryData.apts = parsedVal;
            if (token.key === 'APTT') summaryData.aptt = parsedVal;
          }
          metadata.set(`SUMMARY_${token.key}`, token.value);
        }
      } else if (token.key === 'PART') {
        if (state !== 'IN_OFFICE') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Identificador de partido (PART) encontrado fora do bloco de cargo.'
          };
        }
        if (token.value.includes(',')) {
          // Suporte legado sintético: PART:<num>,<qty>
          const [pNum, pQtyStr] = token.value.split(',');
          const pQty = parseStrictNonNegativeInt(pQtyStr);
          if (!/^\d+$/.test(pNum) || pQty === null) {
            return {
              code: 'INVALID_VOTE_DATA',
              message: `Dados inválidos de legenda partidária: '${token.value}'.`
            };
          }
          const v: BallotVote = {
            officeCode: currentOfficeCode,
            officeName: currentOfficeName,
            officeType: currentOfficeType,
            partyNumber: pNum,
            type: 'LEGENDA',
            quantity: pQty,
            electionPlei: currentElectionPlei
          };
          votes.push(v);
          if (currentBlock) currentBlock.votes.push(v);
        } else {
          if (!/^\d+$/.test(token.value)) {
            return { code: 'INVALID_VOTE_DATA', message: `Número de partido inválido: '${token.value}'.` };
          }
          currentPartyCode = token.value;
        }
      } else if (token.key === 'LEGP') {
        if (state !== 'IN_OFFICE') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Voto de legenda (LEGP) encontrado fora do bloco de cargo.'
          };
        }
        const qty = parseStrictNonNegativeInt(token.value);
        if (qty === null) {
          return { code: 'INVALID_VOTE_DATA', message: `Quantidade de votos de legenda inválida: '${token.value}'.` };
        }
        if (qty > 0) {
          const v: BallotVote = {
            officeCode: currentOfficeCode,
            officeName: currentOfficeName,
            officeType: currentOfficeType,
            partyNumber: currentPartyCode || undefined,
            type: 'LEGENDA',
            quantity: qty,
            electionPlei: currentElectionPlei
          };
          votes.push(v);
          if (currentBlock) currentBlock.votes.push(v);
        }
      } else if (token.key === 'LEGC') {
        const parsedVal = parseStrictNonNegativeInt(token.value);
        if (parsedVal === null) {
          return { code: 'INVALID_VOTE_DATA', message: `Quantidade de legenda consolidada (LEGC) inválida: '${token.value}'.` };
        }
        if (state === 'IN_OFFICE') {
          metadata.set(`LEGC_${currentOfficeCode}`, token.value);
          metadata.set('LEGC', token.value);
        } else if (state === 'IN_SUMMARY') {
          metadata.set('SUMMARY_LEGC', token.value);
        } else {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Totalizador de legenda consolidada (LEGC) encontrado fora do bloco de cargo e fora do resumo do BU.'
          };
        }
      } else if (token.key === 'BRAN') {
        const qty = parseStrictNonNegativeInt(token.value);
        if (qty === null) {
          return { code: 'INVALID_VOTE_DATA', message: `Quantidade de votos em branco inválida: '${token.value}'.` };
        }
        if (state === 'HEADER') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Token de votos em branco (BRAN) encontrado antes do identificador de cargo (CARG).'
          };
        }
        if (state === 'BETWEEN_OFFICES') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Token de votos em branco (BRAN) encontrado fora de um cargo ativo e fora do bloco de resumo global do BU.'
          };
        }
        if (state === 'IN_SUMMARY') {
          if (seenSummaryFields.has('BRAN')) {
            return {
              code: 'DUPLICATE_SUMMARY_FIELD',
              message: 'Votos em branco (BRAN) informados mais de uma vez no bloco de resumo do BU.'
            };
          }
          seenSummaryFields.add('BRAN');
          summaryData.bran = qty;
          metadata.set('SUMMARY_BRAN', token.value);
          continue;
        }

        // state === 'IN_OFFICE'
        if (seenFieldsInOffice.has('BRAN')) {
          return {
            code: 'DUPLICATE_OFFICE_FIELD',
            message: `Votos em branco (BRAN) duplicados no mesmo cargo (${currentOfficeName}).`
          };
        }
        seenFieldsInOffice.add('BRAN');

        const v: BallotVote = {
          officeCode: currentOfficeCode,
          officeName: currentOfficeName,
          officeType: currentOfficeType,
          type: 'BRANCO',
          quantity: qty,
          electionPlei: currentElectionPlei
        };
        votes.push(v);
        if (currentBlock) currentBlock.votes.push(v);
      } else if (token.key === 'NULO') {
        const qty = parseStrictNonNegativeInt(token.value);
        if (qty === null) {
          return { code: 'INVALID_VOTE_DATA', message: `Quantidade de votos nulos inválida: '${token.value}'.` };
        }
        if (state === 'HEADER') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Token de votos nulos (NULO) encontrado antes do identificador de cargo (CARG).'
          };
        }
        if (state === 'BETWEEN_OFFICES') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: 'Token de votos nulos (NULO) encontrado fora de um cargo ativo e fora do bloco de resumo global do BU.'
          };
        }
        if (state === 'IN_SUMMARY') {
          if (seenSummaryFields.has('NULO')) {
            return {
              code: 'DUPLICATE_SUMMARY_FIELD',
              message: 'Votos nulos (NULO) informados mais de uma vez no bloco de resumo do BU.'
            };
          }
          seenSummaryFields.add('NULO');
          summaryData.nulo = qty;
          metadata.set('SUMMARY_NULO', token.value);
          continue;
        }

        // state === 'IN_OFFICE'
        if (seenFieldsInOffice.has('NULO')) {
          return {
            code: 'DUPLICATE_OFFICE_FIELD',
            message: `Votos nulos (NULO) duplicados no mesmo cargo (${currentOfficeName}).`
          };
        }
        seenFieldsInOffice.add('NULO');

        const v: BallotVote = {
          officeCode: currentOfficeCode,
          officeName: currentOfficeName,
          officeType: currentOfficeType,
          type: 'NULO',
          quantity: qty,
          electionPlei: currentElectionPlei
        };
        votes.push(v);
        if (currentBlock) currentBlock.votes.push(v);
      } else if (token.key === 'NOMI') {
        if (token.value.includes(',')) {
          // Suporte legado sintético: NOMI:<num>,<qty>
          if (state !== 'IN_OFFICE') {
            return {
              code: 'DISPLACED_VOTE_TOKEN',
              message: 'Voto nominal (NOMI) encontrado fora do bloco de cargo.'
            };
          }
          const [cNum, cQtyStr] = token.value.split(',');
          const cQty = parseStrictNonNegativeInt(cQtyStr);
          if (!/^\d+$/.test(cNum) || cQty === null) {
            return { code: 'INVALID_VOTE_DATA', message: `Dados de voto nominal inválidos: '${token.value}'.` };
          }
          const v: BallotVote = {
            officeCode: currentOfficeCode,
            officeName: currentOfficeName,
            officeType: currentOfficeType,
            candidateNumber: cNum,
            type: 'NOMINAL',
            quantity: cQty,
            electionPlei: currentElectionPlei
          };
          votes.push(v);
          if (currentBlock) currentBlock.votes.push(v);
        } else {
          // Total de votos nominais (resumo do cargo ou resumo geral)
          const qty = parseStrictNonNegativeInt(token.value);
          if (qty === null) {
            return { code: 'INVALID_VOTE_DATA', message: `Quantidade total de votos nominais inválida: '${token.value}'.` };
          }
          if (state === 'IN_OFFICE') {
            // No cargo, NOMI:<total> é o totalizador nominal do cargo
            metadata.set(`NOMI_${currentOfficeCode}`, token.value);
          } else if (state === 'IN_SUMMARY') {
            if (seenSummaryFields.has('NOMI')) {
              return {
                code: 'DUPLICATE_SUMMARY_FIELD',
                message: 'Total de votos nominais (NOMI) duplicado no bloco de resumo do BU.'
              };
            }
            seenSummaryFields.add('NOMI');
            summaryData.nomi = qty;
            metadata.set('SUMMARY_NOMI', token.value);
          } else {
            return {
              code: 'DISPLACED_VOTE_TOKEN',
              message: 'Totalizador de votos nominais (NOMI) encontrado fora de um cargo ativo e fora do resumo do BU.'
            };
          }
        }
      } else if (/^\d+$/.test(token.key)) {
        // Chave numérica pura = Voto Nominal em Candidato (<candidateNumber>:<votes>)
        if (state !== 'IN_OFFICE') {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: `Voto no candidato ${token.key} encontrado fora do bloco de cargo.`
          };
        }
        const qty = parseStrictNonNegativeInt(token.value);
        if (qty === null) {
          return { code: 'INVALID_VOTE_DATA', message: `Quantidade inválida de votos para o candidato ${token.key}: '${token.value}'.` };
        }
        const v: BallotVote = {
          officeCode: currentOfficeCode,
          officeName: currentOfficeName,
          officeType: currentOfficeType,
          candidateNumber: token.key,
          partyNumber: currentPartyCode || (token.key.length >= 2 ? token.key.substring(0, 2) : undefined),
          type: 'NOMINAL',
          quantity: qty,
          electionPlei: currentElectionPlei
        };
        votes.push(v);
        if (currentBlock) currentBlock.votes.push(v);
      } else if (state === 'IN_SUMMARY') {
        // Verificação estrita de gramática no bloco de resumo
        if (!summaryAllowedKeys.has(token.key)) {
          return {
            code: 'DISPLACED_VOTE_TOKEN',
            message: `Token '${token.key}' não permitido na gramática do bloco de resumo do BU.`
          };
        }
      }
    }

    // Fecha e valida o último bloco de cargo se ainda estiver pendente
    const finalBlockErr = closeCurrentOfficeBlock();
    if (finalBlockErr) return finalBlockErr;

    // Conferência de consistência do bloco de resumo global do BU se completo
    if (summaryData.totc !== undefined && summaryData.nomi !== undefined && summaryData.bran !== undefined && summaryData.nulo !== undefined) {
      const summarySum = summaryData.nomi + summaryData.bran + summaryData.nulo;
      if (summarySum !== summaryData.totc) {
        return {
          code: 'SUMMARY_TOTAL_MISMATCH',
          message: `Inconsistência no bloco de resumo do BU: a soma dos totais (NOMI:${summaryData.nomi} + BRAN:${summaryData.bran} + NULO:${summaryData.nulo} = ${summarySum}) diverge do totalizador geral oficial (TOTC:${summaryData.totc}).`,
          details: {
            calculatedSum: summarySum,
            expectedTotc: summaryData.totc,
            summaryData
          }
        };
      }
    }

    // Verificação estrita de identificadores essenciais (Sem fallbacks silenciosos)
    const plei = metadata.get('PLEI');
    if (!plei || plei.trim() === '') {
      return {
        code: 'MISSING_FIELDS',
        message: 'Identificador obrigatório do pleito (PLEI) ausente no Boletim de Urna.'
      };
    }

    const turnStr = metadata.get('TURN');
    if (!turnStr || !/^[1-9]\d*$/.test(turnStr.trim())) {
      return {
        code: 'INVALID_ROUND_NUMBER',
        message: `Número do turno (TURN) ausente ou inválido no Boletim de Urna: '${turnStr}'.`
      };
    }

    const unfe = metadata.get('UNFE');
    if (!unfe || !/^[A-Z]{2}$/.test(unfe.trim())) {
      return {
        code: 'INVALID_UF_CODE',
        message: `Identificador da UF (UNFE) ausente ou inválido no Boletim de Urna: '${unfe}'.`
      };
    }

    const muni = metadata.get('MUNI');
    const zona = metadata.get('ZONA');
    const seca = metadata.get('SECA');
    const idue = metadata.get('IDUE');

    if (!muni || !zona || !seca || !idue) {
      return {
        code: 'MISSING_FIELDS',
        message: 'Campos estruturais de identificação obrigatórios ausentes no Boletim de Urna (MUNI, ZONA, SECA ou IDUE).'
      };
    }

    if (!/^\d+$/.test(muni.trim()) || !/^\d+$/.test(zona.trim()) || !/^\d+$/.test(seca.trim()) || !/^\d+$/.test(idue.trim())) {
      return {
        code: 'INVALID_IDENTIFIERS',
        message: 'Campos de identificação geográfica contêm formato inválido (MUNI, ZONA, SECA, IDUE devem ser numéricos).'
      };
    }

    const fase = metadata.get('FASE');
    if (!fase || !/^[A-Z]$/.test(fase.trim())) {
      return {
        code: 'MISSING_FIELDS',
        message: 'Identificador de fase da eleição (FASE) ausente ou inválido no Boletim de Urna.'
      };
    }

    // Validação de dados de comparecimento e abstenção se informados
    const apto = parseStrictNonNegativeInt(metadata.get('APTO'));
    const comp = parseStrictNonNegativeInt(metadata.get('COMP'));
    const falt = parseStrictNonNegativeInt(metadata.get('FALT'));

    if (apto !== null && comp !== null && falt !== null) {
      if (apto !== comp + falt) {
        unknownFields.add(`DIVERGENCIA_COMPARECIMENTO:APTO(${apto})!=COMP(${comp})+FALT(${falt})`);
      }
    }

    return {
      electionId: plei.trim(),
      specificElectionId: metadata.get('IDEL') || undefined,
      roundNumber: parseInt(turnStr.trim(), 10),
      stateCode: unfe.trim(),
      cityCode: muni.trim().padStart(5, '0'),
      zoneCode: zona.trim(),
      sectionCode: seca.trim(),
      urnCode: idue.trim(),
      vrqrVersion: metadata.get('VRQR') || this.version.replace('VRQR:', ''),
      hash: metadata.get('HASH') || '',
      signature: metadata.get('ASSI') || '',
      fase: fase.trim(),
      votes,
      metadata: Object.fromEntries(metadata),
      apto: apto !== null ? apto : undefined,
      comp: comp !== null ? comp : undefined,
      falt: falt !== null ? falt : undefined,
      warnings: unknownFields.size > 0 ? Array.from(unknownFields) : [],
      rawPayload
    };
  }

  protected resolveOfficeName(code: string): string {
    const entry = OFFICIAL_OFFICE_MAP[code];
    return entry ? entry.name : `Cargo ${code}`;
  }

  protected validateSha512Hash(
    rawParts?: string[],
    providedHashHex?: string
  ): 'VERIFIED' | 'INVALID' | 'UNAVAILABLE' {
    if (!providedHashHex || providedHashHex.trim() === '') {
      return 'UNAVAILABLE';
    }

    const trimmedHash = providedHashHex.trim();

    // SHA-512 oficial do TSE tem exatamente 128 caracteres hexadecimais
    if (!/^[0-9A-Fa-f]{128}$/.test(trimmedHash)) {
      return 'INVALID';
    }

    if (!rawParts || rawParts.length === 0) {
      return 'INVALID';
    }

    // Algoritmo Criptográfico Oficial TSE:
    // 1. Ordena partes pelo índice QRBU:N:X
    const sortedParts = [...rawParts].sort((a, b) => {
      const idxA = parseInt(a.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
      const idxB = parseInt(b.match(/^QRBU:(\d+):/)?.[1] || '0', 10);
      return idxA - idxB;
    });

    // 2. Remove o envelope "QRBU:N:X " e eventual "VRQR:Y.Y " no início de cada parte
    const processedParts = sortedParts.map((part, index) => {
      let processed = part.replace(/^QRBU:\d+:\d+\s+(VRQR:\S+\s+)?/, '');

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

    const computedBuf = Buffer.from(computedHash, 'utf8');
    const providedBuf = Buffer.from(trimmedHash.toUpperCase(), 'utf8');

    if (computedBuf.length === providedBuf.length && crypto.timingSafeEqual(computedBuf, providedBuf)) {
      return 'VERIFIED';
    }

    return 'INVALID';
  }
}
