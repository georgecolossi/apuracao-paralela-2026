export interface TotalItem {
  officeName: string;
  candidateNumber?: string | null;
  partyNumber?: string | null;
  voteType: string;
  quantity: number;
  metadataStatus?: string;
  candidateName?: string;
  partyAbbreviation?: string;
}
export type VoteDestiny = 'CANDIDATO_VALIDO' | 'LEGENDA' | 'BRANCO' | 'NULO' | 'NULO_TECNICO' | 'PENDENTE_CLASSIFICACAO';
export function classifyVotePresentation(
  pleito: string | null | undefined,
  turno: number | null | undefined,
  officeName: string,
  voteType: string,
  candidateNumber: string | null | undefined,
  hasResolvedName: boolean
): VoteDestiny {
  if (voteType === 'BRANCO') return 'BRANCO';
  if (voteType === 'NULO') return 'NULO';
  if (voteType === 'LEGENDA') return 'LEGENDA';
  if (voteType === 'NOMINAL') {
    if (String(pleito) === '3220' && String(turno) === '1' && officeName === 'Presidente' && candidateNumber === '28') {
      return 'NULO_TECNICO';
    }
    if (hasResolvedName) {
      return 'CANDIDATO_VALIDO';
    }
    return 'PENDENTE_CLASSIFICACAO';
  }
  return 'PENDENTE_CLASSIFICACAO';
}
export interface CandidateDisplay {
  candidateNumber: string;
  partyNumber: string;
  quantity: number;
  candidateName?: string;
  partyAbbreviation?: string;
}
export interface LegendaDisplay {
  partyNumber: string;
  partyAbbreviation?: string;
  quantity: number;
}
export function getOfficeDataAggregate(
  pleito: string | null | undefined,
  turno: number | null | undefined,
  officeName: string,
  allTotals: TotalItem[]
) {
  const officeVotes = allTotals.filter(t => t.officeName === officeName);
  let totalGeral = 0;
  let validosNominais = 0;
  let validosLegenda = 0;
  let brancos = 0;
  let nulos = 0;
  let nulosTecnicos = 0;
  let pendentes = 0;
  const candidateMap = new Map<string, CandidateDisplay>();
  const legendaMap = new Map<string, LegendaDisplay>();
  for (const v of officeVotes) {
    totalGeral += v.quantity;
    const hasResolvedName = Boolean(v.candidateName && v.candidateName.trim().length > 0);
    const destiny = classifyVotePresentation(pleito, turno, officeName, v.voteType, v.candidateNumber, hasResolvedName);
    switch (destiny) {
      case 'BRANCO':
        brancos += v.quantity;
        break;
      case 'NULO':
        nulos += v.quantity;
        break;
      case 'NULO_TECNICO':
        nulosTecnicos += v.quantity;
        break;
      case 'PENDENTE_CLASSIFICACAO':
        pendentes += v.quantity;
        break;
      case 'LEGENDA':
        validosLegenda += v.quantity;
        const legKey = 'LEG_' + v.partyNumber;
        const legExisting = legendaMap.get(legKey);
        if (legExisting) {
          legExisting.quantity += v.quantity;
        } else {
          legendaMap.set(legKey, {
            partyNumber: v.partyNumber || '-',
            partyAbbreviation: v.partyAbbreviation,
            quantity: v.quantity
          });
        }
        break;
      case 'CANDIDATO_VALIDO':
        validosNominais += v.quantity;
        const nomKey = 'NOM_' + v.candidateNumber;
        const nomExisting = candidateMap.get(nomKey);
        if (nomExisting) {
          nomExisting.quantity += v.quantity;
        } else {
          candidateMap.set(nomKey, {
            candidateNumber: v.candidateNumber || '-',
            partyNumber: v.partyNumber || '-',
            quantity: v.quantity,
            candidateName: v.candidateName,
            partyAbbreviation: v.partyAbbreviation
          });
        }
        break;
    }
  }
  const candidates = Array.from(candidateMap.values())
    .filter(c => c.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  const legendas = Array.from(legendaMap.values())
    .filter(l => l.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  return { candidates, legendas, brancos, nulos, nulosTecnicos, pendentes, totalValidos: validosNominais + validosLegenda, totalGeral };
}