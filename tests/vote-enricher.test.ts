import { describe, it, expect, vi } from 'vitest';
import { enrichVoteWithMetadata } from '../src/lib/metadata/voteEnricher';
import { CandidateResolver } from '../src/lib/metadata/CandidateResolver';

describe('voteEnricher', () => {
  const mockResolver = {
    resolveNominal: vi.fn(),
    resolveLegenda: vi.fn(),
    load: vi.fn()
  } as unknown as CandidateResolver;

  it('candidato encontrado -> retorna meta completa com FOUND', () => {
    vi.mocked(mockResolver.resolveNominal).mockReturnValueOnce({
      status: 'FOUND', candidateName: 'TESTE SILVA', partyAbbreviation: 'TST', partyNumber: '99'
    });
    
    const res = enrichVoteWithMetadata(
      { voteType: 'NOMINAL', candidateNumber: '99123', partyNumber: null, officeName: 'Deputado Estadual' },
      2026, 1, 'SC', mockResolver
    );

    expect(res.status).toBe('FOUND');
    expect(res.candidateName).toBe('TESTE SILVA');
    expect(mockResolver.resolveNominal).toHaveBeenCalledWith(2026, 1, 'SC', '7', '99123');
  });

  it('Presidente usa BR automaticamente', () => {
    vi.mocked(mockResolver.resolveNominal).mockReturnValueOnce({ status: 'NOT_FOUND' });
    enrichVoteWithMetadata(
      { voteType: 'NOMINAL', candidateNumber: '13', partyNumber: null, officeName: 'Presidente' },
      2026, 1, 'SP', mockResolver // Mesmo vindo de BU de SP
    );
    expect(mockResolver.resolveNominal).toHaveBeenCalledWith(2026, 1, 'BR', '1', '13');
  });

  it('cargo estadual usa UF do BallotReport', () => {
    vi.mocked(mockResolver.resolveNominal).mockReturnValueOnce({ status: 'NOT_FOUND' });
    enrichVoteWithMetadata(
      { voteType: 'NOMINAL', candidateNumber: '123', partyNumber: null, officeName: 'Governador' },
      2026, 1, 'AC', mockResolver
    );
    expect(mockResolver.resolveNominal).toHaveBeenCalledWith(2026, 1, 'AC', '3', '123');
  });

  it('candidato NOT_FOUND -> preserva apenas o status', () => {
    vi.mocked(mockResolver.resolveNominal).mockReturnValueOnce({ status: 'NOT_FOUND' });
    const res = enrichVoteWithMetadata(
      { voteType: 'NOMINAL', candidateNumber: '99999', partyNumber: null, officeName: 'Deputado Federal' },
      2026, 1, 'SC', mockResolver
    );
    expect(res.status).toBe('NOT_FOUND');
    expect(res.candidateName).toBeUndefined(); // Nenhum nome inventado
  });

  it('candidato AMBIGUOUS -> retorna status correto', () => {
    vi.mocked(mockResolver.resolveNominal).mockReturnValueOnce({ status: 'AMBIGUOUS' });
    const res = enrichVoteWithMetadata(
      { voteType: 'NOMINAL', candidateNumber: '777', partyNumber: null, officeName: 'Senador' },
      2026, 1, 'SC', mockResolver
    );
    expect(res.status).toBe('AMBIGUOUS');
    expect(res.candidateName).toBeUndefined();
  });
});
