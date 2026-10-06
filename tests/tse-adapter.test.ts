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

  it('1. Deve rejeitar requisicao sem round', async () => {
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
  });

  it('3. Deve retornar NOT_YET_AVAILABLE para T2 quando ele-c nao existir', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: true, json: async () => ({ eleicoes: [] }) };
      return { ok: false, status: 404 };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('NOT_YET_AVAILABLE');
  });

  it('4. T2_DYNAMIC_DISCOVERY: Deve descobrir eleicoes T2 por nome/cargos e usar os codigos corretos', async () => {
    const synFed = '9991';
    const synEst = '9992';
    
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) {
        return { ok: true, json: async () => ({
          eleicoes: [
            { cd: synFed, nm: 'Eleicao Fake Federal 2', t: '2' },
            { cd: synEst, nm: 'Eleicao Fake Estadual 2', t: '2' }
          ]
        })};
      }
      
      return { ok: true, json: async () => ({ ...mockTseResponse, t: '2' }) };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    expect(data.offices.every((o: any) => o.status === 'AVAILABLE')).toBe(true);
  });
  
  it('5. T2_PARTIAL_PUBLICATION_BEHAVIOR: Deve manter T2 parcialmente disponivel sem erro', async () => {
    const synFed = '8881';
    const synEst = '8882';
    
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) {
        return { ok: true, json: async () => ({
          eleicoes: [
            { cd: synFed, nm: 'Fed', t: '2', cargos: [{cd: '1'}] },
            { cd: synEst, nm: 'Est', t: '2', cargos: [{cd: '3'}] }
          ]
        })};
      }
      
      if (url.includes(`-e00${synFed}-`)) {
        return { ok: true, json: async () => ({ ...mockTseResponse, t: '2' }) };
      }
      return { ok: false, status: 404 };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE'); 
    expect(data.offices.find((o: any) => o.cargo === '1').status).toBe('AVAILABLE');
    expect(data.offices.find((o: any) => o.cargo === '3').status).toBe('NOT_YET_AVAILABLE');
  });
});
