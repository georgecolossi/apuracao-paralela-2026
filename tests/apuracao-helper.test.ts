import { describe, it, expect } from 'vitest';
import { getOfficeDataAggregate, classifyVotePresentation, TotalItem } from '../src/lib/presentation/apuracaoHelper';

describe('apuracaoHelper - Classificacao de Votos (Narrow Fix)', () => {
  it('A) PLEI 3220 turno 1 Presidente 28 -> NULO_TECNICO', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '28', quantity: 3 }
    ];
    const result = getOfficeDataAggregate('3220', 1, 'Presidente', mockData);
    expect(result.nulosTecnicos).toBe(3);
    expect(result.candidates.length).toBe(0);
  });

  it('B) PLEI 3220 turno 2 Presidente 28 -> NAO NULO_TECNICO', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '28', quantity: 3 }
    ];
    const result = getOfficeDataAggregate('3220', 2, 'Presidente', mockData);
    expect(result.nulosTecnicos).toBe(0);
    expect(result.pendentes).toBe(3);
  });

  it('C) PLEI diferente turno 1 Presidente 28 -> NAO NULO_TECNICO', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '28', quantity: 3 }
    ];
    const result = getOfficeDataAggregate('9999', 1, 'Presidente', mockData);
    expect(result.nulosTecnicos).toBe(0);
    expect(result.pendentes).toBe(3);
  });

  it('D) PLEI 3220 turno 1 Governador 28 -> NAO NULO_TECNICO', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Governador', voteType: 'NOMINAL', candidateNumber: '28', quantity: 5 }
    ];
    const result = getOfficeDataAggregate('3220', 1, 'Governador', mockData);
    expect(result.nulosTecnicos).toBe(0);
    expect(result.pendentes).toBe(5);
  });

  it('E) PLEI 3220 turno 1 Presidente outro numero -> NAO NULO_TECNICO', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '13', quantity: 10 }
    ];
    const result = getOfficeDataAggregate('3220', 1, 'Presidente', mockData);
    expect(result.nulosTecnicos).toBe(0);
    expect(result.pendentes).toBe(10);
  });

  it('F) Nominal sem metadata que nao possui regra oficial explicita -> NAO NULO_TECNICO (vai para PENDENTE_CLASSIFICACAO)', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Senador', voteType: 'NOMINAL', candidateNumber: '999', quantity: 2 }
    ];
    const result = getOfficeDataAggregate('3220', 1, 'Senador', mockData);
    expect(result.nulosTecnicos).toBe(0);
    expect(result.pendentes).toBe(2);
  });

  it('G) Nominal valido Presidente 28 em outro pleito/turno -> nao deve ser removido da lista de candidatos caso tenha metadata valido', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '28', candidateName: 'CANDIDATO 28 NOVO', quantity: 100 }
    ];
    // Outro turno
    const result = getOfficeDataAggregate('3220', 2, 'Presidente', mockData);
    expect(result.nulosTecnicos).toBe(0);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].candidateName).toBe('CANDIDATO 28 NOVO');
  });

  it('LEGENDA continua funcionando sem context', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Deputado Federal', voteType: 'LEGENDA', partyNumber: '13', quantity: 10 }
    ];
    const result = getOfficeDataAggregate(null, null, 'Deputado Federal', mockData);
    expect(result.legendas.length).toBe(1);
  });

  it('Soma Presidente continua correta para PLEI 3220 T1', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '13', candidateName: 'LULA', quantity: 47520 },
      { officeName: 'Presidente', voteType: 'BRANCO', quantity: 717 },
      { officeName: 'Presidente', voteType: 'NULO', quantity: 712 },
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '28', quantity: 3 }
    ];
    const result = getOfficeDataAggregate('3220', 1, 'Presidente', mockData);
    expect(result.totalValidos).toBe(47520);
    expect(result.brancos).toBe(717);
    expect(result.nulos).toBe(712);
    expect(result.nulosTecnicos).toBe(3);
    expect(result.totalGeral).toBe(48952);
  });
});