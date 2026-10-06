import { describe, it, expect } from 'vitest';
import { getOfficeDataAggregate, classifyVotePresentation, TotalItem } from '../src/lib/presentation/apuracaoHelper';

describe('apuracaoHelper - Classificacao de Votos', () => {
  it('A) LEGENDA nunca entra na lista CANDIDATOS e B) LEGENDA eh agrupada corretamente por partido', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Deputado Federal', voteType: 'LEGENDA', partyNumber: '13', quantity: 10 },
      { officeName: 'Deputado Federal', voteType: 'LEGENDA', partyNumber: '13', quantity: 5 },
      { officeName: 'Deputado Federal', voteType: 'LEGENDA', partyNumber: '22', quantity: 8 },
    ];
    const result = getOfficeDataAggregate('Deputado Federal', mockData);
    expect(result.candidates.length).toBe(0);
    expect(result.legendas.length).toBe(2);
    expect(result.legendas.find(l => l.partyNumber === '13')?.quantity).toBe(15);
  });

  it('E) NOMINAL com candidateName valido continua em CANDIDATOS', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '13', candidateName: 'LULA', quantity: 100 }
    ];
    const result = getOfficeDataAggregate('Presidente', mockData);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].candidateName).toBe('LULA');
  });

  it('F e G) Presidente 28 / 3 votos nao entra em CANDIDATOS e aparece como NULOS TECNICOS', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '28', quantity: 3 }
    ];
    const result = getOfficeDataAggregate('Presidente', mockData);
    expect(result.candidates.length).toBe(0);
    expect(result.nulosTecnicos).toBe(3);
  });

  it('H) Nao existe regra generica: NOMINAL sem metadata = NULO_TECNICO', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Governador', voteType: 'NOMINAL', candidateNumber: '99', quantity: 5 }
    ];
    const result = getOfficeDataAggregate('Governador', mockData);
    expect(result.candidates.length).toBe(0);
    expect(result.nulosTecnicos).toBe(0);
    expect(result.outrosAnulados).toBe(5);
  });

  it('I) Brancos e nulos normais continuam preservados', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'BRANCO', quantity: 717 },
      { officeName: 'Presidente', voteType: 'NULO', quantity: 712 }
    ];
    const result = getOfficeDataAggregate('Presidente', mockData);
    expect(result.brancos).toBe(717);
    expect(result.nulos).toBe(712);
  });

  it('J) A soma do Presidente continua correta', () => {
    const mockData: TotalItem[] = [
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '13', candidateName: 'LULA', quantity: 47520 },
      { officeName: 'Presidente', voteType: 'BRANCO', quantity: 717 },
      { officeName: 'Presidente', voteType: 'NULO', quantity: 712 },
      { officeName: 'Presidente', voteType: 'NOMINAL', candidateNumber: '28', quantity: 3 }
    ];
    const result = getOfficeDataAggregate('Presidente', mockData);
    expect(result.totalValidos).toBe(47520);
    expect(result.brancos).toBe(717);
    expect(result.nulos).toBe(712);
    expect(result.nulosTecnicos).toBe(3);
    expect(result.totalGeral).toBe(48952);
  });
});