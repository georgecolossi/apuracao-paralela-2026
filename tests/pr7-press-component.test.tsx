// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UrnasFeed } from '../src/components/press/UrnasFeed';
import { UrnaDetailModal } from '../src/components/press/UrnaDetailModal';
import ImprensaPage from '../src/app/imprensa/page';

// Suporte a act(...) do React 19
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock de next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({
    push: vi.fn()
  })
}));

const mockFeedResponse = {
  context: {
    election: { id: 'elec-1', slug: 'gerais-2026', name: 'Eleições Gerais 2026', year: 2026 },
    round: { id: 'round-1', roundNumber: 1, status: 'ACTIVE' }
  },
  pagination: {
    limit: 20,
    hasMore: true,
    nextCursor: 'mockCursorNext123'
  },
  filters: { zone: null, section: null },
  items: [
    {
      id: 'rep-mock-1',
      territory: {
        stateCode: 'SC',
        cityCode: '80837',
        cityName: 'Concórdia',
        zoneCode: '9',
        sectionCode: '42',
        locationName: 'Escola Deodoro',
        urnCode: '1001'
      },
      timing: {
        displayTimestamp: '2026-10-30T17:15:00.000Z',
        timestampType: 'CONFIRMED'
      },
      integrity: {
        vrqrVersion: '4.0',
        hashStatus: 'VERIFIED',
        sigStatus: 'VERIFIED'
      },
      summary: {
        totalVotes: 280,
        officesCount: 1,
        hasAttendance: true
      }
    }
  ]
};

const mockDetailResponse = {
  id: 'rep-mock-1',
  context: {
    election: { id: 'elec-1', name: 'Eleições Gerais 2026', year: 2026 },
    round: { id: 'round-1', roundNumber: 1 }
  },
  territory: {
    stateCode: 'SC',
    cityCode: '80837',
    cityName: 'Concórdia',
    zoneCode: '9',
    sectionCode: '42',
    locationName: 'Escola Deodoro',
    urnCode: '1001'
  },
  timing: {
    displayTimestamp: '2026-10-30T17:15:00.000Z',
    timestampType: 'CONFIRMED'
  },
  integrity: {
    vrqrVersion: '4.0',
    hashStatus: 'VERIFIED',
    sigStatus: 'VERIFIED'
  },
  attendance: {
    available: true,
    apto: 300,
    comp: 280,
    falt: 20,
    turnoutPercent: '93,33%',
    abstentionPercent: '6,67%'
  },
  offices: [
    {
      officeId: 'off-1',
      officeName: 'Presidente',
      officeCode: '1',
      type: 'MAJORITARIO',
      summary: {
        validVotes: 250,
        blankVotes: 10,
        nullVotes: 20,
        totalVotes: 280
      },
      candidates: [
        { candidateNumber: '22', ballotName: 'Candidato Alfa', partyNumber: '22', partyAbbreviation: 'PL', votes: 150, percent: '60,00%' },
        { candidateNumber: '13', ballotName: 'Candidato Beta', partyNumber: '13', partyAbbreviation: 'PT', votes: 100, percent: '40,00%' }
      ],
      parties: []
    }
  ],
  radioScript: 'BOLETIM DE URNA APURADO — APURAÇÃO PARALELA\nEleição: Eleições Gerais 2026 — 1º Turno\nMunicípio: Concórdia (SC)\nZona Eleitoral: 9 | Seção: 42 | Local: Escola Deodoro'
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('PR 7 — Componentes React de Imprensa & Rádio (Testes com Componentes Reais Montados)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    // Mock do clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      },
      configurable: true,
      writable: true
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. Renderiza o feed de urnas carregando itens da API com sucesso', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/urnas')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockFeedResponse)
        } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as any);
    });

    await act(async () => {
      root.render(<UrnasFeed />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    const text = container.textContent || '';
    expect(text).toContain('Últimas Urnas Apuradas');
    expect(text).toContain('Concórdia');
    expect(text).toContain('SC');
    expect(text).toContain('Zona 9 — Seção 42');
    expect(text).toContain('Escola Deodoro');
    expect(text).toContain('280 votos');
    expect(text).toContain('Urna nº 1001');
  });

  it('2. Aplica filtros de zona e seção e dispara nova consulta', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockFeedResponse)
      } as any);
    });
    globalThis.fetch = fetchMock;

    await act(async () => {
      root.render(<UrnasFeed />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Localiza inputs de busca por atributo placeholder
    const zoneInput = container.querySelector('input[placeholder*="Zona"]') as HTMLInputElement;
    const sectionInput = container.querySelector('input[placeholder*="Seção"]') as HTMLInputElement;
    const searchForm = container.querySelector('form') as HTMLFormElement;

    expect(zoneInput).toBeTruthy();
    expect(sectionInput).toBeTruthy();
    expect(searchForm).toBeTruthy();

    await act(async () => {
      setInputValue(zoneInput, '9');
      setInputValue(sectionInput, '42');
      searchForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Verifica que o fetch subsequente incluiu os parâmetros zone=9 e section=42
    const lastCallUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0];
    expect(lastCallUrl).toContain('zone=9');
    expect(lastCallUrl).toContain('section=42');
  });

  it('3. Valida entrada incorreta no formulário de busca e exibe mensagem de erro inline', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockFeedResponse)
    } as any);

    await act(async () => {
      root.render(<UrnasFeed />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    const zoneInput = container.querySelector('input[placeholder*="Zona"]') as HTMLInputElement;
    const searchForm = container.querySelector('form') as HTMLFormElement;

    // Digita formato inválido com espaços
    await act(async () => {
      setInputValue(zoneInput, ' 9 ');
      searchForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const text = container.textContent || '';
    expect(text).toContain('Zona eleitoral deve conter de 1 a 4 dígitos sem espaços');
  });

  it('4. Alterna modo Teleprompter aumentando contraste e alterando estilo dos cards', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockFeedResponse)
    } as any);

    await act(async () => {
      root.render(<UrnasFeed />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Encontra botão do modo Teleprompter
    const teleprompterBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Teleprompter')
    );
    expect(teleprompterBtn).toBeTruthy();

    await act(async () => {
      teleprompterBtn?.click();
    });

    // O card de urna deve assumir estilo de alto contraste (bg-slate-900 border-slate-800)
    const card = container.querySelector('.group');
    expect(card).toBeTruthy();
    expect(card?.className).toContain('bg-slate-900');
  });

  it('5. Abre o modal de detalhes ao clicar no card e exibe tabs de apuração e roteiro de rádio', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/urnas/rep-mock-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockDetailResponse)
        } as any);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockFeedResponse)
      } as any);
    });

    await act(async () => {
      root.render(<UrnasFeed />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Clica no card da urna para abrir o modal de detalhes
    const card = container.querySelector('.group') as HTMLElement;
    expect(card).toBeTruthy();

    await act(async () => {
      card.click();
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Modal deve estar aberto
    const text = container.textContent || '';
    expect(text).toContain('Boletim de Urna');
    expect(text).toContain('Presidente');
    expect(text).toContain('Candidato Alfa');
    expect(text).toContain('Candidato Beta');
    expect(text).toContain('Locução para Rádio');
  });

  it('6. Modal de detalhe copia roteiro de rádio para clipboard com feedback visual', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockDetailResponse)
    } as any);

    await act(async () => {
      root.render(
        <UrnaDetailModal
          reportId="rep-mock-1"
          onClose={() => {}}
        />
      );
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // Clica na aba "Locução para Rádio"
    const radioTabBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Locução para Rádio')
    );
    expect(radioTabBtn).toBeTruthy();

    await act(async () => {
      radioTabBtn?.click();
    });

    const copyBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Copiar Texto')
    );
    expect(copyBtn).toBeTruthy();

    await act(async () => {
      copyBtn?.click();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockDetailResponse.radioScript);

    const text = container.textContent || '';
    expect(text).toContain('Copiado para o Rádio!');
  });

  it('7. Renderiza a página completa /imprensa com cabeçalho e links de navegação', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockFeedResponse)
    } as any);

    await act(async () => {
      root.render(<ImprensaPage />);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    const text = container.textContent || '';
    expect(text).toContain('Imprensa & Rádio');
    expect(text).toContain('Ao Vivo');
    expect(text).toContain('Painel Geral');
    expect(text).toContain('Metodologia');
    expect(text).toContain('Últimas Urnas Apuradas');

    const links = Array.from(container.querySelectorAll('a'));
    const apuracaoLink = links.find(a => a.getAttribute('href') === '/apuracao');
    const metodologiaLink = links.find(a => a.getAttribute('href') === '/metodologia');
    expect(apuracaoLink).toBeTruthy();
    expect(metodologiaLink).toBeTruthy();
  });
});
