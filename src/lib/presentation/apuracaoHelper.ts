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

export function getOfficeDataAggregate(officeName: string, allTotals: TotalItem[]) {
  const officeVotes = allTotals.filter(t => t.officeName === officeName);
  
  let validos = 0;
  let brancos = 0;
  let nulos = 0;
  
  const candidateMap = new Map<string, any>();

  for (const v of officeVotes) {
    if (v.voteType === 'BRANCO') brancos += v.quantity;
    else if (v.voteType === 'NULO') nulos += v.quantity;
    else if (v.voteType === 'NOMINAL' || v.voteType === 'LEGENDA') {
      validos += v.quantity;
      const key = v.voteType === 'LEGENDA' ? `LEG_${v.partyNumber}` : `NOM_${v.candidateNumber}`;
      
      const existing = candidateMap.get(key);
      if (existing) {
        existing.quantity += v.quantity;
      } else {
        candidateMap.set(key, {
          candidateNumber: v.voteType === 'LEGENDA' ? `Legenda ${v.partyNumber}` : (v.candidateNumber || '-'),
          partyNumber: v.partyNumber || '-',
          quantity: v.quantity,
          candidateName: v.candidateName,
          partyAbbreviation: v.partyAbbreviation,
          metadataStatus: v.metadataStatus,
          voteType: v.voteType
        });
      }
    }
  }
  
  const totalGeral = validos + brancos + nulos;
  
  // O filtro aqui garante que itens com 0 votos não poluam a lista visual.
  // Notavelmente, `validos`, `brancos`, `nulos` e `totalGeral` já foram
  // calculados com base no array bruto original (independente do filtro).
  const candidates = Array.from(candidateMap.values())
    .filter(c => c.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  
  return { candidates, brancos, nulos, totalValidos: validos, totalGeral };
}
