import { Tse2026QrToken } from './Tse2026QrTokenizer';
import { BallotReportData, ParseError } from '../index';

export class Tse2026SemanticParser {
  parse(tokens: Tse2026QrToken[]): BallotReportData | ParseError {
    const map = new Map<string, string>();
    const unknownFields: string[] = [];

    // Votos podem repetir a chave VOTO multiplas vezes, mas no QR TSE usual
    // a lista de votos vem agrupada ou iterada.
    // O padrão TSE comum para cargo é CARG:<codigo> seguido de PART:<num> ou NOMI:<cand>,<votos>
    // Vamos processar token a token, com estado de cargo atual.
    
    let currentOfficeCode = '';
    let currentPartyCode = '';
    const votes: any[] = [];

    for (const token of tokens) {
      if (/^[A-Z]+$/.test(token.key) && !['CARG', 'PART', 'LEGP', 'BRAN', 'NULO'].includes(token.key)) {
        map.set(token.key, token.value);
      }
      
      if (token.key === 'CARG') {
        currentOfficeCode = token.value;
        currentPartyCode = ''; // Reseta o partido ao mudar de cargo
      } else if (token.key === 'PART') {
        if (token.value.includes(',')) {
          // Fallback para testes sintéticos antigos
          const [part, partVotes] = token.value.split(',');
          if (part && partVotes) {
            votes.push({ officeName: `Cargo ${currentOfficeCode}`, partyNumber: part, type: 'LEGENDA', quantity: parseInt(partVotes, 10) });
          }
        } else {
          currentPartyCode = token.value;
        }
      } else if (token.key === 'NOMI') {
        // Fallback para testes sintéticos antigos
        const [cand, candVotes] = token.value.split(',');
        if (cand && candVotes) {
          votes.push({ officeName: `Cargo ${currentOfficeCode}`, candidateNumber: cand, type: 'NOMINAL', quantity: parseInt(candVotes, 10) });
        }
      } else if (token.key === 'LEGP') {
        // Voto de legenda
        votes.push({
          officeName: `Cargo ${currentOfficeCode}`,
          partyNumber: currentPartyCode,
          type: 'LEGENDA',
          quantity: parseInt(token.value, 10)
        });
      } else if (token.key === 'BRAN') {
        votes.push({ officeName: `Cargo ${currentOfficeCode}`, type: 'BRANCO', quantity: parseInt(token.value, 10) });
      } else if (token.key === 'NULO') {
        votes.push({ officeName: `Cargo ${currentOfficeCode}`, type: 'NULO', quantity: parseInt(token.value, 10) });
      } else if (/^\d+$/.test(token.key)) {
        // Se a chave for apenas números, é um candidato! (ex: 9202:1)
        votes.push({
          officeName: `Cargo ${currentOfficeCode}`,
          candidateNumber: token.key,
          partyNumber: currentPartyCode || token.key.substring(0, 2), // Em cargo majoritário, o partido são os 2 primeiros dígitos
          type: 'NOMINAL',
          quantity: parseInt(token.value, 10)
        });
      }
    }

    if (!map.has('MUNI') || !map.has('ZONA') || !map.has('SECA') || !map.has('IDUE')) {
      return { code: 'MISSING_FIELDS', message: 'Campos estruturais de identificação obrigatórios ausentes' };
    }

    return {
      electionId: map.get('PLEI') || 'DESCONHECIDO',
      roundNumber: parseInt(map.get('TURN') || '1', 10),
      stateCode: map.get('UNFE') || 'BR',
      cityCode: map.get('MUNI') || '',
      zoneCode: map.get('ZONA') || '',
      sectionCode: map.get('SECA') || '',
      urnCode: map.get('IDUE') || '',
      votes,
      hash: map.get('HASH') || '',
      signature: map.get('ASSI') || '',
      hashStatus: 'UNAVAILABLE',
      sigStatus: 'UNAVAILABLE',
      warnings: unknownFields.length > 0 ? [`Campos opcionais desconhecidos: ${unknownFields.join(', ')}`] : []
    };
  }
}
