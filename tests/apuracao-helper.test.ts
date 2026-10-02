import { describe, it, expect } from 'vitest';
import { getOfficeDataAggregate, TotalItem } from '../src/lib/presentation/apuracaoHelper';

describe('Apuração Helper - Filtro Visual', () => {
  it('deve ocultar candidatos com quantity <= 0, preservando a matemática', () => {
    const rawTotals: TotalItem[] = [
      { officeName: 'Deputado', voteType: 'NOMINAL', candidateNumber: '94001', partyNumber: '94', quantity: 5 },
      { officeName: 'Deputado', voteType: 'NOMINAL', candidateNumber: '95001', partyNumber: '95', quantity: 0 },
      { officeName: 'Deputado', voteType: 'LEGENDA', candidateNumber: null, partyNumber: '92', quantity: 0 },
      { officeName: 'Deputado', voteType: 'LEGENDA', candidateNumber: null, partyNumber: '94', quantity: -1 }, // Cenário atípico, omitido visualmente
      { officeName: 'Deputado', voteType: 'BRANCO', candidateNumber: null, partyNumber: null, quantity: 2 },
      { officeName: 'Deputado', voteType: 'NULO', candidateNumber: null, partyNumber: null, quantity: 1 }
    ];

    // O original não deve ser alterado
    const rawTotalsLengthAntes = rawTotals.length;

    const result = getOfficeDataAggregate('Deputado', rawTotals);

    // O array recebido não foi modificado
    expect(rawTotals.length).toBe(rawTotalsLengthAntes);

    // Os cálculos da eleição permanecem inalterados! 
    // Nominais (5 + 0) + Legenda (0 + (-1)) = 4
    expect(result.totalValidos).toBe(4);
    expect(result.brancos).toBe(2);
    expect(result.nulos).toBe(1);
    expect(result.totalGeral).toBe(7);

    // Somente o que tem quantity > 0 deve aparecer no visual
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].candidateNumber).toBe('94001');
    expect(result.candidates[0].quantity).toBe(5);

    // quantity = 0 é omitido visualmente
    expect(result.candidates.find(c => c.candidateNumber === '95001')).toBeUndefined();
    // quantity <= 0 (ex: -1) é omitido visualmente
    expect(result.candidates.find(c => c.candidateNumber === 'Legenda 94')).toBeUndefined();
    expect(result.candidates.find(c => c.candidateNumber === 'Legenda 92')).toBeUndefined();
  });
});
