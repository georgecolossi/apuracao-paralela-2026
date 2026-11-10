import http from 'node:http';
import dns from 'node:dns';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import {
  buildTseSyncConfigKey,
  createPinnedDnsLookup,
  isPublicIpAddress,
  parseAndNormalizeIPv4,
  resolveAndValidateTseSourceUrl,
  validateTseSourceUrl
} from '../src/lib/validation/electionContext';
import {
  clearTseResultsCache,
  computeTseConfigFingerprint,
  isCacheableTseResponse
} from '../src/lib/tse/tseResultsCache';
import { getDynamicTseResults } from '../src/lib/tse/tseResultsService';
import { GET as getTseResultsRoute } from '../src/app/api/tse-results/route';
import { saveElectionWizard, activateElectionWizard, getWizardMetadata, validateAndParseTseImport } from '../src/lib/wizard/wizardService';

describe('PR 8 — Adaptador Dinâmico de Integração com o TSE (Universal & Cache 15s)', () => {
  const originalFetch = globalThis.fetch;
  let adminUser: any;

  async function cleanupDatabase() {
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.tseSyncConfig.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.office.deleteMany();
    await prisma.party.deleteMany();
    await prisma.electionScope.deleteMany();
    await prisma.election.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  }

  function makeEa20Payload(params: {
    ele: string;
    t: string;
    cdabr: string;
    cargoCd: string;
    cargoName?: string;
    processed?: string;
    total?: string;
    candidates?: Array<{ n: string; nmu: string; vap: string; pvap: string }>;
  }) {
    return {
      ele: params.ele,
      t: params.t,
      cdabr: params.cdabr,
      s: {
        ts: params.total || '100',
        st: params.processed ?? '50',
        pst: '50,00'
      },
      e: { te: '50000', c: '25000', pc: '50,00', a: '25000', pa: '50,00' },
      v: { vvc: '24000', pvvc: '96,00', vb: '500', pvb: '2,00', tvn: '500', ptvn: '2,00' },
      carg: [
        {
          cd: params.cargoCd,
          nmf: params.cargoName || 'Cargo TSE',
          agr: params.candidates
            ? [{ par: [{ cand: params.candidates }] }]
            : []
        }
      ]
    };
  }

  beforeEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearTseResultsCache();
    await cleanupDatabase();

    adminUser = await prisma.user.create({
      data: {
        name: 'Admin PR8',
        email: 'admin.pr8@teste.gov.br',
        passwordHash: 'hash-pr8',
        role: 'ADMIN',
        isActive: true
      }
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  afterAll(async () => {
    clearTseResultsCache();
    await cleanupDatabase();
  });

  describe('1. Configuração e Integração com Setup Wizard', () => {
    it('1.1 Configuração TSE válida persistida pelo Setup Wizard e ativada via wizardService resolve dinamicamente ano, UF, município e cargos', async () => {
      const saved = await saveElectionWizard(adminUser.id, {
        name: 'Eleição Municipal de Campinas 2024',
        year: 2024,
        type: 'MUNICIPAL',
        plei: '550',
        scopes: [
          {
            scopeType: 'MUNICIPAL',
            stateAbbreviation: 'SP',
            municipalityOfficialCode: '62910',
            municipalityName: 'Campinas'
          }
        ],
        rounds: [
          { roundNumber: 1, plei: '550' },
          { roundNumber: 2, plei: '551' }
        ],
        offices: [
          { code: '11', name: 'Prefeito Municipal', type: 'MAJORITARIO', orderNumber: 1 },
          { code: '13', name: 'Vereador', type: 'PROPORCIONAL', orderNumber: 2 }
        ],
        tseConfigs: [
          {
            roundNumber: 1,
            officeCode: null, // Resolve automaticamente todos os cargos da eleição
            officialElectionCode: '620',
            scopeType: 'MUNICIPAL',
            uf: 'SP',
            muniTseCode: '62910'
          },
          {
            roundNumber: 2,
            officeCode: '11',
            officialElectionCode: '621',
            scopeType: 'MUNICIPAL',
            uf: 'SP',
            muniTseCode: '62910'
          }
        ]
      });

      await activateElectionWizard(adminUser.id, saved.electionId, 'ATIVAR ELEIÇÃO');

      const fetchedUrls: string[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchedUrls.push(url);
        if (url.includes('c0011')) {
          return {
            ok: true,
            json: async () =>
              makeEa20Payload({
                ele: '620',
                t: '1',
                cdabr: '62910',
                cargoCd: '11',
                cargoName: 'Prefeito',
                candidates: [{ n: '44', nmu: 'CANDIDATO CAMPINAS', vap: '12000', pvap: '60,00' }]
              })
          } as any;
        }
        return {
          ok: true,
          json: async () =>
            makeEa20Payload({
              ele: '620',
              t: '1',
              cdabr: '62910',
              cargoCd: '13',
              cargoName: 'Vereador'
            })
        } as any;
      });

      const req = new Request('http://localhost/api/tse-results?round=1');
      const res = await getTseResultsRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('AVAILABLE');
      expect(data.year).toBe(2024);
      expect(data.uf).toBe('SP');
      expect(data.municipality).toBe('62910');
      expect(data.offices).toHaveLength(2);
      // Nome do cargo vem prioritariamente do Office cadastrado na eleição
      expect(data.offices[0].cargoName).toBe('Prefeito Municipal');
      expect(data.offices[0].candidates[0].name).toBe('CANDIDATO CAMPINAS');
      expect(data.offices[1].cargoName).toBe('Vereador');

      // Verifica ausência completa de acoplamento a ele2026, sc ou 80837
      expect(fetchedUrls).toHaveLength(2);
      expect(fetchedUrls[0]).toBe(
        'https://resultados.tse.jus.br/oficial/ele2024/620/dados/sp/sp62910-c0011-e000620-u.json'
      );
      expect(fetchedUrls[1]).toBe(
        'https://resultados.tse.jus.br/oficial/ele2024/620/dados/sp/sp62910-c0013-e000620-u.json'
      );
    });

    it('1.2 Ausência de TseSyncConfig ou ausência de eleição ativa retorna resposta controlada sem consultar TSE externo', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      // Caso A: Nenhuma eleição ativa
      const resNoElec = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resNoElec.status).toBe(200);
      expect(resNoElec.headers.get('Cache-Control')).toContain('no-store');
      const dataNoElec = await resNoElec.json();
      expect(dataNoElec.status).toBe('NOT_YET_AVAILABLE');
      expect(dataNoElec.error).toBe('CONFIGURACAO_TSE_AUSENTE');
      expect(fetchSpy).not.toHaveBeenCalled();

      // Caso B: Eleição ativa existente, mas sem TseSyncConfig cadastrado
      await prisma.election.create({
        data: {
          name: 'Eleição Sem Config TSE',
          slug: 'sem-config-tse',
          year: 2028,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      const resNoCfg = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resNoCfg.status).toBe(200);
      const dataNoCfg = await resNoCfg.json();
      expect(dataNoCfg.status).toBe('NOT_YET_AVAILABLE');
      expect(dataNoCfg.error).toBe('CONFIGURACAO_TSE_AUSENTE');
      expect(dataNoCfg.offices).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('1.3 Configuração pausada/desativada (isActive: false / PAUSED) não dispara fetch externo', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Pausada TSE',
          slug: 'eleicao-pausada',
          year: 2024,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: election.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:PR:75353',
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'PR',
          muniTseCode: '75353',
          status: 'PAUSED',
          isActive: false
        }
      });

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const res = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('NOT_YET_AVAILABLE');
      expect(data.error).toBe('CONFIGURACAO_TSE_PAUSADA');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('1.4 Configuração incompleta (sem município em escopo municipal, código inválido ou sem cargos) é rejeitada antes de chamar o TSE', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const election = await prisma.election.create({
        data: {
          name: 'Eleição Incompleta',
          slug: 'eleicao-incompleta',
          year: 2024,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      // Subcaso A: scopeType MUNICIPAL sem muniTseCode e sem ElectionScope
      const cfg = await prisma.tseSyncConfig.create({
        data: {
          electionId: election.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:SP:GLOBAL',
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'SP',
          muniTseCode: null,
          status: 'ACTIVE',
          isActive: true
        }
      });

      const resA = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resA.status).toBe(422);
      expect((await resA.json()).error).toBe('CONFIGURACAO_TSE_INCOMPLETA');
      expect(fetchSpy).not.toHaveBeenCalled();

      // Subcaso B: officeCode null sem cargos cadastrados na eleição
      await prisma.tseSyncConfig.update({
        where: { id: cfg.id },
        data: { officeCode: null, muniTseCode: '62910' }
      });

      const resB = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resB.status).toBe(422);
      expect((await resB.json()).error).toBe('CONFIGURACAO_TSE_INCOMPLETA');
      expect(fetchSpy).not.toHaveBeenCalled();

      // Subcaso C: officialElectionCode não numérico / vazio
      await prisma.tseSyncConfig.update({
        where: { id: cfg.id },
        data: { officeCode: '11', officialElectionCode: 'ABC_INV' }
      });

      const resC = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resC.status).toBe(422);
      expect((await resC.json()).error).toBe('CONFIGURACAO_TSE_INCOMPLETA');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('1.5 Configuração inconsistente (conflito de UF com ElectionScope ou sourceUrl insegura) é bloqueada com HTTP 422', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const statePR = await prisma.state.create({ data: { abbreviation: 'PR', name: 'Paraná' } });
      const muniCuritiba = await prisma.municipality.create({
        data: { officialCode: '75353', name: 'Curitiba', stateId: statePR.id, isCoverage: true }
      });

      const election = await prisma.election.create({
        data: {
          name: 'Eleição Curitiba 2024',
          slug: 'curitiba-2024',
          year: 2024,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } },
          scopes: {
            create: {
              scopeType: 'MUNICIPAL',
              scopeKey: 'MUNICIPAL:PR:75353',
              stateId: statePR.id,
              municipalityId: muniCuritiba.id,
              isCoverageArea: true
            }
          }
        }
      });

      // Subcaso A: UF conflitante (config diz SC enquanto escopo da eleição é PR/75353)
      const cfg = await prisma.tseSyncConfig.create({
        data: {
          electionId: election.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:SC:75353',
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'SC',
          muniTseCode: '75353',
          status: 'ACTIVE',
          isActive: true
        }
      });

      const resConflict = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resConflict.status).toBe(422);
      expect((await resConflict.json()).error).toBe('CONFIGURACAO_TSE_INCONSISTENTE');
      expect(fetchSpy).not.toHaveBeenCalled();

      // Subcaso B: sourceUrl apontando para IP de metadados / protocolo proibido (proteção SSRF)
      await prisma.tseSyncConfig.update({
        where: { id: cfg.id },
        data: { uf: 'PR', sourceUrl: 'http://169.254.169.254/latest/meta-data' }
      });

      const resSsrf = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resSsrf.status).toBe(422);
      expect((await resSsrf.json()).error).toBe('CONFIGURACAO_TSE_INCONSISTENTE');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Diversidade de Contexto Universal (Municípios, UFs, Anos, Eleições e Turnos)', () => {
    it('2.1 Suporta múltiplos municípios e UFs diferentes de Concórdia/SC e anos diferentes de 2026 (ex: Salvador/BA 2024 e Porto Alegre/RS 2028)', async () => {
      const eleSalvador = await prisma.election.create({
        data: {
          name: 'Eleição Salvador 2024',
          slug: 'salvador-2024',
          year: 2024,
          type: 'MUNICIPAL',
          status: 'FINISHED',
          rounds: { create: { roundNumber: 1, status: 'FINISHED' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: eleSalvador.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:BA:38490',
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'BA',
          muniTseCode: '38490',
          status: 'COMPLETED',
          isActive: true
        }
      });

      const elePortoAlegre = await prisma.election.create({
        data: {
          name: 'Eleição Porto Alegre 2028',
          slug: 'porto-alegre-2028',
          year: 2028,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: [
              { roundNumber: 1, status: 'FINISHED' },
              { roundNumber: 2, status: 'ACTIVE' }
            ]
          }
        }
      });

      await prisma.tseSyncConfig.createMany({
        data: [
          {
            electionId: elePortoAlegre.id,
            roundNumber: 1,
            configKey: 'R1:OFFICE-11:MUNICIPAL:RS:88013',
            officeCode: '11',
            officialElectionCode: '710',
            scopeType: 'MUNICIPAL',
            uf: 'RS',
            muniTseCode: '88013',
            status: 'COMPLETED',
            isActive: true
          },
          {
            electionId: elePortoAlegre.id,
            roundNumber: 2,
            configKey: 'R2:OFFICE-11:MUNICIPAL:RS:88013',
            officeCode: '11',
            officialElectionCode: '711',
            scopeType: 'MUNICIPAL',
            uf: 'RS',
            muniTseCode: '88013',
            status: 'ACTIVE',
            isActive: true
          }
        ]
      });

      const urlsCalled: string[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        urlsCalled.push(url);
        if (url.includes('ba38490')) {
          return {
            ok: true,
            json: async () => makeEa20Payload({ ele: '620', t: '1', cdabr: '38490', cargoCd: '11', cargoName: 'Prefeito' })
          } as any;
        }
        if (url.includes('e000710')) {
          return {
            ok: true,
            json: async () => makeEa20Payload({ ele: '710', t: '1', cdabr: '88013', cargoCd: '11', cargoName: 'Prefeito' })
          } as any;
        }
        return {
          ok: true,
          json: async () => makeEa20Payload({ ele: '711', t: '2', cdabr: '88013', cargoCd: '11', cargoName: 'Prefeito' })
        } as any;
      });

      // Consulta 1: Eleição histórica Salvador/BA 2024 (explícita por slug)
      const resSalvador = await getTseResultsRoute(
        new Request('http://localhost/api/tse-results?election=salvador-2024&round=1')
      );
      expect(resSalvador.status).toBe(200);
      const jsonSalvador = await resSalvador.json();
      expect(jsonSalvador.year).toBe(2024);
      expect(jsonSalvador.uf).toBe('BA');
      expect(jsonSalvador.municipality).toBe('38490');

      // Consulta 2: Porto Alegre 2028 Turno 1
      const resPoa1 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resPoa1.status).toBe(200);
      const jsonPoa1 = await resPoa1.json();
      expect(jsonPoa1.year).toBe(2028);
      expect(jsonPoa1.uf).toBe('RS');
      expect(jsonPoa1.municipality).toBe('88013');
      expect(jsonPoa1.round).toBe('1');

      // Consulta 3: Porto Alegre 2028 Turno 2
      const resPoa2 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=2'));
      expect(resPoa2.status).toBe(200);
      const jsonPoa2 = await resPoa2.json();
      expect(jsonPoa2.round).toBe('2');

      expect(urlsCalled[0]).toContain('/ele2024/620/dados/ba/ba38490-c0011-e000620-u.json');
      expect(urlsCalled[1]).toContain('/ele2028/710/dados/rs/rs88013-c0011-e000710-u.json');
      expect(urlsCalled[2]).toContain('/ele2028/711/dados/rs/rs88013-c0011-e000711-u.json');
    });

    it('2.2 Suporta consultas em escopo ESTADUAL (sem município) e escopo NACIONAL (BR)', async () => {
      const eleGerais = await prisma.election.create({
        data: {
          name: 'Eleições Gerais 2022',
          slug: 'gerais-2022',
          year: 2022,
          type: 'GENERAL',
          status: 'FINISHED',
          rounds: { create: { roundNumber: 1, status: 'FINISHED' } }
        }
      });

      await prisma.tseSyncConfig.createMany({
        data: [
          {
            electionId: eleGerais.id,
            roundNumber: 1,
            configKey: 'R1:OFFICE-1:NACIONAL:BR:GLOBAL',
            officeCode: '1',
            officialElectionCode: '544',
            scopeType: 'NACIONAL',
            uf: 'BR',
            muniTseCode: null,
            status: 'COMPLETED',
            isActive: true
          },
          {
            electionId: eleGerais.id,
            roundNumber: 1,
            configKey: 'R1:OFFICE-3:ESTADUAL:MG:GLOBAL',
            officeCode: '3',
            officialElectionCode: '546',
            scopeType: 'ESTADUAL',
            uf: 'MG',
            muniTseCode: null,
            status: 'COMPLETED',
            isActive: true
          }
        ]
      });

      const urls: string[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        urls.push(url);
        if (url.includes('/br/br-c0001')) {
          return {
            ok: true,
            json: async () => makeEa20Payload({ ele: '544', t: '1', cdabr: 'br', cargoCd: '1', cargoName: 'Presidente' })
          } as any;
        }
        return {
          ok: true,
          json: async () => makeEa20Payload({ ele: '546', t: '1', cdabr: 'mg', cargoCd: '3', cargoName: 'Governador' })
        } as any;
      });

      const res = await getTseResultsRoute(
        new Request('http://localhost/api/tse-results?election=gerais-2022&round=1')
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.offices).toHaveLength(2);
      expect(urls).toContain('https://resultados.tse.jus.br/oficial/ele2022/544/dados/br/br-c0001-e000544-u.json');
      expect(urls).toContain('https://resultados.tse.jus.br/oficial/ele2022/546/dados/mg/mg-c0003-e000546-u.json');
    });
  });

  describe('3. Cache de 15 Segundos e Isolamento Contextual', () => {
    it('3.1 Reutiliza cache dentro de 15s (cache hit) e expira exatamente após 15s', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T18:00:00.000Z'));

      const ele = await prisma.election.create({
        data: {
          name: 'Eleição Cache Test',
          slug: 'cache-test',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:PR:75353',
          officeCode: '11',
          officialElectionCode: '701',
          scopeType: 'MUNICIPAL',
          uf: 'PR',
          muniTseCode: '75353',
          status: 'ACTIVE',
          isActive: true
        }
      });

      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          json: async () =>
            makeEa20Payload({
              ele: '701',
              t: '1',
              cdabr: '75353',
              cargoCd: '11',
              cargoName: 'Prefeito',
              processed: String(fetchCount * 10)
            })
        } as any;
      });

      // t = 0s: cache miss -> chama fetch #1
      const res1 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      const json1 = await res1.json();
      expect(fetchCount).toBe(1);
      expect(json1.offices[0].progress.processed).toBe(10);

      // t = 14.999s: dentro dos 15s -> cache hit (não chama fetch)
      vi.advanceTimersByTime(14_999);
      const res2 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      const json2 = await res2.json();
      expect(fetchCount).toBe(1);
      expect(json2.offices[0].progress.processed).toBe(10);

      // t = 15.001s: expirado -> cache miss -> chama fetch #2 com dados novos
      vi.advanceTimersByTime(2);
      const res3 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      const json3 = await res3.json();
      expect(fetchCount).toBe(2);
      expect(json3.offices[0].progress.processed).toBe(20);
    });

    it('3.2 Isola cache por eleição, turno e município e invalida imediatamente após alteração de configuração', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T18:00:00.000Z'));

      const ele1 = await prisma.election.create({
        data: {
          name: 'Eleição Município X',
          slug: 'eleicao-muni-x',
          year: 2024,
          status: 'ACTIVE',
          rounds: {
            create: [
              { roundNumber: 1, status: 'ACTIVE' },
              { roundNumber: 2, status: 'ACTIVE' }
            ]
          }
        }
      });

      const cfgR1 = await prisma.tseSyncConfig.create({
        data: {
          electionId: ele1.id,
          roundNumber: 1,
          configKey: buildTseSyncConfigKey({ roundNumber: 1, officeCode: '11', scopeType: 'MUNICIPAL', uf: 'SP', muniTseCode: '62910' }),
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'SP',
          muniTseCode: '62910',
          status: 'ACTIVE',
          isActive: true
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele1.id,
          roundNumber: 2,
          configKey: buildTseSyncConfigKey({ roundNumber: 2, officeCode: '11', scopeType: 'MUNICIPAL', uf: 'SP', muniTseCode: '62910' }),
          officeCode: '11',
          officialElectionCode: '621',
          scopeType: 'MUNICIPAL',
          uf: 'SP',
          muniTseCode: '62910',
          status: 'ACTIVE',
          isActive: true
        }
      });

      const ele2 = await prisma.election.create({
        data: {
          name: 'Eleição Município Y',
          slug: 'eleicao-muni-y',
          year: 2024,
          status: 'FINISHED',
          rounds: { create: { roundNumber: 1, status: 'FINISHED' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele2.id,
          roundNumber: 1,
          configKey: buildTseSyncConfigKey({ roundNumber: 1, officeCode: '11', scopeType: 'MUNICIPAL', uf: 'MG', muniTseCode: '41238' }),
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'MG',
          muniTseCode: '41238',
          status: 'COMPLETED',
          isActive: true
        }
      });

      const fetchedUrls: string[] = [];
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchedUrls.push(url);
        if (url.includes('mg41238')) {
          return { ok: true, json: async () => makeEa20Payload({ ele: '620', t: '1', cdabr: '41238', cargoCd: '11', cargoName: 'Prefeito Y' }) } as any;
        }
        if (url.includes('e000621')) {
          return { ok: true, json: async () => makeEa20Payload({ ele: '621', t: '2', cdabr: '62910', cargoCd: '11', cargoName: 'Prefeito R2' }) } as any;
        }
        if (url.includes('sp71072')) {
          return { ok: true, json: async () => makeEa20Payload({ ele: '625', t: '1', cdabr: '71072', cargoCd: '11', cargoName: 'Prefeito Alterado' }) } as any;
        }
        return { ok: true, json: async () => makeEa20Payload({ ele: '620', t: '1', cdabr: '62910', cargoCd: '11', cargoName: 'Prefeito X' }) } as any;
      });

      // 1. Consulta Turno 1 de Eleição X (Município 62910)
      const r1 = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(r1.offices[0].cargoName).toBe('Prefeito X');

      // 2. Dentro de 2s, consulta Turno 2 de Eleição X -> NÃO pode reaproveitar cache do Turno 1
      vi.advanceTimersByTime(2000);
      const r2 = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=2'))).json();
      expect(r2.offices[0].cargoName).toBe('Prefeito R2');

      // 3. Dentro de 3s, consulta Eleição Y (Município MG 41238) -> NÃO pode misturar cache
      vi.advanceTimersByTime(1000);
      const y1 = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?election=eleicao-muni-y&round=1'))).json();
      expect(y1.offices[0].cargoName).toBe('Prefeito Y');
      expect(y1.municipality).toBe('41238');

      // 4. Altera configuração de Turno 1 de Eleição X (outro município/código TSE) dentro dos 15s!
      await prisma.tseSyncConfig.update({
        where: { id: cfgR1.id },
        data: {
          officialElectionCode: '625',
          muniTseCode: '71072'
        }
      });

      vi.advanceTimersByTime(1000);
      const r1Updated = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(r1Updated.municipality).toBe('71072');
      expect(r1Updated.offices[0].cargoName).toBe('Prefeito Alterado');
      expect(fetchedUrls).toHaveLength(4);
    });

    it('3.3 Não contamina cache com falhas externas (HTTP 500, timeout, INVALID_RESPONSE) nem com 404 (NOT_YET_AVAILABLE)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T18:00:00.000Z'));

      const ele = await prisma.election.create({
        data: {
          name: 'Eleição Cache Poison Test',
          slug: 'cache-poison-test',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-1:MUNICIPAL:PR:75353',
          officeCode: '1',
          officialElectionCode: '6257',
          scopeType: 'MUNICIPAL',
          uf: 'PR',
          muniTseCode: '75353',
          status: 'ACTIVE',
          isActive: true
        }
      });

      // Tentativa 1: Falha HTTP 500
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as any);
      const res500 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(res500.status).toBe(503);
      expect(res500.headers.get('Cache-Control')).toContain('no-store');

      // Tentativa 2 (1s depois): 404 NOT_YET_AVAILABLE -> também NÃO pode ser cacheada por 15s
      vi.advanceTimersByTime(1000);
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 } as any);
      const res404 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(res404.status).toBe(200);
      expect((await res404.json()).status).toBe('NOT_YET_AVAILABLE');
      expect(res404.headers.get('Cache-Control')).toContain('no-store');

      // Tentativa 3 (1s depois): TSE responde 200 OK com dados vazios legítimos (0 candidatos, 0 processadas)
      vi.advanceTimersByTime(1000);
      const fetchSuccess = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => makeEa20Payload({ ele: '6257', t: '1', cdabr: '75353', cargoCd: '1', cargoName: 'Presidente', processed: '0', candidates: [] })
      } as any);
      global.fetch = fetchSuccess;

      const resOkEmpty = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resOkEmpty.status).toBe(200);
      expect((await resOkEmpty.json()).status).toBe('AVAILABLE');
      expect(fetchSuccess).toHaveBeenCalledTimes(1);

      // Tentativa 4 (dentro dos 15s após sucesso válido): agora sim deve usar cache hit!
      vi.advanceTimersByTime(5000);
      const resCached = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resCached.status).toBe(200);
      expect(fetchSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Resiliência a Falhas Externas e Respostas Inválidas', () => {
    beforeEach(async () => {
      const ele = await prisma.election.create({
        data: {
          name: 'Eleição Resiliência TSE',
          slug: 'resiliencia-tse',
          year: 2024,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:CE:13897',
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'CE',
          muniTseCode: '13897',
          status: 'ACTIVE',
          isActive: true
        }
      });
    });

    it('4.1 Trata timeout do serviço externo retornando HTTP 503 sem travar nem expor detalhes internos', async () => {
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

      const res = await getDynamicTseResults(new Request('http://localhost/api/tse-results?round=1'), {
        timeoutMs: 50
      });

      expect(res.status).toBe(503);
      expect(res.headers['Cache-Control']).toContain('no-store');
      expect(res.body.status).toBe('TEMPORARILY_UNAVAILABLE');
      expect(res.body.error).toBe('SERVICO_EXTERNO_INDISPONIVEL');
      expect(JSON.stringify(res.body)).not.toContain('TSE_FETCH_TIMEOUT');
      expect(JSON.stringify(res.body)).not.toContain('https://');
    });

    it('4.2 Trata falha de conexão / rejeição de rede retornando HTTP 503 controlado', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:443 internal-proxy-secret'));

      const res = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.status).toBe('TEMPORARILY_UNAVAILABLE');
      expect(JSON.stringify(data)).not.toContain('internal-proxy-secret');
      expect(JSON.stringify(data)).not.toContain('ECONNREFUSED');
    });

    it('4.3 Trata JSON malformado, payload vazio ({}) e divergência de município/turno como INVALID_RESPONSE (HTTP 502)', async () => {
      // Subcaso A: JSON inválido
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
      } as any);
      const resSyntax = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resSyntax.status).toBe(502);
      expect((await resSyntax.json()).status).toBe('INVALID_RESPONSE');

      // Subcaso B: Objeto vazio {}
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      } as any);
      const resEmpty = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resEmpty.status).toBe(502);
      expect((await resEmpty.json()).status).toBe('INVALID_RESPONSE');

      // Subcaso C: Resposta de outro município (cdabr errado)
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => makeEa20Payload({ ele: '620', t: '1', cdabr: '80837', cargoCd: '11' })
      } as any);
      const resWrongAbr = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resWrongAbr.status).toBe(502);
      expect((await resWrongAbr.json()).status).toBe('INVALID_RESPONSE');
    });
  });

  describe('5. Segurança, Bloqueio de Proxy e Controle de Acesso', () => {
    it('5.1 Rejeita parâmetros inválidos de round e tentativas de injeção/sobrescrita (anti-proxy)', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      // Turnos inválidos
      for (const badRound of ['', '0', '3', '1abc', 'x']) {
        const res = await getTseResultsRoute(new Request(`http://localhost/api/tse-results?round=${badRound}`));
        expect(res.status).toBe(400);
      }

      // Tentativas de manipulação de UF, município, ano, eleCode ou URL arbitrária
      const tamperingUrls = [
        'http://localhost/api/tse-results?round=1&uf=sp',
        'http://localhost/api/tse-results?round=1&muni=71072',
        'http://localhost/api/tse-results?round=1&year=2022',
        'http://localhost/api/tse-results?round=1&eleCode=9999',
        'http://localhost/api/tse-results?round=1&url=https://attacker.example/data.json',
        'http://localhost/api/tse-results?round=1&sourceUrl=https://attacker.example',
        'http://localhost/api/tse-results?round=1&cargo=99'
      ];

      for (const url of tamperingUrls) {
        const res = await getTseResultsRoute(new Request(url));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe('PARAMETRO_NAO_PERMITIDO');
      }

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('5.2 Bloqueia consulta pública a eleições em estado DRAFT ou ARCHIVED com HTTP 403', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const draftEle = await prisma.election.create({
        data: {
          name: 'Rascunho Secreto',
          slug: 'rascunho-secreto',
          year: 2028,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: draftEle.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:PR:75353',
          officeCode: '11',
          officialElectionCode: '777',
          scopeType: 'MUNICIPAL',
          uf: 'PR',
          muniTseCode: '75353',
          isActive: true
        }
      });

      const archivedEle = await prisma.election.create({
        data: {
          name: 'Arquivada Privada',
          slug: 'arquivada-privada',
          year: 2024,
          status: 'ARCHIVED',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } }
        }
      });

      const resDraft = await getTseResultsRoute(
        new Request(`http://localhost/api/tse-results?election=${draftEle.slug}&round=1`)
      );
      expect(resDraft.status).toBe(403);
      expect((await resDraft.json()).error).toBe('CONTEXTO_NAO_AUTORIZADO');

      const resArch = await getTseResultsRoute(
        new Request(`http://localhost/api/tse-results?election=${archivedEle.id}&round=1`)
      );
      expect(resArch.status).toBe(403);
      expect((await resArch.json()).error).toBe('CONTEXTO_NAO_AUTORIZADO');

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('5.3 Não vaza sourceUrl configurada no banco nem detalhes internos nas respostas públicas', async () => {
      const ele = await prisma.election.create({
        data: {
          name: 'Eleição URL Privada',
          slug: 'url-privada',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-1:MUNICIPAL:SC:81051',
          officeCode: '1',
          officialElectionCode: '6257',
          scopeType: 'MUNICIPAL',
          uf: 'SC',
          muniTseCode: '81051',
          sourceUrl: 'https://mirror-interno.parceiro-tse.example/secret-token-path',
          status: 'ACTIVE',
          isActive: true
        }
      });

      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as any);
      const res = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      const text = await res.text();

      expect(res.status).toBe(503);
      expect(text).not.toContain('mirror-interno');
      expect(text).not.toContain('secret-token-path');
      expect(text).not.toContain('https://');
    });

    it('5.4 Rejeita consulta ambígua quando há múltiplas eleições ativas sem parâmetro ?election e permite seleção explícita', async () => {
      const e1 = await prisma.election.create({
        data: { name: 'Ativa 1', slug: 'ativa-1', year: 2024, status: 'ACTIVE', rounds: { create: { roundNumber: 1, status: 'ACTIVE' } } }
      });
      const e2 = await prisma.election.create({
        data: { name: 'Ativa 2', slug: 'ativa-2', year: 2026, status: 'ACTIVE', rounds: { create: { roundNumber: 1, status: 'ACTIVE' } } }
      });

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const resAmbiguous = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resAmbiguous.status).toBe(400);
      expect((await resAmbiguous.json()).error).toBe('ELEICOES_MULTIPLAS_ATIVAS');
      expect(fetchSpy).not.toHaveBeenCalled();

      // Selecionando explicitamente e1 (sem TseSyncConfig) e e2 (com TseSyncConfig) mantém isolamento total
      await prisma.tseSyncConfig.create({
        data: {
          electionId: e2.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-1:MUNICIPAL:PR:75353',
          officeCode: '1',
          officialElectionCode: '6257',
          scopeType: 'MUNICIPAL',
          uf: 'PR',
          muniTseCode: '75353',
          isActive: true
        }
      });

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => makeEa20Payload({ ele: '6257', t: '1', cdabr: '75353', cargoCd: '1', cargoName: 'Presidente' })
      } as any);

      const resExplicit2 = await getTseResultsRoute(new Request(`http://localhost/api/tse-results?election=${e2.slug}&round=1`));
      expect(resExplicit2.status).toBe(200);
      expect((await resExplicit2.json()).electionId).toBe(e2.id);

      const resExplicit1 = await getTseResultsRoute(new Request(`http://localhost/api/tse-results?election=${e1.slug}&round=1`));
      expect(resExplicit1.status).toBe(200);
      expect((await resExplicit1.json()).status).toBe('NOT_YET_AVAILABLE');
    });

    it('5.5 Setup Wizard (getWizardMetadata, saveElectionWizard e validateAndParseTseImport) persiste, expõe e invalida cache após atualização', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T18:00:00.000Z'));

      const parsedImport = validateAndParseTseImport({
        election: { name: 'Eleição Floripa', year: 2024, type: 'MUNICIPAL' },
        rounds: [{ roundNumber: 1, plei: '550' }],
        offices: [{ code: '11', name: 'Prefeito', type: 'MAJORITARIO' }],
        scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '81051', municipalityName: 'Florianópolis' }],
        tseConfigs: [{ roundNumber: 1, officeCode: '11', officialElectionCode: '620', scopeType: 'MUNICIPAL', uf: 'SC', muniTseCode: '81051' }]
      });
      expect(parsedImport.valid).toBe(true);
      expect(parsedImport.data.tseConfigs).toHaveLength(1);

      const saved = await saveElectionWizard(adminUser.id, {
        name: 'Eleição Floripa 2024',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: parsedImport.data.scopes,
        rounds: parsedImport.data.rounds,
        offices: parsedImport.data.offices,
        tseConfigs: parsedImport.data.tseConfigs
      });

      await activateElectionWizard(adminUser.id, saved.electionId, 'ATIVAR ELEIÇÃO');

      const meta = await getWizardMetadata(saved.electionId);
      expect(meta.election?.tseConfigs).toHaveLength(1);
      expect(meta.election?.tseConfigs[0].officialElectionCode).toBe('620');

      const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('e000622')) {
          return { ok: true, json: async () => makeEa20Payload({ ele: '622', t: '1', cdabr: '81051', cargoCd: '11', cargoName: 'Prefeito', processed: '99' }) } as any;
        }
        return { ok: true, json: async () => makeEa20Payload({ ele: '620', t: '1', cdabr: '81051', cargoCd: '11', cargoName: 'Prefeito', processed: '15' }) } as any;
      });
      global.fetch = fetchSpy;

      const resBefore = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(resBefore.offices[0].progress.processed).toBe(15);

      // Altera apenas tseConfigs via Setup Wizard dentro da janela de 15s (deve invalidar cache antigo)
      await saveElectionWizard(adminUser.id, {
        electionId: saved.electionId,
        name: 'Eleição Floripa 2024',
        year: 2024,
        type: 'MUNICIPAL',
        tseConfigs: [{ roundNumber: 1, officeCode: '11', officialElectionCode: '622', scopeType: 'MUNICIPAL', uf: 'SC', muniTseCode: '81051' }]
      });

      vi.advanceTimersByTime(2000);
      const resAfter = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(resAfter.offices[0].progress.processed).toBe(99);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('6. Correções Pós-Auditoria (P1 Anti-SSRF/DNS Rebinding, P2 Fingerprint Completo e Política Parcial)', () => {
    it('6.1 (P1) Bloqueia integralmente IPv4 loopback, privado, link-local/metadata, unspecified, CGNAT, multicast, reservado e representações alternativas', () => {
      const blockedIpv4Urls = [
        // Loopback 127.0.0.0/8 completo
        'https://127.0.0.1/ea20.json',
        'https://127.0.1.1/ea20.json',
        'https://127.255.255.254/ea20.json',
        // Privados RFC 1918
        'https://10.0.0.1/ea20.json',
        'https://172.16.0.1/ea20.json',
        'https://172.31.255.254/ea20.json',
        'https://192.168.1.10/ea20.json',
        // Link-local / Cloud Metadata
        'https://169.254.169.254/latest/meta-data',
        'https://169.254.0.1/ea20.json',
        // Unspecified / This network / CGNAT / Multicast / Broadcast / TEST-NETs
        'https://0.0.0.0/ea20.json',
        'https://0.1.2.3/ea20.json',
        'https://100.64.0.1/ea20.json',
        'https://100.127.255.254/ea20.json',
        'https://224.0.0.1/ea20.json',
        'https://239.255.255.255/ea20.json',
        'https://240.0.0.1/ea20.json',
        'https://255.255.255.255/ea20.json',
        'https://192.0.2.1/ea20.json',
        'https://198.51.100.1/ea20.json',
        'https://203.0.113.1/ea20.json',
        'https://198.18.0.1/ea20.json',
        // Representações alternativas (decimal, hex, octal, abreviada)
        'https://2130706433/ea20.json',
        'https://0x7f000001/ea20.json',
        'https://0177.0.0.1/ea20.json',
        'https://127.1/ea20.json',
        'https://2852039166/ea20.json',
        'https://0xa9fea9fe/latest/meta-data',
        'https://0251.0376.0251.0376/ea20.json',
        'https://0/ea20.json'
      ];

      for (const badUrl of blockedIpv4Urls) {
        expect(validateTseSourceUrl(badUrl).valid, `Esperava bloqueio para ${badUrl}`).toBe(false);
      }

      // Validação direta de normalização de IPs alternativos
      expect(parseAndNormalizeIPv4('0177.0.0.1')).toBe((127 << 24) | 1);
      expect(parseAndNormalizeIPv4('0x7f000001')).toBe((127 << 24) | 1);
      expect(parseAndNormalizeIPv4('2130706433')).toBe((127 << 24) | 1);
      expect(parseAndNormalizeIPv4('127.1')).toBe((127 << 24) | 1);
      expect(isPublicIpAddress('0177.0.0.1')).toBe(false);
      expect(isPublicIpAddress('2130706433')).toBe(false);
      expect(isPublicIpAddress('0xa9fea9fe')).toBe(false);
      expect(isPublicIpAddress('200.160.2.3')).toBe(true);
      expect(isPublicIpAddress('23.196.224.226')).toBe(true);
    });

    it('6.2 (P1) Bloqueia IPv6 não público (loopback, unspecified, link-local, ULA, multicast, documentação e IPv4-mapeado) e aceita IPv6 público', () => {
      const blockedIpv6Urls = [
        'https://[::1]/ea20.json',
        'https://[0000:0000:0000:0000:0000:0000:0000:0001]/ea20.json',
        'https://[::]/ea20.json',
        'https://[fe80::1]/ea20.json',
        'https://[fc00::1]/ea20.json',
        'https://[fd00:ec2::254]/latest/meta-data',
        'https://[ff02::1]/ea20.json',
        'https://[2001:db8::1]/ea20.json',
        'https://[3fff::1]/ea20.json',
        'https://[100::1]/ea20.json',
        'https://[2002:7f00:1::1]/ea20.json',
        'https://[::ffff:127.0.0.1]/ea20.json',
        'https://[::ffff:7f00:1]/ea20.json',
        'https://[::ffff:169.254.169.254]/ea20.json',
        'https://[::ffff:a9fe:a9fe]/ea20.json',
        'https://[::ffff:10.0.0.1]/ea20.json',
        'https://[::ffff:0.0.0.0]/ea20.json'
      ];

      for (const badUrl of blockedIpv6Urls) {
        expect(validateTseSourceUrl(badUrl).valid, `Esperava bloqueio IPv6 para ${badUrl}`).toBe(false);
      }

      expect(isPublicIpAddress('fe80::1%eth0')).toBe(false);
      expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
      expect(isPublicIpAddress('2600:1419:3e00:3::214:b643')).toBe(true);

      expect(validateTseSourceUrl('https://[2606:4700:4700::1111]/oficial/ea20.json').valid).toBe(true);
      expect(validateTseSourceUrl('https://23.196.224.226/oficial/ea20.json').valid).toBe(true);
    });

    it('6.3 (P1) Bloqueia HTTP/localhost em produção sem qualquer bypass e rejeita hostnames internos/metadata', () => {
      // Mesmo em ambiente de teste, URL localhost sem opt-in explícito é rejeitada
      expect(validateTseSourceUrl('http://localhost:3000/ea20.json').valid).toBe(false);
      expect(validateTseSourceUrl('https://localhost/ea20.json').valid).toBe(false);
      expect(validateTseSourceUrl('https://localhost./ea20.json').valid).toBe(false);
      expect(validateTseSourceUrl('https://sub.localhost/ea20.json').valid).toBe(false);
      expect(validateTseSourceUrl('http://127.0.0.1:8080/ea20.json').valid).toBe(false);
      expect(validateTseSourceUrl('https://metadata.google.internal/computeMetadata/v1').valid).toBe(false);
      expect(validateTseSourceUrl('https://metadata/latest').valid).toBe(false);
      expect(validateTseSourceUrl('https://mirror-interno.tse.local/ea20.json').valid).toBe(false);
      expect(validateTseSourceUrl('https://servico.internal/ea20.json').valid).toBe(false);
      expect(validateTseSourceUrl('https://user:pass@resultados.tse.jus.br/ea20.json').valid).toBe(false);

      // Em produção, mesmo passando allowTestLoopbackHttp: true não existe bypass
      vi.stubEnv('NODE_ENV', 'production');
      expect(validateTseSourceUrl('http://localhost:3000/ea20.json', { allowTestLoopbackHttp: true }).valid).toBe(false);
      expect(validateTseSourceUrl('http://127.0.0.1:8080/ea20.json', { allowTestLoopbackHttp: true }).valid).toBe(false);
      expect(validateTseSourceUrl('https://localhost/ea20.json', { allowTestLoopbackHttp: true }).valid).toBe(false);
      expect(validateTseSourceUrl('http://[::1]:3000/ea20.json', { allowTestLoopbackHttp: true }).valid).toBe(false);
      expect(validateTseSourceUrl('https://resultados.tse.jus.br/oficial').valid).toBe(true);
    });

    it('6.4 (P1) Resolve DNS validando todos os registros (bloqueando DNS privado e multi-registro misto) e integrando ao Wizard e Endpoint', async () => {
      // Subcaso A: DNS privado único
      const privateDns = await resolveAndValidateTseSourceUrl('https://evil-private.example/ea20.json', {
        dnsLookup: async () => [{ address: '10.20.30.40', family: 4 }]
      });
      expect(privateDns.valid).toBe(false);

      // Subcaso B: DNS com múltiplos registros (um público e outro privado/loopback/IPv6 ULA) -> fail-closed
      const mixedDns4 = await resolveAndValidateTseSourceUrl('https://evil-mixed4.example/ea20.json', {
        dnsLookup: async () => [
          { address: '23.196.224.226', family: 4 },
          { address: '169.254.169.254', family: 4 }
        ]
      });
      expect(mixedDns4.valid).toBe(false);

      const mixedDns6 = await resolveAndValidateTseSourceUrl('https://evil-mixed6.example/ea20.json', {
        dnsLookup: async () => [
          { address: '2606:4700:4700::1111', family: 6 },
          { address: 'fd00:ec2::254', family: 6 }
        ]
      });
      expect(mixedDns6.valid).toBe(false);

      // Subcaso C: Destino público válido com múltiplos registros (IPv4 + IPv6)
      const validPublicDns = await resolveAndValidateTseSourceUrl('https://resultados-publicos.example/ea20.json', {
        dnsLookup: async () => [
          { address: '23.196.224.226', family: 4 },
          { address: '2600:1419:3e00:3::214:b643', family: 6 }
        ]
      });
      expect(validPublicDns.valid).toBe(true);
      if (validPublicDns.valid) {
        expect(validPublicDns.resolvedAddresses).toHaveLength(2);
      }

      // Subcaso D: Setup Wizard rejeita sourceUrl cujo DNS aponta para IP interno antes de persistir
      await expect(
        saveElectionWizard(
          adminUser.id,
          {
            name: 'Eleição Wizard DNS Privado',
            year: 2026,
            type: 'MUNICIPAL',
            tseConfigs: [
              {
                roundNumber: 1,
                officeCode: '11',
                officialElectionCode: '620',
                scopeType: 'MUNICIPAL',
                uf: 'SP',
                muniTseCode: '62910',
                sourceUrl: 'https://ssrf-wizard-dns.example/ea20.json'
              }
            ]
          },
          { dnsLookup: async () => [{ address: '192.168.0.50', family: 4 }] }
        )
      ).rejects.toThrow();

      // Subcaso E: Endpoint /api/tse-results bloqueia com 422 quando DNS resolve registro misto sem chamar fetch
      const ele = await prisma.election.create({
        data: {
          name: 'Eleição DNS Mixed',
          slug: 'eleicao-dns-mixed',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-11:MUNICIPAL:SP:62910',
          officeCode: '11',
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'SP',
          muniTseCode: '62910',
          sourceUrl: 'https://dns-mixed.parceiro.example',
          status: 'ACTIVE',
          isActive: true
        }
      });

      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as any;

      const resBlocked = await getDynamicTseResults(new Request('http://localhost/api/tse-results?round=1'), {
        dnsLookup: async () => [
          { address: '23.196.224.226', family: 4 },
          { address: '127.0.0.1', family: 4 }
        ]
      });

      expect(resBlocked.status).toBe(422);
      expect(resBlocked.body.error).toBe('CONFIGURACAO_TSE_INCONSISTENTE');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('6.5 (P1) Protege contra DNS rebinding fixando IPs validados no socket, bloqueia redirecionamentos 3xx e bloqueia servidor HTTP local em produção', async () => {
      // 1. Verifica fixação de DNS no socket (createPinnedDnsLookup) sem re-resolver durante o fetch
      let lookupCalls = 0;
      const rebindingDns = async () => {
        lookupCalls += 1;
        if (lookupCalls === 1) {
          return [{ address: '23.196.224.226', family: 4 }];
        }
        return [{ address: '127.0.0.1', family: 4 }];
      };

      const firstResolution = await resolveAndValidateTseSourceUrl('https://rebind-test.example/ea20.json', {
        dnsLookup: rebindingDns
      });
      expect(firstResolution.valid).toBe(true);
      if (firstResolution.valid) {
        const pinnedLookup = createPinnedDnsLookup(firstResolution.hostname, firstResolution.resolvedAddresses);
        const resolvedDuringSocket = await new Promise<any>((resolve, reject) => {
          pinnedLookup('rebind-test.example', { all: true }, (err, addrs) => {
            if (err) reject(err);
            else resolve(addrs);
          });
        });
        expect(resolvedDuringSocket).toEqual([{ address: '23.196.224.226', family: 4 }]);
        // Lookup externo ocorreu apenas 1 vez antes da conexão, não durante a conexão
        expect(lookupCalls).toBe(1);
      }

      // Na consulta seguinte após o rebinding para 127.0.0.1, o acesso é bloqueado
      const secondResolution = await resolveAndValidateTseSourceUrl('https://rebind-test.example/ea20.json', {
        dnsLookup: rebindingDns
      });
      expect(secondResolution.valid).toBe(false);
      expect(lookupCalls).toBe(2);

      // 2. Servidor HTTP efêmero real em 127.0.0.1 para validar transporte fixado + bloqueio de redirect + bloqueio em produção
      let serverHits = 0;
      const server = http.createServer((req, res) => {
        serverHits += 1;
        if (req.url?.startsWith('/redirect-ssrf')) {
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            makeEa20Payload({ ele: '620', t: '1', cdabr: '62910', cargoCd: '11', cargoName: 'Prefeito Loopback' })
          )
        );
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as { port: number };
      const localUrl = `http://127.0.0.1:${addr.port}/ea20.json`;
      const redirectUrl = `http://127.0.0.1:${addr.port}/redirect-ssrf.json`;

      try {
        const ele = await prisma.election.create({
          data: {
            name: 'Eleição Transporte Pinned',
            slug: 'transporte-pinned',
            year: 2024,
            status: 'ACTIVE',
            rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
          }
        });

        const cfg = await prisma.tseSyncConfig.create({
          data: {
            electionId: ele.id,
            roundNumber: 1,
            configKey: 'R1:OFFICE-11:MUNICIPAL:SP:62910',
            officeCode: '11',
            officialElectionCode: '620',
            scopeType: 'MUNICIPAL',
            uf: 'SP',
            muniTseCode: '62910',
            sourceUrl: localUrl,
            status: 'ACTIVE',
            isActive: true
          }
        });

        // A) Sem opt-in de teste: bloqueado com 422 sem tocar no servidor
        const resNoOptIn = await getDynamicTseResults(new Request('http://localhost/api/tse-results?round=1'));
        expect(resNoOptIn.status).toBe(422);
        expect(serverHits).toBe(0);

        // B) Em produção, até com allowTestLoopbackHttp: true continua bloqueado com 422 sem tocar no servidor
        vi.stubEnv('NODE_ENV', 'production');
        const resProd = await getDynamicTseResults(new Request('http://localhost/api/tse-results?round=1'), {
          allowTestLoopbackHttp: true
        });
        expect(resProd.status).toBe(422);
        expect(serverHits).toBe(0);
        vi.unstubAllEnvs();

        // C) No ambiente de teste com opt-in explícito: executa via transporte socket fixado real (global.fetch NÃO mockado)
        const resTestOk = await getDynamicTseResults(new Request('http://localhost/api/tse-results?round=1'), {
          allowTestLoopbackHttp: true
        });
        expect(resTestOk.status).toBe(200);
        expect(resTestOk.body.status).toBe('AVAILABLE');
        expect(resTestOk.body.offices[0].cargoName).toBe('Prefeito Loopback');
        expect(serverHits).toBe(1);

        // D) Redirecionamento 302 -> 169.254.169.254 é bloqueado no transporte sem seguir Location
        clearTseResultsCache();
        await prisma.tseSyncConfig.update({ where: { id: cfg.id }, data: { sourceUrl: redirectUrl } });
        const resRedirectBlocked = await getDynamicTseResults(
          new Request('http://localhost/api/tse-results?round=1'),
          { allowTestLoopbackHttp: true }
        );
        expect(resRedirectBlocked.status).toBe(503);
        expect(resRedirectBlocked.body.status).toBe('TEMPORARILY_UNAVAILABLE');
        expect(serverHits).toBe(2);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('6.6 (P2) Fingerprint completo invalida cache dentro dos 15s quando Office (nome, código, ordenação, cadastro) ou ElectionScope mudam, mantendo isolamento', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T18:00:00.000Z'));

      const stateSP = await prisma.state.create({ data: { abbreviation: 'SP', name: 'São Paulo' } });
      const muniA = await prisma.municipality.create({
        data: { officialCode: '62910', name: 'Campinas', stateId: stateSP.id, isCoverage: true }
      });

      const ele1 = await prisma.election.create({
        data: {
          name: 'Eleição Fingerprint 1',
          slug: 'ele-fp-1',
          year: 2024,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: [
              { roundNumber: 1, status: 'ACTIVE' },
              { roundNumber: 2, status: 'ACTIVE' }
            ]
          },
          scopes: {
            create: {
              scopeType: 'MUNICIPAL',
              scopeKey: 'MUNICIPAL:SP:62910',
              stateId: stateSP.id,
              municipalityId: muniA.id,
              isCoverageArea: true
            }
          },
          offices: {
            create: [
              { code: '11', name: 'Prefeito Inicial', type: 'MAJORITARIO', orderNumber: 1 },
              { code: '13', name: 'Vereador Inicial', type: 'PROPORCIONAL', orderNumber: 2 }
            ]
          }
        },
        include: { offices: true, scopes: true }
      });

      await prisma.tseSyncConfig.createMany({
        data: [
          {
            electionId: ele1.id,
            roundNumber: 1,
            configKey: 'R1:OFFICE-ALL:MUNICIPAL:SP:62910',
            officeCode: null,
            officialElectionCode: '620',
            scopeType: 'MUNICIPAL',
            uf: 'SP',
            muniTseCode: '62910',
            status: 'ACTIVE',
            isActive: true
          },
          {
            electionId: ele1.id,
            roundNumber: 2,
            configKey: 'R2:OFFICE-11:MUNICIPAL:SP:62910',
            officeCode: '11',
            officialElectionCode: '621',
            scopeType: 'MUNICIPAL',
            uf: 'SP',
            muniTseCode: '62910',
            status: 'ACTIVE',
            isActive: true
          }
        ]
      });

      let fetchCalls = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls += 1;
        const isR2 = url.includes('e000621');
        const cargoMatch = url.match(/-c0*(\d+)-/);
        const cargoCd = cargoMatch ? cargoMatch[1] : '11';
        return {
          ok: true,
          json: async () =>
            makeEa20Payload({
              ele: isR2 ? '621' : '620',
              t: isR2 ? '2' : '1',
              cdabr: '62910',
              cargoCd,
              cargoName: `Cargo ${cargoCd}`
            })
        } as any;
      }) as any;

      // 1. Popula cache de R1 (2 cargos) e R2 (1 cargo)
      const r1First = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(r1First.offices.map((o: any) => o.cargo)).toEqual(['11', '13']);
      expect(r1First.offices[0].cargoName).toBe('Prefeito Inicial');
      expect(fetchCalls).toBe(2);

      const r2First = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=2'))).json();
      expect(r2First.offices[0].cargoName).toBe('Prefeito Inicial');
      expect(fetchCalls).toBe(3);

      // 2. Alteração no nome do Office dentro da janela de 15s deve invalidar R1 (e R2 quando consultado)
      const off11 = ele1.offices.find(o => o.code === '11')!;
      const off13 = ele1.offices.find(o => o.code === '13')!;
      await prisma.office.update({ where: { id: off11.id }, data: { name: 'Prefeito Atualizado' } });

      vi.advanceTimersByTime(1000);
      const r1AfterName = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(r1AfterName.offices[0].cargoName).toBe('Prefeito Atualizado');
      expect(fetchCalls).toBe(5);

      // 3. Alteração na ordenação (orderNumber) dos cargos dentro dos 15s invalida e reordena
      await prisma.office.update({ where: { id: off11.id }, data: { orderNumber: 2 } });
      await prisma.office.update({ where: { id: off13.id }, data: { orderNumber: 1 } });

      vi.advanceTimersByTime(1000);
      const r1AfterOrder = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(r1AfterOrder.offices.map((o: any) => o.cargo)).toEqual(['13', '11']);
      expect(fetchCalls).toBe(7);

      // 4. Alteração no código do cargo (code) dentro dos 15s invalida imediatamente
      await prisma.office.update({ where: { id: off13.id }, data: { code: '12', name: 'Vereador Novo Código' } });

      vi.advanceTimersByTime(1000);
      const r1AfterCode = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(r1AfterCode.offices.map((o: any) => o.cargo)).toEqual(['12', '11']);
      expect(r1AfterCode.offices[0].cargoName).toBe('Vereador Novo Código');
      expect(fetchCalls).toBe(9);

      // 5. Inclusão de novo cargo (Office) dentro dos 15s invalida imediatamente
      await prisma.office.create({
        data: { electionId: ele1.id, code: '15', name: 'Cargo Extra', type: 'MAJORITARIO', orderNumber: 3 }
      });

      vi.advanceTimersByTime(1000);
      const r1AfterAddOffice = await (await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'))).json();
      expect(r1AfterAddOffice.offices.map((o: any) => o.cargo)).toEqual(['12', '11', '15']);
      expect(fetchCalls).toBe(12);

      // 6. Alteração em ElectionScope (escopo territorial adicional ou isCoverageArea) dentro dos 15s invalida cache
      const muniB = await prisma.municipality.create({
        data: { officialCode: '71072', name: 'São Paulo', stateId: stateSP.id, isCoverage: true }
      });
      await prisma.electionScope.create({
        data: {
          electionId: ele1.id,
          scopeType: 'MUNICIPAL',
          scopeKey: 'MUNICIPAL:SP:71072',
          stateId: stateSP.id,
          municipalityId: muniB.id,
          isCoverageArea: true
        }
      });

      vi.advanceTimersByTime(1000);
      await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(fetchCalls).toBe(15);

      // Dentro dos 15s sem novas alterações, o resultado volta a ser reutilizado do cache
      vi.advanceTimersByTime(2000);
      await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(fetchCalls).toBe(15);

      // Fingerprint unitário direto confirma sensibilidade a escopo e ordenação de cargo
      const fp1 = computeTseConfigFingerprint({
        configs: [],
        scopes: [{ scopeType: 'ESTADUAL', scopeKey: 'ESTADUAL:SP', isCoverageArea: true }],
        offices: [
          { code: '1', name: 'Presidente', orderNumber: 1 },
          { code: '3', name: 'Governador', orderNumber: 2 }
        ]
      });
      const fpReordered = computeTseConfigFingerprint({
        configs: [],
        scopes: [{ scopeType: 'ESTADUAL', scopeKey: 'ESTADUAL:SP', isCoverageArea: true }],
        offices: [
          { code: '1', name: 'Presidente', orderNumber: 2 },
          { code: '3', name: 'Governador', orderNumber: 1 }
        ]
      });
      const fpScopeChanged = computeTseConfigFingerprint({
        configs: [],
        scopes: [{ scopeType: 'ESTADUAL', scopeKey: 'ESTADUAL:RJ', isCoverageArea: true }],
        offices: [
          { code: '1', name: 'Presidente', orderNumber: 1 },
          { code: '3', name: 'Governador', orderNumber: 2 }
        ]
      });
      expect(fp1).not.toBe(fpReordered);
      expect(fp1).not.toBe(fpScopeChanged);
    });

    it('6.7 (P2) Aplica política explícita de cacheabilidade para resposta integral, parcial (404/rede/timeout/inválido) e falhas totais', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T19:00:00.000Z'));

      // Verificações diretas de isCacheableTseResponse
      expect(
        isCacheableTseResponse({
          source: 'TSE',
          round: '1',
          municipality: '62910',
          status: 'AVAILABLE',
          offices: [
            { status: 'AVAILABLE', cargo: '11' },
            { status: 'AVAILABLE', cargo: '13' }
          ]
        })
      ).toBe(true);

      for (const badPartialStatus of ['NOT_YET_AVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'INVALID_RESPONSE'] as const) {
        expect(
          isCacheableTseResponse({
            source: 'TSE',
            round: '1',
            municipality: '62910',
            status: 'AVAILABLE',
            offices: [
              { status: 'AVAILABLE', cargo: '11' },
              { status: badPartialStatus, cargo: '13' }
            ]
          })
        ).toBe(false);
      }

      const ele = await prisma.election.create({
        data: {
          name: 'Eleição Política Cache Parcial',
          slug: 'ele-cache-parcial',
          year: 2024,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } },
          offices: {
            create: [
              { code: '11', name: 'Prefeito', type: 'MAJORITARIO', orderNumber: 1 },
              { code: '13', name: 'Vereador', type: 'PROPORCIONAL', orderNumber: 2 }
            ]
          }
        }
      });

      await prisma.tseSyncConfig.create({
        data: {
          electionId: ele.id,
          roundNumber: 1,
          configKey: 'R1:OFFICE-ALL:MUNICIPAL:SP:62910',
          officeCode: null,
          officialElectionCode: '620',
          scopeType: 'MUNICIPAL',
          uf: 'SP',
          muniTseCode: '62910',
          status: 'ACTIVE',
          isActive: true
        }
      });

      // Cenário A: Parcial por 404 (c0011 AVAILABLE + c0013 NOT_YET_AVAILABLE) -> HTTP 200 parcial, NÃO cacheado
      let callCount = 0;
      let cargo13State: '404' | '500' | 'INVALID' | 'TIMEOUT' | 'OK' = '404';
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        callCount += 1;
        if (url.includes('c0011')) {
          return {
            ok: true,
            json: async () => makeEa20Payload({ ele: '620', t: '1', cdabr: '62910', cargoCd: '11', cargoName: 'Prefeito' })
          } as any;
        }
        if (cargo13State === '404') return { ok: false, status: 404 } as any;
        if (cargo13State === '500') return { ok: false, status: 500 } as any;
        if (cargo13State === 'INVALID') return { ok: true, json: async () => ({ unexpected: true }) } as any;
        if (cargo13State === 'TIMEOUT') return new Promise(() => {});
        return {
          ok: true,
          json: async () => makeEa20Payload({ ele: '620', t: '1', cdabr: '62910', cargoCd: '13', cargoName: 'Vereador' })
        } as any;
      }) as any;

      const resPartial404 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resPartial404.status).toBe(200);
      expect(resPartial404.headers.get('Cache-Control')).toContain('no-store');
      const bodyPartial404 = await resPartial404.json();
      expect(bodyPartial404.status).toBe('AVAILABLE');
      expect(bodyPartial404.offices[0].status).toBe('AVAILABLE');
      expect(bodyPartial404.offices[1].status).toBe('NOT_YET_AVAILABLE');

      // Cenário B: Parcial por falha de rede / HTTP 500 -> HTTP 200 parcial, NÃO cacheado
      vi.advanceTimersByTime(1000);
      cargo13State = '500';
      const resPartial500 = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resPartial500.status).toBe(200);
      expect(resPartial500.headers.get('Cache-Control')).toContain('no-store');
      expect((await resPartial500.json()).offices[1].status).toBe('TEMPORARILY_UNAVAILABLE');

      // Cenário C: Parcial por payload inválido -> HTTP 200 parcial, NÃO cacheado
      vi.advanceTimersByTime(1000);
      cargo13State = 'INVALID';
      const resPartialInvalid = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resPartialInvalid.status).toBe(200);
      expect(resPartialInvalid.headers.get('Cache-Control')).toContain('no-store');
      expect((await resPartialInvalid.json()).offices[1].status).toBe('INVALID_RESPONSE');

      // Cenário D: Resposta integralmente válida (todos os cargos AVAILABLE) -> cacheada por 15s!
      vi.advanceTimersByTime(1000);
      cargo13State = 'OK';
      const callsBeforeFull = callCount;
      const resFull = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resFull.status).toBe(200);
      expect(resFull.headers.get('Cache-Control')).toContain('max-age=15');
      const bodyFull = await resFull.json();
      expect(bodyFull.offices.every((o: any) => o.status === 'AVAILABLE')).toBe(true);
      expect(callCount).toBe(callsBeforeFull + 2);

      // Próxima consulta dentro dos 15s reaproveita o cache integral sem novo fetch
      vi.advanceTimersByTime(3000);
      const resFullHit = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resFullHit.status).toBe(200);
      expect(resFullHit.headers.get('Cache-Control')).toContain('max-age=15');
      expect(callCount).toBe(callsBeforeFull + 2);

      // Cenário E: Parcial por timeout externo -> HTTP 200 parcial, NÃO cacheado e recuperação imediata
      vi.useRealTimers();
      clearTseResultsCache();
      cargo13State = 'TIMEOUT';
      const resPartialTimeout = await getDynamicTseResults(
        new Request('http://localhost/api/tse-results?round=1'),
        { timeoutMs: 40 }
      );
      expect(resPartialTimeout.status).toBe(200);
      expect(resPartialTimeout.headers['Cache-Control']).toContain('no-store');
      expect(resPartialTimeout.body.status).toBe('AVAILABLE');
      expect(resPartialTimeout.body.offices[1].status).toBe('TEMPORARILY_UNAVAILABLE');

      cargo13State = 'OK';
      const resRecovered = await getTseResultsRoute(new Request('http://localhost/api/tse-results?round=1'));
      expect(resRecovered.status).toBe(200);
      expect(resRecovered.headers.get('Cache-Control')).toContain('max-age=15');
      expect((await resRecovered.json()).offices.every((o: any) => o.status === 'AVAILABLE')).toBe(true);
    });
  });
});
