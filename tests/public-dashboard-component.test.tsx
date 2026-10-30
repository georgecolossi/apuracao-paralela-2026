// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ApuracaoPage from '../src/app/apuracao/page';

// Configura o ambiente para suportar act(...) do React 19
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock de next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({
    push: vi.fn()
  })
}));

describe('PR 6 — Painel Público: Testes com Componente React Real Montado', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. Renderiza apuração PROVISIONAL com 0 urnas esperadas sem exibir "1 / 0 urnas"', async () => {
    const mockData = {
      isProvisional: true,
      canonicalCoverageStatus: 'PROVISIONAL',
      coverageStatusLabel: 'Cobertura Provisória',
      processedReports: 1,
      expectedReports: 0,
      registeredExpectedReports: 0,
      officialExpectedReports: null,
      dynamicallyRegisteredSections: 1,
      election: {
        id: 'elec-prov-0',
        name: 'Eleição Provisória 0 Urnas',
        plei: '3221',
        scope: { municipality: { name: 'Concórdia' }, state: { uf: 'SC' } },
        rounds: [{ roundNumber: 1, status: 'ACTIVE' }]
      },
      round: { roundNumber: 1, status: 'ACTIVE' },
      offices: [{ id: 'off-1', name: 'Prefeito', type: 'MAJORITARIO', orderNumber: 1 }],
      totals: [
        { officeId: 'off-1', officeName: 'Prefeito', candidateNumber: '10', candidateName: 'CANDIDATO 10', quantity: 15, voteType: 'NOMINAL' }
      ],
      projections: {
        'off-1': { hasProjection: false, status: 'UNAVAILABLE', reason: 'DENOMINATOR_UNAVAILABLE' }
      }
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/totals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockData)
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as any);
    });

    await act(async () => {
      root.render(<ApuracaoPage />);
    });

    // Aguarda resolução dos dados
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const text = container.textContent || '';
    // Jamais deve exibir "1 / 0 urnas"
    expect(text).not.toContain('1 / 0 urnas');
    expect(text).toContain('1 urnas apuradas');
    expect(text).toContain('Regime provisório dinâmico');
    // Não deve conter coluna de Projeção*
    expect(text).not.toContain('Projeção*');
  });

  it('2. Renderiza apuração PROVISIONAL com 30 urnas esperadas exibindo "1 / 30 urnas" e projeção ativa', async () => {
    const mockData = {
      isProvisional: true,
      canonicalCoverageStatus: 'PROVISIONAL',
      coverageStatusLabel: 'Cobertura Provisória',
      processedReports: 1,
      expectedReports: 30,
      registeredExpectedReports: 30,
      officialExpectedReports: null,
      election: {
        id: 'elec-prov-30',
        name: 'Eleição Provisória 30 Urnas',
        plei: '3221',
        scope: { municipality: { name: 'Concórdia' }, state: { uf: 'SC' } },
        rounds: [{ roundNumber: 1, status: 'ACTIVE' }]
      },
      round: { roundNumber: 1, status: 'ACTIVE' },
      offices: [{ id: 'off-30', name: 'Prefeito', type: 'MAJORITARIO', orderNumber: 1 }],
      totals: [
        { officeId: 'off-30', officeName: 'Prefeito', candidateNumber: '10', candidateName: 'CANDIDATO 10', quantity: 15, voteType: 'NOMINAL' }
      ],
      projections: {
        'off-30': {
          hasProjection: true,
          status: 'ACTIVE',
          expectedReports: 30,
          processedReports: 1,
          candidates: [
            { candidateNumber: '10', candidateName: 'CANDIDATO 10', currentVotes: 15, projectedVotes: 450, projectedPercent: '100,00' }
          ]
        }
      }
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/totals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockData)
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as any);
    });

    await act(async () => {
      root.render(<ApuracaoPage />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const text = container.textContent || '';
    expect(text).toContain('1 / 30 urnas');
    expect(text).toContain('Regime provisório (3,33%)');
    expect(text).toContain('Projeção*');
    expect(text).toContain('450'); // Votos projetados
    expect(text).toContain('PROJEÇÃO MATEMÁTICA COM BASE NAS URNAS APURADAS*');
    expect(text).toContain('com base em 1 de 30 urnas apuradas');
  });

  it('3. Dois cargos homônimos com IDs distintos recebem projeções diferentes e isoladas', async () => {
    const mockData = {
      isProvisional: false,
      canonicalCoverageStatus: 'HOMOLOGATED',
      coverageStatusLabel: 'Cobertura Homologada',
      processedReports: 5,
      expectedReports: 10,
      election: {
        id: 'elec-homonima',
        name: 'Eleição com Cargos Homônimos',
        plei: '3221',
        scope: { municipality: { name: 'Concórdia' }, state: { uf: 'SC' } },
        rounds: [{ roundNumber: 1, status: 'ACTIVE' }]
      },
      round: { roundNumber: 1, status: 'ACTIVE' },
      offices: [
        { id: 'cargo-uuid-1', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 1 },
        { id: 'cargo-uuid-2', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 2 }
      ],
      totals: [
        { officeId: 'cargo-uuid-1', officeName: 'Conselheiro', candidateNumber: '10', candidateName: 'CANDIDATO ALFA', quantity: 20, voteType: 'NOMINAL' },
        { officeId: 'cargo-uuid-2', officeName: 'Conselheiro', candidateNumber: '10', candidateName: 'CANDIDATO BETA', quantity: 70, voteType: 'NOMINAL' }
      ],
      projections: {
        'cargo-uuid-1': {
          officeId: 'cargo-uuid-1',
          officeName: 'Conselheiro',
          hasProjection: true,
          status: 'ACTIVE',
          expectedReports: 10,
          processedReports: 5,
          candidates: [{ candidateNumber: '10', currentVotes: 20, projectedVotes: 40 }]
        },
        'cargo-uuid-2': {
          officeId: 'cargo-uuid-2',
          officeName: 'Conselheiro',
          hasProjection: true,
          status: 'ACTIVE',
          expectedReports: 10,
          processedReports: 5,
          candidates: [{ candidateNumber: '10', currentVotes: 70, projectedVotes: 140 }]
        }
      }
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/totals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockData)
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as any);
    });

    await act(async () => {
      root.render(<ApuracaoPage />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const cards = container.querySelectorAll('.bg-white.rounded-2xl');
    expect(cards.length).toBe(2);

    // Card 1: Contém projeção 40, não contém 140
    expect(cards[0].textContent).toContain('CANDIDATO ALFA');
    expect(cards[0].textContent).toContain('≈ 40');
    expect(cards[0].textContent).not.toContain('≈ 140');

    // Card 2: Contém projeção 140, não contém 40
    expect(cards[1].textContent).toContain('CANDIDATO BETA');
    expect(cards[1].textContent).toContain('≈ 140');
    expect(cards[1].textContent).not.toContain('≈ 40');
  });

  it('4. Se o cargo B não tiver projeção por ID, a interface NÃO reutiliza a projeção do cargo A pelo nome', async () => {
    const mockData = {
      isProvisional: false,
      canonicalCoverageStatus: 'HOMOLOGATED',
      coverageStatusLabel: 'Cobertura Homologada',
      processedReports: 5,
      expectedReports: 10,
      election: {
        id: 'elec-homonima-sem-proj',
        name: 'Eleição com Cargos Homônimos',
        plei: '3221',
        scope: { municipality: { name: 'Concórdia' }, state: { uf: 'SC' } },
        rounds: [{ roundNumber: 1, status: 'ACTIVE' }]
      },
      round: { roundNumber: 1, status: 'ACTIVE' },
      offices: [
        { id: 'cargo-uuid-1', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 1 },
        { id: 'cargo-uuid-2', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 2 }
      ],
      totals: [
        { officeId: 'cargo-uuid-1', officeName: 'Conselheiro', candidateNumber: '10', candidateName: 'CANDIDATO ALFA', quantity: 20, voteType: 'NOMINAL' },
        { officeId: 'cargo-uuid-2', officeName: 'Conselheiro', candidateNumber: '10', candidateName: 'CANDIDATO BETA', quantity: 70, voteType: 'NOMINAL' }
      ],
      projections: {
        // Apenas o cargo 1 possui projeção por ID
        'cargo-uuid-1': {
          officeId: 'cargo-uuid-1',
          officeName: 'Conselheiro',
          hasProjection: true,
          status: 'ACTIVE',
          expectedReports: 10,
          processedReports: 5,
          candidates: [{ candidateNumber: '10', currentVotes: 20, projectedVotes: 40 }]
        },
        // Mesmo se houver uma chave por nome 'Conselheiro' (alias de A), ela JAMAIS deve ser associada ao cargo 2
        'Conselheiro': {
          officeId: 'cargo-uuid-1',
          officeName: 'Conselheiro',
          hasProjection: true,
          status: 'ACTIVE',
          expectedReports: 10,
          processedReports: 5,
          candidates: [{ candidateNumber: '10', currentVotes: 20, projectedVotes: 40 }]
        }
      }
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/totals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockData)
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as any);
    });

    await act(async () => {
      root.render(<ApuracaoPage />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const cards = container.querySelectorAll('.bg-white.rounded-2xl');
    expect(cards.length).toBe(2);

    // Card 1 (Cargo A): exibe projeção
    expect(cards[0].textContent).toContain('CANDIDATO ALFA');
    expect(cards[0].textContent).toContain('Projeção*');
    expect(cards[0].textContent).toContain('≈ 40');

    // Card 2 (Cargo B): NÃO possui projeção por ID
    expect(cards[1].textContent).toContain('CANDIDATO BETA');
    // Deve NÃO exibir Projeção*, NÃO exibir ≈ 40 e NÃO declarar vencedor indevidamente
    expect(cards[1].textContent).not.toContain('Projeção*');
    expect(cards[1].textContent).not.toContain('≈ 40');
    expect(cards[1].textContent).not.toContain('Eleito');
  });

  it('5. Um nome único sem ID continua funcionando no caminho legado', async () => {
    const mockData = {
      isProvisional: false,
      canonicalCoverageStatus: 'HOMOLOGATED',
      coverageStatusLabel: 'Cobertura Homologada',
      processedReports: 5,
      expectedReports: 10,
      election: {
        id: 'elec-legado-nome-unico',
        name: 'Eleição Legada',
        plei: '3221',
        scope: { municipality: { name: 'Concórdia' }, state: { uf: 'SC' } },
        rounds: [{ roundNumber: 1, status: 'ACTIVE' }]
      },
      round: { roundNumber: 1, status: 'ACTIVE' },
      // Objeto legado SEM id de cargo
      offices: [
        { name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 }
      ],
      totals: [
        { officeName: 'Presidente', candidateNumber: '99', candidateName: 'CANDIDATO UNICO', quantity: 100, voteType: 'NOMINAL' }
      ],
      projections: {
        'Presidente': {
          officeName: 'Presidente',
          hasProjection: true,
          status: 'ACTIVE',
          expectedReports: 10,
          processedReports: 5,
          candidates: [{ candidateNumber: '99', currentVotes: 100, projectedVotes: 200 }]
        }
      }
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/totals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockData)
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as any);
    });

    await act(async () => {
      root.render(<ApuracaoPage />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const cards = container.querySelectorAll('.bg-white.rounded-2xl');
    expect(cards.length).toBe(1);

    expect(cards[0].textContent).toContain('CANDIDATO UNICO');
    expect(cards[0].textContent).toContain('Projeção*');
    expect(cards[0].textContent).toContain('≈ 200'); // Projeção carregada via nome único legado
  });

  it('6. Dois cargos homônimos sem ID no caminho legado recusam projeção ambígua', async () => {
    const mockData = {
      isProvisional: false,
      canonicalCoverageStatus: 'HOMOLOGATED',
      coverageStatusLabel: 'Cobertura Homologada',
      processedReports: 5,
      expectedReports: 10,
      election: {
        id: 'elec-legado-ambiguo',
        name: 'Eleição Legada Ambígua',
        plei: '3221',
        scope: { municipality: { name: 'Concórdia' }, state: { uf: 'SC' } },
        rounds: [{ roundNumber: 1, status: 'ACTIVE' }]
      },
      round: { roundNumber: 1, status: 'ACTIVE' },
      // Dois cargos homônimos sem ID
      offices: [
        { name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 1 },
        { name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 2 }
      ],
      totals: [
        { officeName: 'Conselheiro', candidateNumber: '10', candidateName: 'CANDIDATO ALFA', quantity: 20, voteType: 'NOMINAL' }
      ],
      projections: {
        'Conselheiro': {
          officeName: 'Conselheiro',
          hasProjection: true,
          status: 'ACTIVE',
          expectedReports: 10,
          processedReports: 5,
          candidates: [{ candidateNumber: '10', currentVotes: 20, projectedVotes: 40 }]
        }
      }
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/totals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockData)
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as any);
    });

    await act(async () => {
      root.render(<ApuracaoPage />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const cards = container.querySelectorAll('.bg-white.rounded-2xl');
    expect(cards.length).toBe(2);

    // Como ambos são homônimos sem ID, nenhum deve exibir Projeção*
    expect(cards[0].textContent).not.toContain('Projeção*');
    expect(cards[0].textContent).not.toContain('≈ 40');
    expect(cards[1].textContent).not.toContain('Projeção*');
    expect(cards[1].textContent).not.toContain('≈ 40');
  });
});
