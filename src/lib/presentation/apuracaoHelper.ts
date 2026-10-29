export interface TotalItem {
  officeId?: string;
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
  officeIdentifier: string | null | undefined,
  allTotals: TotalItem[],
  officeNameFallback?: string
) {
  let officeVotes: TotalItem[] = [];
  const hasExplicitNameFallback = typeof officeNameFallback === 'string' && officeNameFallback.trim().length > 0;
  const hasIdentifier = typeof officeIdentifier === 'string' && officeIdentifier.trim().length > 0;
  let displayOfficeName = (hasExplicitNameFallback ? officeNameFallback : '') || (hasIdentifier ? officeIdentifier! : '');

  if (hasExplicitNameFallback && hasIdentifier && officeIdentifier !== officeNameFallback) {
    // 1. Quando a chamada fornecer officeId explicitamente (ex: UI universal com officeId e officeName distintos):
    // Filtra EXCLUSIVAMENTE por officeId. Se não houver votos com esse ID, permanece vazio sem recorrer ao nome!
    officeVotes = allTotals.filter(t => t.officeId && t.officeId === officeIdentifier);
    displayOfficeName = officeNameFallback!;
  } else if (!hasIdentifier) {
    // 2. Chamadas legadas que realmente não forneçam um ID (officeIdentifier nulo, indefinido ou vazio):
    // Recorre ao nome fornecido em officeNameFallback, recusando agregação ambígua
    const targetName = (hasExplicitNameFallback ? officeNameFallback : '') || '';
    if (targetName) {
      displayOfficeName = targetName;
      const matchingItems = allTotals.filter(t => t.officeName === targetName);
      const distinctOfficeIds = new Set(
        matchingItems.map(t => t.officeId || t.officeName)
      );
      if (distinctOfficeIds.size === 1) {
        officeVotes = matchingItems;
      } else {
        // Múltiplos cargos compartilham o mesmo nome sem identidade inequívoca (ou nenhum encontrado)
        officeVotes = [];
      }
    } else {
      officeVotes = [];
    }
  } else {
    // 3. Apenas officeIdentifier fornecido (ou officeIdentifier === officeNameFallback):
    const hasMatchingOfficeId = allTotals.some(t => t.officeId && t.officeId === officeIdentifier);
    const hasMatchingOfficeName = allTotals.some(t => t.officeName === officeIdentifier);

    if (hasMatchingOfficeId && !hasMatchingOfficeName) {
      // Inequivocamente um officeId: filtra exclusivamente por esse ID sem fallback
      officeVotes = allTotals.filter(t => t.officeId && t.officeId === officeIdentifier);
      displayOfficeName = officeVotes[0]?.officeName || officeIdentifier!;
    } else if (hasMatchingOfficeName) {
      // Chamada legada por nome: só aceita se houver correspondência inequívoca
      const targetName = officeIdentifier!;
      displayOfficeName = targetName;
      const matchingItems = allTotals.filter(t => t.officeName === targetName);
      const distinctOfficeIds = new Set(
        matchingItems.map(t => t.officeId || t.officeName)
      );
      if (distinctOfficeIds.size === 1) {
        officeVotes = matchingItems;
      } else {
        // Múltiplos cargos homônimos sem identificador inequívoco: recusa agregação
        officeVotes = [];
      }
    } else {
      // Nenhum registro encontrado por officeId ou officeName
      officeVotes = [];
      displayOfficeName = officeIdentifier!;
    }
  }
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
    const destiny = classifyVotePresentation(pleito, turno, displayOfficeName, v.voteType, v.candidateNumber, hasResolvedName);
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
  const isT2Presidente = (String(turno) === '2' || turno === 2) && displayOfficeName === 'Presidente';
  const candidates = Array.from(candidateMap.values())
    .filter(c => c.quantity > 0 || isT2Presidente || Boolean(c.candidateName && c.candidateName.trim().length > 0))
    .sort((a, b) => {
      const votesDiff = b.quantity - a.quantity;
      if (votesDiff !== 0) return votesDiff;
      const numA = parseInt(a.candidateNumber, 10) || 0;
      const numB = parseInt(b.candidateNumber, 10) || 0;
      return numA - numB;
    });
  const legendas = Array.from(legendaMap.values())
    .filter(l => l.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  return { candidates, legendas, brancos, nulos, nulosTecnicos, pendentes, totalValidos: validosNominais + validosLegenda, validosNominais, validosLegenda, totalGeral };
}