import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { GET } from '../src/app/api/tse-results/route';
import { prisma } from '../src/lib/db';
import { buildTseSyncConfigKey } from '../src/lib/validation/electionContext';
import { clearTseResultsCache } from '../src/lib/tse/tseResultsCache';

describe('TSE Adapter (API — Dinâmico via TseSyncConfig)', () => {
  let activeElectionId: string;

  async function seedActiveElectionWithConfigs(
    configs: Array<{
      roundNumber: number;
      officeCode: string;
      officialElectionCode: string;
      scopeType?: string;
      uf?: string;
      muniTseCode?: string;
    }>
  ) {
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.tseSyncConfig.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.office.deleteMany();
    await prisma.electionScope.deleteMany();
    await prisma.election.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();

    const state = await prisma.state.create({
      data: { abbreviation: 'SC', name: 'Santa Catarina' }
    });
    const muni = await prisma.municipality.create({
      data: { officialCode: '80837', name: 'Concórdia', stateId: state.id, isCoverage: true }
    });

    const election = await prisma.election.create({
      data: {
        name: 'Eleição Oficial Adaptador TSE',
        slug: 'eleicao-adaptador-tse',
        year: 2026,
        type: 'GENERAL',
        status: 'ACTIVE',
        rounds: {
          create: [
            { roundNumber: 1, status: 'ACTIVE', plei: '3220' },
            { roundNumber: 2, status: 'PLANNED', plei: '3221' }
          ]
        },
        scopes: {
          create: {
            scopeType: 'MUNICIPAL',
            scopeKey: 'MUNICIPAL:SC:80837',
            stateId: state.id,
            municipalityId: muni.id,
            isCoverageArea: true
          }
        }
      }
    });
    activeElectionId = election.id;

    for (const cfg of configs) {
      const scopeType = cfg.scopeType || 'MUNICIPAL';
      const uf = cfg.uf || 'SC';
      const muniCode = cfg.muniTseCode || '80837';
      await prisma.tseSyncConfig.create({
        data: {
          electionId: election.id,
          roundNumber: cfg.roundNumber,
          configKey: buildTseSyncConfigKey({
            roundNumber: cfg.roundNumber,
            officeCode: cfg.officeCode,
            scopeType,
            uf,
            muniTseCode: muniCode
          }),
          officeCode: cfg.officeCode,
          officialElectionCode: cfg.officialElectionCode,
          scopeType,
          uf,
          muniTseCode: muniCode,
          status: 'ACTIVE',
          isActive: true
        }
      });
    }

    return election;
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    clearTseResultsCache();
  });

  afterAll(async () => {
    clearTseResultsCache();
    await prisma.tseSyncConfig.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.electionScope.deleteMany();
    await prisma.election.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
  });

  const mockTseResponse = {
    ele: '6257',
    t: '1',
    cdabr: '80837',
    carg: [{
      cd: '1',
      nmf: 'Presidente',
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

  it('2. Deve retornar AVAILABLE e estruturar corretamente o JSON para o T1 configurado via TseSyncConfig', async () => {
    await seedActiveElectionWithConfigs([
      { roundNumber: 1, officeCode: '1', officialElectionCode: '6257', scopeType: 'NACIONAL', uf: 'BR', muniTseCode: '80837' },
      { roundNumber: 1, officeCode: '3', officialElectionCode: '6259' },
      { roundNumber: 1, officeCode: '5', officialElectionCode: '6259' },
      { roundNumber: 1, officeCode: '6', officialElectionCode: '6259' },
      { roundNumber: 1, officeCode: '7', officialElectionCode: '6259' }
    ]);

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const cargoMatch = url.match(/-c(\d{4})-/);
      const eleMatch = url.match(/-e(\d{6})-/);
      const cargoCd = cargoMatch ? String(parseInt(cargoMatch[1], 10)) : '1';
      const eleCd = eleMatch ? String(parseInt(eleMatch[1], 10)) : '6257';
      return {
        ok: true,
        json: async () => ({
          ...mockTseResponse,
          ele: eleCd,
          carg: [{ ...mockTseResponse.carg[0], cd: cargoCd }]
        })
      } as any;
    });

    const req = new Request('http://localhost/api/tse-results?round=1');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    expect(data.source).toBe('TSE');
    expect(data.electionId).toBe(activeElectionId);
    expect(data.offices).toHaveLength(5);
  });

  it('3. Deve retornar NOT_YET_AVAILABLE para T2 quando não houver TseSyncConfig configurado', async () => {
    await seedActiveElectionWithConfigs([
      { roundNumber: 1, officeCode: '1', officialElectionCode: '6257' }
    ]);

    global.fetch = vi.fn();

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('NOT_YET_AVAILABLE');
    expect(data.error).toBe('CONFIGURACAO_TSE_AUSENTE');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('4. T2_DYNAMIC_DISCOVERY: Deve consultar T2 com os códigos oficiais configurados em TseSyncConfig', async () => {
    const synFed = '9991';
    const synEst = '9992';

    await seedActiveElectionWithConfigs([
      { roundNumber: 2, officeCode: '1', officialElectionCode: synFed },
      { roundNumber: 2, officeCode: '3', officialElectionCode: synEst }
    ]);

    const fetchedUrls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchedUrls.push(url);
      if (url.includes(`-e00${synFed}-`)) {
        return { ok: true, json: async () => ({ ...mockTseResponse, ele: synFed, t: '2' }) } as any;
      }
      return {
        ok: true,
        json: async () => ({ ...mockTseResponse, ele: synEst, t: '2', carg: [{ cd: '3', nmf: 'Governador', agr: [] }] })
      } as any;
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    expect(fetchedUrls.some(u => u.includes(`-e00${synFed}-`))).toBe(true);
    expect(fetchedUrls.some(u => u.includes(`-e00${synEst}-`))).toBe(true);
    expect(data.offices.every((o: any) => o.status === 'AVAILABLE')).toBe(true);
  });

  it('5. T2_PARTIAL_PUBLICATION_BEHAVIOR: Deve manter T2 parcialmente disponivel sem erro', async () => {
    const synFed = '8881';
    const synEst = '8882';

    await seedActiveElectionWithConfigs([
      { roundNumber: 2, officeCode: '1', officialElectionCode: synFed },
      { roundNumber: 2, officeCode: '3', officialElectionCode: synEst }
    ]);

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(`-e00${synFed}-`)) {
        return { ok: true, json: async () => ({ ...mockTseResponse, ele: synFed, t: '2' }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    expect(data.offices.find((o: any) => o.cargo === '1').status).toBe('AVAILABLE');
    expect(data.offices.find((o: any) => o.cargo === '3').status).toBe('NOT_YET_AVAILABLE');
  });

  it('6. Deve normalizar os labels flexionados de cargos (GOVERNADORA -> Governador)', async () => {
    await seedActiveElectionWithConfigs([
      { roundNumber: 1, officeCode: '1', officialElectionCode: '6257' },
      { roundNumber: 1, officeCode: '3', officialElectionCode: '6259' }
    ]);

    const mockFlexionado = {
      ...mockTseResponse,
      ele: '6259',
      carg: [{ cd: '3', nmf: 'Governadora', agr: [] }]
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('c0003')) return { ok: true, json: async () => mockFlexionado } as any;
      return { ok: true, json: async () => mockTseResponse } as any;
    });

    const req = new Request('http://localhost/api/tse-results?round=1');
    const res = await GET(req);
    const data = await res.json();

    const govOffice = data.offices.find((o: any) => o.cargo === '3');
    expect(govOffice.cargoName).toBe('Governador');
  });

  it('7. T2_SINGLE_OFFICE_CONFIG: Deve consultar exclusivamente o código configurado para T2 sem disparar estadual não configurado', async () => {
    await seedActiveElectionWithConfigs([
      { roundNumber: 2, officeCode: '1', officialElectionCode: '6258' }
    ]);

    let requestedEa20Url = '';
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('-e006258-')) {
        requestedEa20Url = url;
        return { ok: true, json: async () => ({ ...mockTseResponse, ele: '6258', t: '2' }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    expect(data.status).toBe('AVAILABLE');
    expect(requestedEa20Url).toContain('6258');
    expect(requestedEa20Url).toContain('sc80837-c0001-e006258-u.json');
    expect(data.offices).toHaveLength(1);
    expect(data.offices[0].cargo).toBe('1');
  });

  it('8. T2_REAL_EA20_PARSING: Deve processar payload real do TSE com 0 votos e candidatos 22 e 13', async () => {
    await seedActiveElectionWithConfigs([
      { roundNumber: 2, officeCode: '1', officialElectionCode: '6258' }
    ]);

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
      if (url.includes('-e006258-')) return { ok: true, json: async () => realEa20Payload } as any;
      return { ok: false, status: 404 } as any;
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
    await seedActiveElectionWithConfigs([
      { roundNumber: 2, officeCode: '1', officialElectionCode: '6258' }
    ]);

    const unstartedEa20 = {
      ele: '6258', t: '2', cdabr: '80837',
      s: { ts: '193', st: '0', pst: '0,00' },
      e: { te: '60412', c: '0', pc: '0,00', a: '0', pa: '0,00' },
      v: { vvc: '0', pvvc: '0,00', vb: '0', pvb: '0,00', tvn: '0', ptvn: '0,00' },
      carg: [{ cd: '1', nmf: 'Presidente', agr: [] }]
    };

    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => unstartedEa20
    } as any));

    const req = new Request('http://localhost/api/tse-results?round=2');
    const res = await GET(req);
    const data = await res.json();

    const pres = data.offices.find((o: any) => o.cargo === '1');
    expect(pres.progress.isCompleted).toBe(false);
    expect(pres.progress.isStarted).toBe(false);
    expect(pres.progress.status).not.toBe('CONCLUIDA');
    expect(pres.progress.status).toBe('AGUARDANDO_APURACAO');
  });

  it('10. SC_UF_FILTERING: Garante que cargos 5, 6 e 7 não geram chamadas quando T2 configura apenas cargo 1', async () => {
    await seedActiveElectionWithConfigs([
      { roundNumber: 2, officeCode: '1', officialElectionCode: '6258' }
    ]);

    const fetchedUrls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchedUrls.push(url);
      return { ok: true, json: async () => ({ ...mockTseResponse, ele: '6258', t: '2' }) } as any;
    });

    const req = new Request('http://localhost/api/tse-results?round=2');
    await GET(req);

    const cargosConsultados = fetchedUrls.filter(u => u.includes('c000'));
    expect(cargosConsultados).toHaveLength(1);
    expect(cargosConsultados[0]).toContain('c0001');
    expect(cargosConsultados.some(u => u.includes('c0005'))).toBe(false);
    expect(cargosConsultados.some(u => u.includes('c0006'))).toBe(false);
    expect(cargosConsultados.some(u => u.includes('c0007'))).toBe(false);
  });
});
