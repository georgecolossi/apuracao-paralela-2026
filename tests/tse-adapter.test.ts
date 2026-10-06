import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../src/app/api/tse-results/route';

describe('TSE Adapter (API)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockTseResponse = {
    ele: '6257', t: '1', cdabr: '80837',
    carg: [{
      cd: '1', nmf: 'Presidente',
      agr: [{
        par: [{
          cand: [
            { n: '22', nmu: 'BOLSONARO', vap: '32573', pvap: '68,55' },
            { n: '13', nmu: 'LULA', vap: '11047', pvap: '23,25' }
          ]
        }]
      }]
    }],
    s: { ts: '193', st: '193', pst: '100,00' },
    e: { te: '60391', c: '48952', pc: '81,06', a: '11439', pa: '18,94' },
    v: { vvc: '47520', pvvc: '97,07', vb: '717', pvb: '1,46', tvn: '715', ptvn: '1,46' }
  };

  it('1. Deve rejeitar requisição sem round', async () => {
    const req = new Request('http://localhost/api/tse-results');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('2. Deve retornar AVAILABLE e estruturar corretamente o JSON para o T1 mockado', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: false };
      return { ok: true, json: async () => mockTseResponse };
    });

    const req = new Request('http://localhost/api/tse-results?round=1');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    expect(data.source).toBe('TSE');
    expect(data.offices).toHaveLength(5);
    
    const pres = data.offices[0];
    expect(pres.status).toBe('AVAILABLE');
    expect(pres.cargoName).toBe('Presidente');
    expect(pres.candidates[0].name).toBe('BOLSONARO');
    expect(pres.candidates[0].votes).toBe(32573);
    
    expect(pres.attendance.eligible).toBe(60391);
    expect(pres.attendance.turnout).toBe(48952);
    expect(pres.validVotes.quantity).toBe(47520);
    expect(pres.blankVotes.quantity).toBe(717);
    expect(pres.nullVotes.quantity).toBe(715);
  });

  it('3. Deve retornar NOT_YET_AVAILABLE para T2 quando ele-c não existir ou arquivos não existirem', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: false };
      return { ok: false, status: 404 };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('NOT_YET_AVAILABLE');
  });

  it('4. Deve validar município incorreto retornando INVALID_RESPONSE', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: false };
      return { ok: true, json: async () => ({ ...mockTseResponse, cdabr: '99999' }) }; // Wrong muni
    });

    const req = new Request('http://localhost/api/tse-results?round=1');
    const res = await GET(req);
    const data = await res.json();

    expect(data.offices[0].status).toBe('INVALID_RESPONSE');
  });

  it('5. Falha HTTP (500) do TSE deve resultar em TEMPORARILY_UNAVAILABLE e nunca 0 votos', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: false };
      return { ok: false, status: 500 };
    });

    const req = new Request('http://localhost/api/tse-results?round=1');
    const res = await GET(req);
    const data = await res.json();

    expect(data.offices[0].status).toBe('TEMPORARILY_UNAVAILABLE');
    expect(data.offices[0].candidates).toBeUndefined(); // NO zero votes injected!
  });
});
