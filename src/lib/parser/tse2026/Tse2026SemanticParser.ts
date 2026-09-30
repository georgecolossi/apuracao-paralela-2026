import { Tse2026QrToken } from './Tse2026QrTokenizer';
import { BallotReportData, ParseError } from '../index';

export class Tse2026SemanticParser {
  parse(tokens: Tse2026QrToken[]): BallotReportData | ParseError {
    const map = new Map<string, string>();
    const unknownFields = new Set<string>();
    
    // Known structural fields in TSE 2026
    const knownFields = [
      'ORIG', 'ORLC', 'PROC', 'DTPL', 'PLEI', 'TURN', 'FASE', 'UNFE', 
      'MUNI', 'ZONA', 'SECA', 'AGRE', 'IDUE', 'IDCA', 'VERS', 'LOCA', 
      'APTO', 'COMP', 'FALT', 'HBBM', 'HBBG', 'HBSB', 'DTAB', 'HRAB', 
      'DTFC', 'HRFC', 'IDEL', 'CARG', 'TIPO', 'VERC', 'PART', 'NOMI', 
      'LEGP', 'BRAN', 'NULO', 'TOTC', 'APTA', 'APTS', 'APTT', 'HASH', 
      'ASSI', 'CERT', 'VRQR'
    ];

    let currentOfficeCode = '';
    let currentPartyCode = '';
    const votes: any[] = [];

    for (const token of tokens) {
      if (/^[A-Z]+$/.test(token.key)) {
        if (!['CARG', 'PART', 'LEGP', 'BRAN', 'NULO'].includes(token.key)) {
          map.set(token.key, token.value);
        }
        
        if (!knownFields.includes(token.key)) {
          unknownFields.add(token.key);
        }
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
          partyNumber: currentPartyCode ? currentPartyCode : undefined,
          type: 'NOMINAL',
          quantity: parseInt(token.value, 10)
        });
      }
    }

    if (!map.has('MUNI') || !map.has('ZONA') || !map.has('SECA') || !map.has('IDUE')) {
      return { code: 'MISSING_FIELDS', message: 'Campos estruturais de identificação obrigatórios ausentes' };
    }

    const validVotes = [];
    for (const v of votes) {
      if (isNaN(v.quantity) || v.quantity < 0) continue;
      if (v.type === 'NOMINAL' && !v.candidateNumber) continue;
      if (v.type === 'LEGENDA' && !v.partyNumber) continue;
      validVotes.push(v);
    }

    return {
      electionId: map.get('PLEI') || 'DESCONHECIDO',
      roundNumber: parseInt(map.get('TURN') || '1', 10),
      stateCode: map.get('UNFE') || 'BR',
      cityCode: map.get('MUNI') || '',
      zoneCode: map.get('ZONA') || '',
      sectionCode: map.get('SECA') || '',
      urnCode: map.get('IDUE') || '',
      votes: validVotes,
      hash: map.get('HASH') || '',
      signature: map.get('ASSI') || '',
      hashStatus: 'UNAVAILABLE',
      sigStatus: 'UNAVAILABLE',
      warnings: unknownFields.size > 0 ? [`Campos opcionais desconhecidos: ${Array.from(unknownFields).join(', ')}`] : []
    };
  }
}
