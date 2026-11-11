import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../src/lib/db';
import * as auth from '../src/lib/auth';
import { GET as urnasFeedRoute } from '../src/app/api/urnas/route';
import { GET as urnaDetailRoute } from '../src/app/api/urnas/[id]/route';
import { POST as confirmReportRoute } from '../src/app/api/reports/[id]/confirm/route';
import { encodeUrnaCursor } from '../src/lib/presentation/urnaCursor';
import { toCryptographicStatus, resolveCryptographicStatus } from '../src/lib/presentation/pressDto';

describe('PR 7 — Feed de Últimas Urnas e Paginação por Keyset Cursor (PAG-01 a PAG-30)', () => {
  let electionA: any;
  let roundA1: any;
  let roundA2: any;
  let electionB: any;
  let roundB1: any;

  let stateSC: any;
  let muniConcordia: any;
  let zone9: any;
  let zone10: any;
  let sec42: any;
  let sec43: any;
  let sec50: any;

  let partyPL: any;
  let partyPT: any;
  let officePres: any;
  let cand22: any;
  let cand13: any;

  let adminUser: any;

  // Armazena IDs criados para testes de paginação
  const confirmedReportIds: string[] = [];
  const historicalReportIds: string[] = [];

  beforeAll(async () => {
    // 1. Limpeza segura da base de testes
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.pollingStation.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.office.deleteMany();
    await prisma.party.deleteMany();
    await prisma.electionScope.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
    await prisma.user.deleteMany();

    // 2. Usuário Admin
    adminUser = await prisma.user.create({
      data: {
        name: 'Admin PR7',
        email: 'admin-pr7@test.com',
        passwordHash: 'hash-pr7',
        role: 'ADMIN',
        sessionVersion: 1
      }
    });

    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
      authenticated: true,
      user: {
        userId: adminUser.id,
        name: adminUser.name,
        role: 'ADMIN',
        sessionVersion: 1
      }
    } as any);

    // 3. Estrutura Territorial
    stateSC = await prisma.state.create({
      data: { abbreviation: 'SC', name: 'Santa Catarina' }
    });

    muniConcordia = await prisma.municipality.create({
      data: { officialCode: '80837', name: 'Concórdia', stateId: stateSC.id, isCoverage: true }
    });

    zone9 = await prisma.pollingZone.create({
      data: { zoneNumber: '9', municipalityId: muniConcordia.id, expectedBUs: 10 }
    });

    zone10 = await prisma.pollingZone.create({
      data: { zoneNumber: '10', municipalityId: muniConcordia.id, expectedBUs: 10 }
    });

    sec42 = await prisma.pollingSection.create({
      data: { sectionNumber: '42', pollingZoneId: zone9.id, locationName: 'Escola Deodoro', expectedBUs: 1 }
    });

    sec43 = await prisma.pollingSection.create({
      data: { sectionNumber: '43', pollingZoneId: zone9.id, locationName: 'Colégio Estadual', expectedBUs: 1 }
    });

    sec50 = await prisma.pollingSection.create({
      data: { sectionNumber: '50', pollingZoneId: zone10.id, locationName: 'Ginásio Municipal', expectedBUs: 1 }
    });

    // 4. Eleições e Turnos
    electionA = await prisma.election.create({
      data: {
        name: 'Eleições Gerais 2026',
        slug: 'gerais-2026',
        year: 2026,
        status: 'ACTIVE'
      }
    });

    roundA1 = await prisma.electionRound.create({
      data: {
        electionId: electionA.id,
        roundNumber: 1,
        status: 'ACTIVE'
      }
    });

    // Cobertura da Seção 42 no Turno 1
    await prisma.roundCoverage.create({
      data: {
        electionRoundId: roundA1.id,
        pollingSectionId: sec42.id,
        expectedBUs: 1
      }
    });

    roundA2 = await prisma.electionRound.create({
      data: {
        electionId: electionA.id,
        roundNumber: 2,
        status: 'PLANNED'
      }
    });

    electionB = await prisma.election.create({
      data: {
        name: 'Eleição Suplementar 2026',
        slug: 'suplementar-2026',
        year: 2026,
        status: 'PLANNED'
      }
    });

    roundB1 = await prisma.electionRound.create({
      data: {
        electionId: electionB.id,
        roundNumber: 1,
        status: 'ACTIVE'
      }
    });

    // 5. Partidos e Cargos
    partyPL = await prisma.party.create({
      data: { officialIdentifier: '22', name: 'Partido Liberal', abbreviation: 'PL' }
    });

    partyPT = await prisma.party.create({
      data: { officialIdentifier: '13', name: 'Partido dos Trabalhadores', abbreviation: 'PT' }
    });

    officePres = await prisma.office.create({
      data: {
        electionId: electionA.id,
        code: '1',
        name: 'Presidente',
        type: 'MAJORITARIO',
        orderNumber: 1
      }
    });

    cand22 = await prisma.candidate.create({
      data: {
        officeId: officePres.id,
        partyId: partyPL.id,
        candidateNumber: '22',
        name: 'Candidato Alfa da Silva',
        ballotName: 'Candidato Alfa'
      }
    });

    cand13 = await prisma.candidate.create({
      data: {
        officeId: officePres.id,
        partyId: partyPT.id,
        candidateNumber: '13',
        name: 'Candidato Beta dos Santos',
        ballotName: 'Candidato Beta'
      }
    });

    // 6. Criar conjunto de Boletins para os testes de paginação
    // 3 boletins confirmados (com confirmedAt explícito)
    for (let i = 1; i <= 3; i++) {
      const confirmedTime = new Date(`2026-10-30T17:0${i}:00.000Z`);
      const createdTime = new Date(`2026-10-30T16:5${i}:00.000Z`);
      const rep = await prisma.ballotReport.create({
        data: {
          deterministicId: `det-conf-${i}`,
          electionId: electionA.id,
          roundId: roundA1.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '9',
          sectionCode: i === 3 ? '43' : '42',
          urnCode: `100${i}`,
          status: 'PROCESSADO',
          confirmedAt: confirmedTime,
          createdAt: createdTime,
          hashStatus: 'VERIFIED',
          sigStatus: 'VERIFIED',
          metadata: JSON.stringify({ aptos: 300, comparecimento: 250, faltas: 50 })
        }
      });
      confirmedReportIds.push(rep.id);

      // Adiciona votos
      await prisma.ballotVote.create({
        data: {
          reportId: rep.id,
          officeId: officePres.id,
          candidateId: cand22.id,
          candidateNumber: '22',
          quantity: 150,
          voteType: 'NOMINAL'
        }
      });
      await prisma.ballotVote.create({
        data: {
          reportId: rep.id,
          officeId: officePres.id,
          candidateId: cand13.id,
          candidateNumber: '13',
          quantity: 90,
          voteType: 'NOMINAL'
        }
      });
      await prisma.ballotVote.create({
        data: {
          reportId: rep.id,
          officeId: officePres.id,
          quantity: 10,
          voteType: 'BRANCO'
        }
      });
    }

    // 3 boletins históricos (com confirmedAt = null)
    for (let j = 1; j <= 3; j++) {
      const createdTime = new Date(`2026-10-30T15:0${j}:00.000Z`);
      const rep = await prisma.ballotReport.create({
        data: {
          deterministicId: `det-hist-${j}`,
          electionId: electionA.id,
          roundId: roundA1.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '10',
          sectionCode: '50',
          urnCode: `200${j}`,
          status: 'PROCESSADO',
          confirmedAt: null,
          createdAt: createdTime,
          hashStatus: 'UNCHECKED',
          sigStatus: 'UNCHECKED'
        }
      });
      historicalReportIds.push(rep.id);
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.office.deleteMany();
    await prisma.party.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
    await prisma.user.deleteMany();
  });

  // PAG-01: Primeira página (sem cursor)
  it('PAG-01: Primeira página retorna os registros mais recentes ordenados limitados por limit', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&limit=2');
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.items).toHaveLength(2);
    // Mais recente confirmado é o rep 3 (17:03), seguido do rep 2 (17:02)
    expect(json.items[0].id).toBe(confirmedReportIds[2]);
    expect(json.items[1].id).toBe(confirmedReportIds[1]);
    expect(json.pagination.hasMore).toBe(true);
    expect(json.pagination.nextCursor).toBeTruthy();
  });

  // PAG-02: Paginação contínua de registros confirmados
  it('PAG-02: Paginação contínua avança para o próximo registro confirmado via cursor', async () => {
    const req1 = new Request('http://localhost:3000/api/urnas?round=1&limit=2');
    const res1 = await urnasFeedRoute(req1);
    const json1 = await res1.json();
    const cursor = json1.pagination.nextCursor;

    const req2 = new Request(`http://localhost:3000/api/urnas?round=1&limit=2&cursor=${cursor}`);
    const res2 = await urnasFeedRoute(req2);
    expect(res2.status).toBe(200);

    const json2 = await res2.json();
    expect(json2.items).toHaveLength(2);
    // Próximo item confirmado deve ser rep 1 (17:01)
    expect(json2.items[0].id).toBe(confirmedReportIds[0]);
    expect(json2.items[0].timing.timestampType).toBe('CONFIRMED');
  });

  // PAG-03: Transição de confirmados para históricos
  it('PAG-03: Registros confirmados aparecem estritamente antes dos históricos (confirmedAt = null)', async () => {
    // Consulta todos os 6 registros com limit=6
    const req = new Request('http://localhost:3000/api/urnas?round=1&limit=10');
    const res = await urnasFeedRoute(req);
    const json = await res.json();

    expect(json.items).toHaveLength(6);
    // Primeiros 3 devem ser CONFIRMED
    expect(json.items[0].timing.timestampType).toBe('CONFIRMED');
    expect(json.items[1].timing.timestampType).toBe('CONFIRMED');
    expect(json.items[2].timing.timestampType).toBe('CONFIRMED');
    // Últimos 3 devem ser RECEIVED_FALLBACK
    expect(json.items[3].timing.timestampType).toBe('RECEIVED_FALLBACK');
    expect(json.items[4].timing.timestampType).toBe('RECEIVED_FALLBACK');
    expect(json.items[5].timing.timestampType).toBe('RECEIVED_FALLBACK');
  });

  // PAG-04: Paginação dentro do bloco histórico
  it('PAG-04: Continuação de paginação dentro do bloco histórico respeita createdAt DESC, id DESC', async () => {
    // Busca até entrar no bloco histórico
    const req1 = new Request('http://localhost:3000/api/urnas?round=1&limit=4');
    const res1 = await urnasFeedRoute(req1);
    const json1 = await res1.json();
    const cursor = json1.pagination.nextCursor;

    const req2 = new Request(`http://localhost:3000/api/urnas?round=1&limit=2&cursor=${cursor}`);
    const res2 = await urnasFeedRoute(req2);
    const json2 = await res2.json();

    expect(json2.items).toHaveLength(2);
    expect(json2.items[0].id).toBe(historicalReportIds[1]); // hist 2
    expect(json2.items[1].id).toBe(historicalReportIds[0]); // hist 1
  });

  // PAG-05: Fim da lista
  it('PAG-05: Ao atingir o final dos registros, hasMore é false e nextCursor é null', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&limit=10');
    const res = await urnasFeedRoute(req);
    const json = await res.json();

    expect(json.items).toHaveLength(6);
    expect(json.pagination.hasMore).toBe(false);
    expect(json.pagination.nextCursor).toBeNull();
  });

  // PAG-06: Desempate determinístico por ID
  it('PAG-06: Desempata registros com mesmo timestamp pelo ID de forma determinística', async () => {
    const sameTime = new Date('2026-10-30T18:00:00.000Z');
    const rA = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-tie-a',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '9991',
        status: 'PROCESSADO',
        confirmedAt: sameTime,
        createdAt: sameTime
      }
    });
    const rB = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-tie-b',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '9992',
        status: 'PROCESSADO',
        confirmedAt: sameTime,
        createdAt: sameTime
      }
    });

    const req = new Request('http://localhost:3000/api/urnas?round=1&limit=2');
    const res = await urnasFeedRoute(req);
    const json = await res.json();

    // Como ambos têm confirmedAt 18:00 (mais recente que todos os outros), os dois estão no topo
    expect([json.items[0].id, json.items[1].id]).toContain(rA.id);
    expect([json.items[0].id, json.items[1].id]).toContain(rB.id);

    // O de maior ID lexicográfico vem antes (id DESC)
    const expectedFirst = rA.id > rB.id ? rA.id : rB.id;
    const expectedSecond = rA.id > rB.id ? rB.id : rA.id;
    expect(json.items[0].id).toBe(expectedFirst);
    expect(json.items[1].id).toBe(expectedSecond);

    // Limpeza dos dois relatórios de teste
    await prisma.ballotReport.deleteMany({ where: { id: { in: [rA.id, rB.id] } } });
  });

  // PAG-07: Inserção concorrente não desloca a paginação por offset drift
  it('PAG-07: Inserção concorrente no topo não causa deslocamento de offset nem repetição de itens', async () => {
    const req1 = new Request('http://localhost:3000/api/urnas?round=1&limit=2');
    const res1 = await urnasFeedRoute(req1);
    const json1 = await res1.json();
    const cursor = json1.pagination.nextCursor;

    // Simula inserção concorrente de um novo BU ainda mais recente no topo do feed
    const concurrentRep = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-concurrent-new',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '9998',
        status: 'PROCESSADO',
        confirmedAt: new Date('2026-10-30T19:00:00.000Z'),
        createdAt: new Date('2026-10-30T19:00:00.000Z')
      }
    });

    // Busca página 2 com o cursor gerado ANTES da inserção concorrente
    const req2 = new Request(`http://localhost:3000/api/urnas?round=1&limit=2&cursor=${cursor}`);
    const res2 = await urnasFeedRoute(req2);
    const json2 = await res2.json();

    // A página 2 continua exatamente pelos valores escalares (não repete itens nem sofre deslocamento de offset)
    expect(json2.items[0].id).toBe(confirmedReportIds[0]);
    expect(json2.items.map((i: any) => i.id)).not.toContain(concurrentRep.id);

    await prisma.ballotReport.delete({ where: { id: concurrentRep.id } });
  });

  // PAG-08: Remoção concorrente do registro apontado pelo cursor
  it('PAG-08: Remoção concorrente do registro do cursor não quebra a continuação keyset por valores escalares', async () => {
    const tempRep = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-temp-delete',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '9997',
        status: 'PROCESSADO',
        confirmedAt: new Date('2026-10-30T17:01:30.000Z'),
        createdAt: new Date('2026-10-30T16:51:30.000Z')
      }
    });

    // Gera cursor a partir dos escalares do tempRep
    const cursor = encodeUrnaCursor(
      tempRep.confirmedAt,
      tempRep.createdAt,
      tempRep.id,
      {
        electionId: electionA.id,
        roundId: roundA1.id,
        zoneFilter: null,
        sectionFilter: null
      }
    );

    // Deleta o registro do banco antes da consulta da página seguinte
    await prisma.ballotReport.delete({ where: { id: tempRep.id } });

    // Consulta com o cursor que continha os escalares do registro deletado
    const req = new Request(`http://localhost:3000/api/urnas?round=1&limit=2&cursor=${cursor}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    // A continuação se baseia em valores escalares (confirmedAt, createdAt, id) e não falha com erro 500.
    // O registro removido naturalmente não aparece nos resultados.
    expect(json.items[0].id).toBe(confirmedReportIds[0]); // rep 1 (17:01:00)
    expect(json.items.map((i: any) => i.id)).not.toContain(tempRep.id);
  });

  // PAG-09: Isolamento de eleições
  it('PAG-09: Isolamento de eleições - dados de outra eleição não aparecem no feed', async () => {
    // Cria BU na eleição B
    const repB = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-elec-b',
        electionId: electionB.id,
        roundId: roundB1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '8881',
        status: 'PROCESSADO',
        confirmedAt: new Date('2026-10-30T20:00:00.000Z')
      }
    });

    const req = new Request(`http://localhost:3000/api/urnas?election=${electionA.id}&round=1&limit=20`);
    const res = await urnasFeedRoute(req);
    const json = await res.json();

    expect(json.items.map((i: any) => i.id)).not.toContain(repB.id);

    await prisma.ballotReport.delete({ where: { id: repB.id } });
  });

  // PAG-10: Isolamento de turnos
  it('PAG-10: Isolamento de turnos - registros do turno 2 não aparecem na consulta do turno 1', async () => {
    const repRound2 = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-round-2',
        electionId: electionA.id,
        roundId: roundA2.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '7771',
        status: 'PROCESSADO',
        confirmedAt: new Date('2026-10-30T21:00:00.000Z')
      }
    });

    const reqRound1 = new Request('http://localhost:3000/api/urnas?round=1&limit=20');
    const resRound1 = await urnasFeedRoute(reqRound1);
    const jsonRound1 = await resRound1.json();
    expect(jsonRound1.items.map((i: any) => i.id)).not.toContain(repRound2.id);

    const reqRound2 = new Request('http://localhost:3000/api/urnas?round=2&limit=20');
    const resRound2 = await urnasFeedRoute(reqRound2);
    const jsonRound2 = await resRound2.json();
    expect(jsonRound2.items.map((i: any) => i.id)).toContain(repRound2.id);

    await prisma.ballotReport.delete({ where: { id: repRound2.id } });
  });

  // PAG-11: Filtro por Zona Eleitoral
  it('PAG-11: Filtro por Zona retorna apenas urnas da zona especificada', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&zone=10&limit=20');
    const res = await urnasFeedRoute(req);
    const json = await res.json();

    expect(json.items.length).toBeGreaterThan(0);
    json.items.forEach((item: any) => {
      expect(item.territory.zoneCode).toBe('10');
    });
  });

  // PAG-12: Filtro por Seção Eleitoral
  it('PAG-12: Filtro por Seção retorna apenas urnas da seção especificada', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&section=43&limit=20');
    const res = await urnasFeedRoute(req);
    const json = await res.json();

    expect(json.items).toHaveLength(1);
    expect(json.items[0].territory.sectionCode).toBe('43');
  });

  // PAG-13: Filtro combinado de Zona e Seção
  it('PAG-13: Filtro combinado de Zona e Seção retorna urna específica', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&zone=9&section=42&limit=20');
    const res = await urnasFeedRoute(req);
    const json = await res.json();

    expect(json.items.length).toBeGreaterThanOrEqual(1);
    json.items.forEach((item: any) => {
      expect(item.territory.zoneCode).toBe('9');
      expect(item.territory.sectionCode).toBe('42');
    });
  });

  // PAG-14: Rejeição de cursor adulterado / malformado
  it('PAG-14: Rejeição de cursor malformado ou corrompido com HTTP 400', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&cursor=bad-token!');
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('CURSOR_MALFORMADO');
  });

  // PAG-15: Rejeição de cursor com data ISO inválida
  it('PAG-15: Rejeição de cursor com timestamp malformado com HTTP 400', async () => {
    const badDateCursor = Buffer.from(JSON.stringify({
      e: electionA.id,
      r: roundA1.id,
      z: null,
      s: null,
      c: 'invalid-date',
      t: '2026-10-30T15:00:00.000Z',
      i: confirmedReportIds[0]
    })).toString('base64url');

    const req = new Request(`http://localhost:3000/api/urnas?round=1&cursor=${badDateCursor}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-16: Rejeição de cursor com electionId divergente (Context Binding)
  it('PAG-16: Rejeição de cursor com eleição divergente com HTTP 400', async () => {
    const cursorOtherElec = encodeUrnaCursor(null, new Date(), confirmedReportIds[0], {
      electionId: electionB.id,
      roundId: roundA1.id,
      zoneFilter: null,
      sectionFilter: null
    });

    const req = new Request(`http://localhost:3000/api/urnas?election=${electionA.id}&round=1&cursor=${cursorOtherElec}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-17: Rejeição de cursor com roundId divergente (Context Binding)
  it('PAG-17: Rejeição de cursor com round divergente com HTTP 400', async () => {
    const cursorRound2 = encodeUrnaCursor(null, new Date(), confirmedReportIds[0], {
      electionId: electionA.id,
      roundId: roundA2.id,
      zoneFilter: null,
      sectionFilter: null
    });

    const req = new Request(`http://localhost:3000/api/urnas?round=1&cursor=${cursorRound2}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-18: Rejeição de cursor com zone/section divergente dos filtros
  it('PAG-18: Rejeição de cursor quando filtros de zona/seção divergem com HTTP 400', async () => {
    const cursorZone9 = encodeUrnaCursor(null, new Date(), confirmedReportIds[0], {
      electionId: electionA.id,
      roundId: roundA1.id,
      zoneFilter: '9',
      sectionFilter: null
    });

    // Consulta com zone=10 mas cursor foi emitido para zone=9
    const req = new Request(`http://localhost:3000/api/urnas?round=1&zone=10&cursor=${cursorZone9}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-19: Isolamento de simulação
  it('PAG-19: Relatórios de simulação (isSimulation: true) NUNCA aparecem no feed ou detalhe', async () => {
    const simRep = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-simulation-secret',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '0000',
        status: 'PROCESSADO',
        isSimulation: true,
        confirmedAt: new Date('2026-10-30T22:00:00.000Z')
      }
    });

    const reqFeed = new Request('http://localhost:3000/api/urnas?round=1&limit=50');
    const resFeed = await urnasFeedRoute(reqFeed);
    const jsonFeed = await resFeed.json();
    expect(jsonFeed.items.map((i: any) => i.id)).not.toContain(simRep.id);

    const reqDetail = new Request(`http://localhost:3000/api/urnas/${simRep.id}`);
    const resDetail = await urnaDetailRoute(reqDetail, { params: Promise.resolve({ id: simRep.id }) });
    expect(resDetail.status).toBe(404);

    await prisma.ballotReport.delete({ where: { id: simRep.id } });
  });

  // PAG-20: Isolamento de status
  it('PAG-20: Relatórios com status diferente de PROCESSADO não aparecem no feed ou detalhe', async () => {
    const pendingRep = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-pending-rep',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '5555',
        status: 'PENDENTE_CONFIRMACAO'
      }
    });

    const reqFeed = new Request('http://localhost:3000/api/urnas?round=1&limit=50');
    const resFeed = await urnasFeedRoute(reqFeed);
    const jsonFeed = await resFeed.json();
    expect(jsonFeed.items.map((i: any) => i.id)).not.toContain(pendingRep.id);

    const reqDetail = new Request(`http://localhost:3000/api/urnas/${pendingRep.id}`);
    const resDetail = await urnaDetailRoute(reqDetail, { params: Promise.resolve({ id: pendingRep.id }) });
    expect(resDetail.status).toBe(404);

    await prisma.ballotReport.delete({ where: { id: pendingRep.id } });
  });

  // PAG-21: Endpoint de detalhe /api/urnas/[id]
  it('PAG-21: Endpoint de detalhe retorna DTO completo com candidatos, comparecimento e roteiro de rádio', async () => {
    const repId = confirmedReportIds[0];
    const req = new Request(`http://localhost:3000/api/urnas/${repId}`);
    const res = await urnaDetailRoute(req, { params: Promise.resolve({ id: repId }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.id).toBe(repId);
    expect(json.context.election.name).toBe('Eleições Gerais 2026');
    expect(json.territory.cityName).toBe('Concórdia');
    expect(json.territory.zoneCode).toBe('9');
    expect(json.attendance?.apto).toBe(300);
    expect(json.attendance?.comp).toBe(250);
    expect(json.offices).toHaveLength(1);
    expect(json.offices[0].officeName).toBe('Presidente');
    expect(json.offices[0].candidates).toHaveLength(2);
    expect(json.radioScript).toContain('BOLETIM DE URNA APURADO — APURAÇÃO PARALELA');
  });

  // PAG-22: Confirmação de relatório grava confirmedAt: new Date()
  it('PAG-22: POST /api/reports/[id]/confirm grava confirmedAt com timestamp atual na confirmação', async () => {
    const repToConfirm = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-to-confirm',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '3333',
        status: 'PENDENTE_CONFIRMACAO',
        confirmedAt: null
      }
    });

    const beforeConfirm = new Date(Date.now() - 1000);

    const req = new Request(`http://localhost:3000/api/reports/${repToConfirm.id}/confirm`, {
      method: 'POST'
    });
    const res = await confirmReportRoute(req, { params: Promise.resolve({ id: repToConfirm.id }) });
    if (res.status !== 200) {
      const err = await res.clone().json();
      throw new Error(`PAG-22 FAILED WITH STATUS ${res.status}: ${JSON.stringify(err)}`);
    }
    expect(res.status).toBe(200);

    const updated = await prisma.ballotReport.findUnique({ where: { id: repToConfirm.id } });
    expect(updated?.status).toBe('PROCESSADO');
    expect(updated?.confirmedAt).not.toBeNull();
    expect(updated!.confirmedAt!.getTime()).toBeGreaterThanOrEqual(beforeConfirm.getTime());

    await prisma.ballotReport.delete({ where: { id: repToConfirm.id } });
  });

  // PAG-23: Validador territorial - parâmetro vazio rejeitado
  it('PAG-23: Parâmetro ?zone= vazio é rejeitado com HTTP 400', async () => {
    const req = new Request('http://localhost:3000/api/urnas?zone=');
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('PARAMETRO_INVALIDO');
  });

  // PAG-24: Validador territorial - parâmetro com apenas espaços rejeitado
  it('PAG-24: Parâmetro ?zone=%20%20 com espaços é rejeitado sem tolerância de trim()', async () => {
    const req = new Request('http://localhost:3000/api/urnas?zone=%20%20');
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-25: Validador territorial - normalização canônica 0009 -> 9
  it('PAG-25: Parâmetro ?zone=0009 é aceito e normalizado canonicamente para 9', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&zone=0009');
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.filters.zone).toBe('9');
  });

  // PAG-26: Validador territorial - rejeição de caracteres não numéricos
  it('PAG-26: Parâmetro com formato não numérico (?zone=abc ou ?zone=12a) é rejeitado com HTTP 400', async () => {
    const req1 = new Request('http://localhost:3000/api/urnas?zone=abc');
    const res1 = await urnasFeedRoute(req1);
    expect(res1.status).toBe(400);

    const req2 = new Request('http://localhost:3000/api/urnas?zone=12a');
    const res2 = await urnasFeedRoute(req2);
    expect(res2.status).toBe(400);
  });

  // PAG-27: Validador territorial - zero absoluto rejeitado
  it('PAG-27: Parâmetro ?zone=0 é rejeitado com HTTP 400', async () => {
    const req = new Request('http://localhost:3000/api/urnas?zone=0');
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-28: Cursor com zone ou section não canônica rejeitado
  it('PAG-28: Cursor com zone não canônica (ex: "09" com zero à esquerda) é rejeitado', async () => {
    const badCursor = Buffer.from(JSON.stringify({
      e: electionA.id,
      r: roundA1.id,
      z: '09', // Inválido: tem zero à esquerda
      s: null,
      c: null,
      t: '2026-10-30T15:00:00.000Z',
      i: confirmedReportIds[0]
    })).toString('base64url');

    const req = new Request(`http://localhost:3000/api/urnas?round=1&cursor=${badCursor}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-29: Cursor com tamanho excedendo 512 bytes rejeitado
  it('PAG-29: Cursor com tamanho superior a 512 bytes é sumariamente rejeitado com HTTP 400', async () => {
    const longString = 'A'.repeat(600);
    const req = new Request(`http://localhost:3000/api/urnas?round=1&cursor=${longString}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-30: Cursor com chaves desconhecidas injetadas rejeitado
  it('PAG-30: Cursor com chaves extras injetadas é sumariamente rejeitado (Object Sealing)', async () => {
    const injectedCursor = Buffer.from(JSON.stringify({
      e: electionA.id,
      r: roundA1.id,
      z: null,
      s: null,
      c: null,
      t: '2026-10-30T15:00:00.000Z',
      i: confirmedReportIds[0],
      maliciousField: 'payload'
    })).toString('base64url');

    const req = new Request(`http://localhost:3000/api/urnas?round=1&cursor=${injectedCursor}`);
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
  });

  // PAG-31: Validação de parâmetro round com sufixo ou caracteres inválidos
  it('PAG-31: Parâmetro ?round=1abc é rejeitado com HTTP 400 (TURNO_INVALIDO)', async () => {
    const req1 = new Request('http://localhost:3000/api/urnas?round=1abc');
    const res1 = await urnasFeedRoute(req1);
    expect(res1.status).toBe(400);
    const json1 = await res1.json();
    expect(json1.error).toBe('TURNO_INVALIDO');

    const req2 = new Request('http://localhost:3000/api/urnas?round=2x');
    const res2 = await urnasFeedRoute(req2);
    expect(res2.status).toBe(400);
    const json2 = await res2.json();
    expect(json2.error).toBe('TURNO_INVALIDO');
  });

  // PAG-32: Validação de parâmetro limit com sufixo ou caracteres inválidos
  it('PAG-32: Parâmetro ?limit=20x é rejeitado com HTTP 400 (PARAMETRO_INVALIDO)', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1&limit=20x');
    const res = await urnasFeedRoute(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('PARAMETRO_INVALIDO');
  });

  // PAG-33: Validação de parâmetro limit igual a zero ou negativo
  it('PAG-33: Parâmetro ?limit=0 é rejeitado com HTTP 400 (PARAMETRO_INVALIDO)', async () => {
    const req1 = new Request('http://localhost:3000/api/urnas?round=1&limit=0');
    const res1 = await urnasFeedRoute(req1);
    expect(res1.status).toBe(400);
    const json1 = await res1.json();
    expect(json1.error).toBe('PARAMETRO_INVALIDO');

    const req2 = new Request('http://localhost:3000/api/urnas?round=1&limit=-5');
    const res2 = await urnasFeedRoute(req2);
    expect(res2.status).toBe(400);
    const json2 = await res2.json();
    expect(json2.error).toBe('PARAMETRO_INVALIDO');
  });

  // PAG-34: Compatibilidade territorial - variantes de zeros à esquerda (9, 09, 009, 0009 / 42, 042, 0042)
  it('PAG-34: Compatibilidade territorial - busca por zona/seção localiza variantes com e sem zeros à esquerda', async () => {
    const repVariants = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-variant-test',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '09',       // gravado com 2 dígitos
        sectionCode: '0042',  // gravado com 4 dígitos
        urnCode: '7777',
        status: 'PROCESSADO',
        confirmedAt: new Date('2026-10-30T21:00:00.000Z'),
        createdAt: new Date('2026-10-30T21:00:00.000Z')
      }
    });

    // 1. Busca usando códigos canônicos sem zeros (?zone=9&section=42)
    const req1 = new Request('http://localhost:3000/api/urnas?round=1&zone=9&section=42');
    const res1 = await urnasFeedRoute(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.items.map((i: any) => i.id)).toContain(repVariants.id);

    // 2. Busca usando códigos formatados com 4 dígitos (?zone=0009&section=0042)
    const req2 = new Request('http://localhost:3000/api/urnas?round=1&zone=0009&section=0042');
    const res2 = await urnasFeedRoute(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.items.map((i: any) => i.id)).toContain(repVariants.id);

    await prisma.ballotReport.delete({ where: { id: repVariants.id } });
  });

  // PAG-35: Compatibilidade territorial no endpoint de detalhe /api/urnas/[id]
  it('PAG-35: Compatibilidade territorial no detalhe - resolve município e local com variantes de padding', async () => {
    const repDetailVariant = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-detail-variant',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '009',      // 3 dígitos
        sectionCode: '042',   // 3 dígitos
        urnCode: '7778',
        status: 'PROCESSADO',
        confirmedAt: new Date('2026-10-30T21:05:00.000Z'),
        createdAt: new Date('2026-10-30T21:05:00.000Z')
      }
    });

    const req = new Request(`http://localhost:3000/api/urnas/${repDetailVariant.id}`);
    const res = await urnaDetailRoute(req, { params: Promise.resolve({ id: repDetailVariant.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.territory.cityName).toBe('Concórdia');
    expect(json.territory.locationName).toBe('Escola Deodoro');

    await prisma.ballotReport.delete({ where: { id: repDetailVariant.id } });
  });

  // PAG-36: Consulta pública de eleição e turno concluídos/históricos (status = 'FINISHED')
  it('PAG-36: Permite consultar BUs de eleição e turno concluídos (FINISHED) quando explicitamente solicitados, mantendo isolamento', async () => {
    // 1. Cria uma eleição finalizada com turno finalizado
    const electionHist = await prisma.election.create({
      data: {
        name: 'Eleição Histórica 2024',
        year: 2024,
        type: 'MUNICIPAL',
        status: 'FINISHED',
        slug: 'eleicao-historica-2024',
        rounds: {
          create: { roundNumber: 1, status: 'FINISHED', coverageStatus: 'HOMOLOGATED' }
        }
      },
      include: { rounds: true }
    });
    const roundHist = electionHist.rounds[0];

    // 2. Cria um BU homologado (PROCESSADO) nessa eleição histórica
    const repHist = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-hist-concluded',
        electionId: electionHist.id,
        roundId: roundHist.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '6661',
        status: 'PROCESSADO',
        isSimulation: false,
        confirmedAt: new Date('2024-10-06T18:00:00.000Z'),
        createdAt: new Date('2024-10-06T18:00:00.000Z')
      }
    });

    // 3. Consulta padrão (sem ?election) retorna apenas a eleição ativa (não vaza o histórico)
    const reqDefault = new Request('http://localhost:3000/api/urnas?round=1');
    const resDefault = await urnasFeedRoute(reqDefault);
    expect(resDefault.status).toBe(200);
    const jsonDefault = await resDefault.json();
    expect(jsonDefault.items.map((i: any) => i.id)).not.toContain(repHist.id);

    // 4. Consulta explícita por slug (?election=eleicao-historica-2024&round=1) retorna o BU histórico
    const reqExplicit = new Request(`http://localhost:3000/api/urnas?election=eleicao-historica-2024&round=1`);
    const resExplicit = await urnasFeedRoute(reqExplicit);
    expect(resExplicit.status).toBe(200);
    const jsonExplicit = await resExplicit.json();
    expect(jsonExplicit.context.election.name).toBe('Eleição Histórica 2024');
    expect(jsonExplicit.items.map((i: any) => i.id)).toContain(repHist.id);

    // 5. Consulta de detalhe /api/urnas/[id] do BU histórico é pública e acessível
    const reqDetail = new Request(`http://localhost:3000/api/urnas/${repHist.id}`);
    const resDetail = await urnaDetailRoute(reqDetail, { params: Promise.resolve({ id: repHist.id }) });
    expect(resDetail.status).toBe(200);
    const jsonDetail = await resDetail.json();
    expect(jsonDetail.id).toBe(repHist.id);
    expect(jsonDetail.context.election.name).toBe('Eleição Histórica 2024');

    // 6. Context binding: cursor gerado para a eleição histórica não pode ser reutilizado na eleição ativa
    const cursorHist = encodeUrnaCursor(
      repHist.confirmedAt,
      repHist.createdAt,
      repHist.id,
      {
        electionId: electionHist.id,
        roundId: roundHist.id,
        zoneFilter: null,
        sectionFilter: null
      }
    );

    const reqMismatch = new Request(`http://localhost:3000/api/urnas?round=1&cursor=${cursorHist}`);
    const resMismatch = await urnasFeedRoute(reqMismatch);
    expect(resMismatch.status).toBe(400);
    const jsonMismatch = await resMismatch.json();
    expect(jsonMismatch.error).toBe('CURSOR_CONTEXT_MISMATCH');

    // Limpeza
    await prisma.ballotReport.delete({ where: { id: repHist.id } });
    await prisma.electionRound.delete({ where: { id: roundHist.id } });
    await prisma.election.delete({ where: { id: electionHist.id } });
  });

  // PAG-37: Eleição histórica com um único turno FINISHED e sem ?round informado
  it('PAG-37: Seleciona automaticamente o único turno FINISHED quando ?election é informado sem ?round, preservando paginação, segurança e isolamento padrão', async () => {
    const electionHist1T = await prisma.election.create({
      data: {
        name: 'Eleição Municipal Histórica 2020',
        year: 2020,
        type: 'MUNICIPAL',
        status: 'FINISHED',
        slug: 'eleicao-hist-1t-2020',
        rounds: {
          create: { roundNumber: 1, status: 'FINISHED', coverageStatus: 'HOMOLOGATED' }
        }
      },
      include: { rounds: true }
    });
    const round1T = electionHist1T.rounds[0];

    const rep1 = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-hist-1t-1',
        electionId: electionHist1T.id,
        roundId: round1T.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '8801',
        status: 'PROCESSADO',
        isSimulation: false,
        confirmedAt: new Date('2020-11-15T19:00:00.000Z'),
        createdAt: new Date('2020-11-15T19:00:00.000Z')
      }
    });

    const rep2 = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-hist-1t-2',
        electionId: electionHist1T.id,
        roundId: round1T.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '43',
        urnCode: '8802',
        status: 'PROCESSADO',
        isSimulation: false,
        confirmedAt: new Date('2020-11-15T18:00:00.000Z'),
        createdAt: new Date('2020-11-15T18:00:00.000Z')
      }
    });

    const repSim = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-hist-1t-sim',
        electionId: electionHist1T.id,
        roundId: round1T.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '8803',
        status: 'PROCESSADO',
        isSimulation: true,
        confirmedAt: new Date('2020-11-15T20:00:00.000Z'),
        createdAt: new Date('2020-11-15T20:00:00.000Z')
      }
    });

    try {
      // 1. Consulta explícita da eleição histórica sem ?round: seleciona automaticamente o único turno FINISHED
      const reqPage1 = new Request('http://localhost:3000/api/urnas?election=eleicao-hist-1t-2020&limit=1');
      const resPage1 = await urnasFeedRoute(reqPage1);
      expect(resPage1.status).toBe(200);
      const jsonPage1 = await resPage1.json();

      expect(jsonPage1.context.election.slug).toBe('eleicao-hist-1t-2020');
      expect(jsonPage1.context.round.id).toBe(round1T.id);
      expect(jsonPage1.context.round.roundNumber).toBe(1);
      expect(jsonPage1.context.round.status).toBe('FINISHED');
      expect(jsonPage1.items).toHaveLength(1);
      expect(jsonPage1.items[0].id).toBe(rep1.id);
      expect(jsonPage1.pagination.hasMore).toBe(true);
      expect(jsonPage1.pagination.nextCursor).toBeTruthy();

      // Garante que simulação não apareceu
      expect(jsonPage1.items.map((i: any) => i.id)).not.toContain(repSim.id);

      // 2. Paginação com cursor sem ?round continua funcionando na página seguinte
      const reqPage2 = new Request(`http://localhost:3000/api/urnas?election=eleicao-hist-1t-2020&limit=1&cursor=${jsonPage1.pagination.nextCursor}`);
      const resPage2 = await urnasFeedRoute(reqPage2);
      expect(resPage2.status).toBe(200);
      const jsonPage2 = await resPage2.json();
      expect(jsonPage2.items).toHaveLength(1);
      expect(jsonPage2.items[0].id).toBe(rep2.id);
      expect(jsonPage2.pagination.hasMore).toBe(false);

      // 3. Consulta padrão (sem ?election e sem ?round) mantém comportamento anterior na eleição ativa e NÃO vaza histórico
      const reqDefault = new Request('http://localhost:3000/api/urnas');
      const resDefault = await urnasFeedRoute(reqDefault);
      expect(resDefault.status).toBe(200);
      const jsonDefault = await resDefault.json();
      expect(jsonDefault.context.election.id).toBe(electionA.id);
      expect(jsonDefault.context.round.id).toBe(roundA1.id);
      const defaultIds = jsonDefault.items.map((i: any) => i.id);
      expect(defaultIds).not.toContain(rep1.id);
      expect(defaultIds).not.toContain(rep2.id);

      // 4. Cursor emitido para a eleição histórica não pode ser reutilizado na eleição ativa padrão
      const reqMismatch = new Request(`http://localhost:3000/api/urnas?cursor=${jsonPage1.pagination.nextCursor}`);
      const resMismatch = await urnasFeedRoute(reqMismatch);
      expect(resMismatch.status).toBe(400);
      const jsonMismatch = await resMismatch.json();
      expect(jsonMismatch.error).toBe('CURSOR_CONTEXT_MISMATCH');
    } finally {
      await prisma.ballotReport.deleteMany({ where: { electionId: electionHist1T.id } });
      await prisma.electionRound.deleteMany({ where: { electionId: electionHist1T.id } });
      await prisma.election.delete({ where: { id: electionHist1T.id } });
    }
  });

  // PAG-38: Eleição histórica com múltiplos turnos FINISHED sem ?round exige seleção explícita
  it('PAG-38: Exige especificação explícita de ?round quando eleição histórica possui múltiplos turnos FINISHED e preserva isolamento por turno', async () => {
    const electionHist2T = await prisma.election.create({
      data: {
        name: 'Eleições Gerais Históricas 2022',
        year: 2022,
        type: 'GENERAL',
        status: 'FINISHED',
        slug: 'eleicoes-hist-2t-2022',
        rounds: {
          create: [
            { roundNumber: 1, status: 'FINISHED', coverageStatus: 'HOMOLOGATED' },
            { roundNumber: 2, status: 'FINISHED', coverageStatus: 'HOMOLOGATED' }
          ]
        }
      },
      include: { rounds: { orderBy: { roundNumber: 'asc' } } }
    });
    const round1Hist = electionHist2T.rounds[0];
    const round2Hist = electionHist2T.rounds[1];

    const repR1 = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-hist-2t-r1',
        electionId: electionHist2T.id,
        roundId: round1Hist.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '9901',
        status: 'PROCESSADO',
        isSimulation: false,
        confirmedAt: new Date('2022-10-02T18:00:00.000Z'),
        createdAt: new Date('2022-10-02T18:00:00.000Z')
      }
    });

    const repR2 = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-hist-2t-r2',
        electionId: electionHist2T.id,
        roundId: round2Hist.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '9902',
        status: 'PROCESSADO',
        isSimulation: false,
        confirmedAt: new Date('2022-10-30T18:00:00.000Z'),
        createdAt: new Date('2022-10-30T18:00:00.000Z')
      }
    });

    try {
      // 1. Sem informar ?round: exige especificação explícita com HTTP 400
      const reqAmbiguous = new Request('http://localhost:3000/api/urnas?election=eleicoes-hist-2t-2022');
      const resAmbiguous = await urnasFeedRoute(reqAmbiguous);
      expect(resAmbiguous.status).toBe(400);
      const jsonAmbiguous = await resAmbiguous.json();
      expect(jsonAmbiguous.error).toBe('TURNO_NAO_ESPECIFICADO');
      expect(jsonAmbiguous.availableRounds).toHaveLength(2);

      // 2. Com ?round=1: retorna apenas os BUs do 1º Turno histórico
      const reqR1 = new Request('http://localhost:3000/api/urnas?election=eleicoes-hist-2t-2022&round=1');
      const resR1 = await urnasFeedRoute(reqR1);
      expect(resR1.status).toBe(200);
      const jsonR1 = await resR1.json();
      expect(jsonR1.context.round.id).toBe(round1Hist.id);
      expect(jsonR1.items.map((i: any) => i.id)).toEqual([repR1.id]);

      // 3. Com ?round=2: retorna apenas os BUs do 2º Turno histórico
      const reqR2 = new Request('http://localhost:3000/api/urnas?election=eleicoes-hist-2t-2022&round=2');
      const resR2 = await urnasFeedRoute(reqR2);
      expect(resR2.status).toBe(200);
      const jsonR2 = await resR2.json();
      expect(jsonR2.context.round.id).toBe(round2Hist.id);
      expect(jsonR2.items.map((i: any) => i.id)).toEqual([repR2.id]);

      // 4. Cursor do 1º turno histórico não pode ser reutilizado no 2º turno histórico
      const cursorR1 = encodeUrnaCursor(
        repR1.confirmedAt,
        repR1.createdAt,
        repR1.id,
        {
          electionId: electionHist2T.id,
          roundId: round1Hist.id,
          zoneFilter: null,
          sectionFilter: null
        }
      );
      const reqRoundMismatch = new Request(`http://localhost:3000/api/urnas?election=eleicoes-hist-2t-2022&round=2&cursor=${cursorR1}`);
      const resRoundMismatch = await urnasFeedRoute(reqRoundMismatch);
      expect(resRoundMismatch.status).toBe(400);
      const jsonRoundMismatch = await resRoundMismatch.json();
      expect(jsonRoundMismatch.error).toBe('CURSOR_CONTEXT_MISMATCH');
    } finally {
      await prisma.ballotReport.deleteMany({ where: { electionId: electionHist2T.id } });
      await prisma.electionRound.deleteMany({ where: { electionId: electionHist2T.id } });
      await prisma.election.delete({ where: { id: electionHist2T.id } });
    }
  });

  // PAG-39: Resposta controlada para eleição sem turnos e compatibilidade com eleição ativa explícita sem ?round
  it('PAG-39: Mantém resposta controlada para eleição sem turnos e resolve turno ativo quando eleição ativa possui turno PLANNED adicional', async () => {
    const electionSemTurnos = await prisma.election.create({
      data: {
        name: 'Eleição Sem Turnos',
        year: 2018,
        type: 'MUNICIPAL',
        status: 'ARCHIVED',
        slug: 'eleicao-sem-turnos-2018'
      }
    });

    try {
      // 1. Eleição sem turnos retorna resposta 200 controlada com round = null
      const reqNoRound = new Request('http://localhost:3000/api/urnas?election=eleicao-sem-turnos-2018');
      const resNoRound = await urnasFeedRoute(reqNoRound);
      expect(resNoRound.status).toBe(200);
      const jsonNoRound = await resNoRound.json();
      expect(jsonNoRound.context.election.slug).toBe('eleicao-sem-turnos-2018');
      expect(jsonNoRound.context.round).toBeNull();
      expect(jsonNoRound.items).toEqual([]);
      expect(jsonNoRound.message).toBeTruthy();

      // 2. Eleição ativa explícita (?election=gerais-2026) com Round 1 ACTIVE e Round 2 PLANNED resolve o turno ACTIVE sem ?round
      const reqActiveExplicit = new Request('http://localhost:3000/api/urnas?election=gerais-2026');
      const resActiveExplicit = await urnasFeedRoute(reqActiveExplicit);
      expect(resActiveExplicit.status).toBe(200);
      const jsonActiveExplicit = await resActiveExplicit.json();
      expect(jsonActiveExplicit.context.election.id).toBe(electionA.id);
      expect(jsonActiveExplicit.context.round.id).toBe(roundA1.id);
    } finally {
      await prisma.election.delete({ where: { id: electionSemTurnos.id } });
    }
  });

  // Bônus: Verificação de Cabeçalhos HTTP de Cache
  it('Retorna cabeçalho Cache-Control adequado para feed público', async () => {
    const req = new Request('http://localhost:3000/api/urnas?round=1');
    const res = await urnasFeedRoute(req);
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.headers.get('cache-control')).toContain('max-age=5');
  });

  // PAG-40: Regressão de normalização e fallback de hashStatus entre validationData e colunas do BallotReport
  it('PAG-40: Normaliza status criptográficos e aplica fallback seguro de validationData no feed e detalhe da urna', async () => {
    expect(toCryptographicStatus('VERIFIED')).toBe('VERIFIED');
    expect(toCryptographicStatus('INVALID')).toBe('FAILED');
    expect(toCryptographicStatus('UNAVAILABLE')).toBe('UNCHECKED');
    expect(resolveCryptographicStatus('UNCHECKED', JSON.stringify({ hashStatus: 'VERIFIED' }), 'hashStatus')).toBe('VERIFIED');
    expect(resolveCryptographicStatus('FAILED', JSON.stringify({ hashStatus: 'VERIFIED' }), 'hashStatus')).toBe('FAILED');

    const repFallback = await prisma.ballotReport.create({
      data: {
        deterministicId: 'det-pag40-fallback',
        electionId: electionA.id,
        roundId: roundA1.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '9',
        sectionCode: '42',
        urnCode: '9999',
        status: 'PROCESSADO',
        confirmedAt: new Date('2026-10-30T20:00:00.000Z'),
        hashStatus: 'UNCHECKED',
        sigStatus: 'UNCHECKED',
        validationData: JSON.stringify({ parsed: true, hashStatus: 'VERIFIED', sigStatus: 'UNAVAILABLE' })
      }
    });

    try {
      const feedRes = await urnasFeedRoute(new Request('http://localhost:3000/api/urnas?round=1&limit=20'));
      expect(feedRes.status).toBe(200);
      const feedJson = await feedRes.json();
      const targetItem = feedJson.items.find((i: { id: string }) => i.id === repFallback.id);
      expect(targetItem).toBeDefined();
      expect(targetItem.integrity.hashStatus).toBe('VERIFIED');
      expect(targetItem.integrity.sigStatus).toBe('UNCHECKED');

      const detailRes = await urnaDetailRoute(
        new Request(`http://localhost:3000/api/urnas/${repFallback.id}`),
        { params: Promise.resolve({ id: repFallback.id }) }
      );
      expect(detailRes.status).toBe(200);
      const detailJson = await detailRes.json();
      expect(detailJson.integrity.hashStatus).toBe('VERIFIED');
      expect(detailJson.radioScript).toContain('Hash SHA-512 Verificado com Sucesso');
    } finally {
      await prisma.ballotReport.delete({ where: { id: repFallback.id } });
    }
  });
});
