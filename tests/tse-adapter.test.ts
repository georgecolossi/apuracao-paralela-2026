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

  it('6. Deve normalizar os labels flexionados de cargos (GOVERNADORA -> Governador)', async () => {
    const mockFlexionado = {
      ...mockTseResponse,
      carg: [{ cd: '3', nmf: 'Governadora', agr: [] }]
    };
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: false };
      if (url.includes('c0003')) return { ok: true, json: async () => mockFlexionado };
      return { ok: true, json: async () => mockTseResponse };
    });

    const req = new Request('http://localhost/api/tse-results?round=1');
    const res = await GET(req);
    const data = await res.json();
    
    const govOffice = data.offices.find((o: any) => o.cargo === '3');
    expect(govOffice.cargoName).toBe('Governador');
  });

  it('7. T2_OFFICIAL_CATALOG_SCHEMA: Deve processar estrutura real de ele-c.json (pl[].e[]) e selecionar eleição 6258 para T2', async () => {
    const mockRealEleC = {
      pl: [
        {
          cd: '3220', c: 'ele2026', dt: '04/10/2026',
          e: [
            { cd: '6257', nm: 'Eleicao Federal T1', t: '1', tp: '8', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] },
            { cd: '6259', nm: 'Eleicao Estadual T1', t: '1', tp: '1', abr: [{ cd: 'br', cp: [{ cd: '3' }] }] }
          ]
        },
        {
          cd: '3221', c: 'ele2026', dt: '25/10/2026',
          e: [
            { cd: '6258', nm: 'Eleicao Ordinaria Federal - 2026 2º Turno', t: '2', tp: '8', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] },
            { cd: '6260', nm: 'Eleicao Ordinaria Estadual - 2026 2º Turno', t: '2', tp: '1', abr: [{ cd: 'am' }, { cd: 'rn' }] }
          ]
        }
      ]
    };

    let requestedEa20Url = '';
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: true, json: async () => mockRealEleC };
      if (url.includes('-e006258-')) {
        requestedEa20Url = url;
        return { ok: true, json: async () => ({ ...mockTseResponse, ele: '6258', t: '2' }) };
      }
      return { ok: false, status: 404 };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    expect(requestedEa20Url).toContain('6258');
    expect(requestedEa20Url).toContain('sc80837-c0001-e006258-u.json');
    // Confirma que não tentou consultar estadual (6260) pois SC não está em abr
    const govOffice = data.offices.find((o: any) => o.cargo === '3');
    expect(govOffice.status).toBe('NOT_YET_AVAILABLE');
  });

  it('8. T2_REAL_EA20_PARSING: Deve processar payload real do TSE com 0 votos e candidatos 22 e 13', async () => {
    const realEa20Payload = {
      ele: '6258', t: '2', cdabr: '80837',
      s: { ts: '193', st: '0', pst: '0,00' },
      e: { te: '60412', c: '0', pc: '0,00', a: '0', pa: '0,00' },
      v: { tv: '0', vvc: '0', pvvc: '0,00', vb: '0', pvb: '0,00', tvn: '0', ptvn: '0,00' },
      carg: [{
        cd: '1', nmf: 'Presidente',
        agr: [
          { par: [{ cand: [{ n: '22', nmu: 'FLAVIO BOLSONARO', vap: '0', pvap: '0,00' }] }] },
          { par: [{ cand: [{ n: '13', nmu: 'LULA', vap: '0', pvap: '0,00' }] }] }
        ]
      }]
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: false }; // testa via fallback 6258
      if (url.includes('-e006258-')) return { ok: true, json: async () => realEa20Payload };
      return { ok: false, status: 404 };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    const pres = data.offices.find((o: any) => o.cargo === '1');
    expect(pres.status).toBe('AVAILABLE');
    expect(pres.candidates).toHaveLength(2);
    expect(pres.candidates[0].votes).toBe(0);
    expect(pres.candidates[0].percent).toBe('0,00');
    expect(pres.candidates[1].votes).toBe(0);
    expect(pres.candidates[1].percent).toBe('0,00');
    expect(pres.progress.total).toBe(193);
    expect(pres.progress.processed).toBe(0);
    expect(pres.progress.percent).toBe('0,00');
    expect(pres.progress.isStarted).toBe(false);
    expect(pres.progress.isCompleted).toBe(false);
    expect(pres.progress.status).toBe('AGUARDANDO_APURACAO');
    expect(pres.attendance.eligible).toBe(60412);
  });

  it('9. T2_PROGRESS_STATUS_ZERO_SECTIONS: Confirma que s.st = 0 não é apresentado como apuração concluída', async () => {
    const unstartedEa20 = {
      ele: '6258', t: '2', cdabr: '80837',
      s: { ts: '193', st: '0', pst: '0,00' },
      e: { te: '60412', c: '0', pc: '0,00', a: '0', pa: '0,00' },
      v: { vvc: '0', pvvc: '0,00', vb: '0', pvb: '0,00', tvn: '0', ptvn: '0,00' },
      carg: [{ cd: '1', nmf: 'Presidente', agr: [] }]
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('ele-c.json')) return { ok: false };
      return { ok: true, json: async () => unstartedEa20 };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    const pres = data.offices.find((o: any) => o.cargo === '1');
    expect(pres.progress.isCompleted).toBe(false);
    expect(pres.progress.isStarted).toBe(false);
    expect(pres.progress.status).not.toBe('CONCLUIDA');
    expect(pres.progress.status).toBe('AGUARDANDO_APURACAO');
  });

  it('10. SC_UF_FILTERING: Garante que cargos 5, 6 e 7 não geram chamadas no Turno 2', async () => {
    const fetchedUrls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchedUrls.push(url);
      if (url.includes('ele-c.json')) return { ok: false };
      return { ok: true, json: async () => ({ ...mockTseResponse, t: '2' }) };
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    await GET(req);

    // No T2 para SC, apenas cargo 1 é consultado
    const cargosConsultados = fetchedUrls.filter(u => u.includes('c000'));
    expect(cargosConsultados).toHaveLength(1);
    expect(cargosConsultados[0]).toContain('c0001');
    expect(cargosConsultados.some(u => u.includes('c0005'))).toBe(false);
    expect(cargosConsultados.some(u => u.includes('c0006'))).toBe(false);
    expect(cargosConsultados.some(u => u.includes('c0007'))).toBe(false);
  });
});
