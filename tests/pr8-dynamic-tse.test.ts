import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { buildTseSyncConfigKey } from '../src/lib/validation/electionContext';
import { clearTseResultsCache } from '../src/lib/tse/tseResultsCache';
import { getDynamicTseResults } from '../src/lib/tse/tseResultsService';
import { GET as getTseResultsRoute } from '../src/app/api/tse-results/route';
import { saveElectionWizard, activateElectionWizard, getWizardMetadata, validateAndParseTseImport } from '../src/lib/wizard/wizardService';

describe('PR 8 — Adaptador Dinâmico de Integração com o TSE (Universal & Cache 15s)', () => {
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
          sourceUrl: 'https://mirror-interno.tse.local/secret-token-path',
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
});
