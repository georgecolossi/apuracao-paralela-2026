import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { GET as totalsRoute } from '../src/app/api/totals/route';
import { getOfficeDataAggregate, classifyVotePresentation, TotalItem } from '../src/lib/presentation/apuracaoHelper';

describe('PR 6 — Painel Público Universal e Projeções Dinâmicas (Auditoria Independente)', () => {
  let stateSC: any;
  let muniConcordia: any;
  let muniChapeco: any;
  let party13: any;
  let party22: any;

  beforeAll(async () => {
    // 1. Limpeza segura de testes
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.office.deleteMany();
    await prisma.party.deleteMany();
    await prisma.electionScope.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
    await prisma.candidateMetadata.deleteMany();

    // 2. Estrutura Territorial Base
    stateSC = await prisma.state.create({
      data: { abbreviation: 'SC', name: 'Santa Catarina' }
    });

    muniConcordia = await prisma.municipality.create({
      data: { officialCode: '80837', name: 'Concórdia', stateId: stateSC.id, isCoverage: true }
    });

    muniChapeco = await prisma.municipality.create({
      data: { officialCode: '80551', name: 'Chapecó', stateId: stateSC.id, isCoverage: true }
    });

    // 3. Partidos
    party13 = await prisma.party.create({
      data: { officialIdentifier: '13', name: 'Partido dos Trabalhadores', abbreviation: 'PT' }
    });

    party22 = await prisma.party.create({
      data: { officialIdentifier: '22', name: 'Partido Liberal', abbreviation: 'PL' }
    });
  });

  afterAll(async () => {
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.roundCoverage.deleteMany();
    await prisma.candidate.deleteMany();
    await prisma.office.deleteMany();
    await prisma.party.deleteMany();
    await prisma.electionScope.deleteMany();
    await prisma.electionRound.deleteMany();
    await prisma.election.deleteMany();
    await prisma.pollingSection.deleteMany();
    await prisma.pollingZone.deleteMany();
    await prisma.municipality.deleteMany();
    await prisma.state.deleteMany();
  });

  // ---------------------------------------------------------------------------
  // 1. Eleição nova com zero BUs
  // ---------------------------------------------------------------------------
  describe('1. Eleição nova com zero BUs', () => {
    let newElectionId: string;
    let roundId: string;

    beforeAll(async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Municipal Teste Zero BUs',
          year: 2028,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          scopes: {
            create: {
              scopeType: 'MUNICIPAL',
              scopeKey: 'MUN:80837',
              stateId: stateSC.id,
              municipalityId: muniConcordia.id
            }
          },
          rounds: {
            create: {
              roundNumber: 1,
              status: 'ACTIVE',
              coverageStatus: 'REGISTERED'
            }
          }
        },
        include: { rounds: true }
      });
      newElectionId = election.id;
      roundId = election.rounds[0].id;

      // Cargos Majoritário e Proporcional
      const prefOffice = await prisma.office.create({
        data: {
          electionId: newElectionId,
          code: '11',
          name: 'Prefeito',
          type: 'MAJORITARIO',
          orderNumber: 1
        }
      });

      const verOffice = await prisma.office.create({
        data: {
          electionId: newElectionId,
          code: '13',
          name: 'Vereador',
          type: 'PROPORCIONAL',
          orderNumber: 2
        }
      });

      // Cadastra candidatos
      await prisma.candidate.createMany({
        data: [
          {
            officeId: prefOffice.id,
            partyId: party13.id,
            candidateNumber: '13',
            name: 'Candidato Prefeito 13',
            ballotName: 'PREFEITO 13'
          },
          {
            officeId: prefOffice.id,
            partyId: party22.id,
            candidateNumber: '22',
            name: 'Candidato Prefeito 22',
            ballotName: 'PREFEITO 22'
          },
          {
            officeId: verOffice.id,
            partyId: party13.id,
            candidateNumber: '13001',
            name: 'Candidato Vereador 13001',
            ballotName: 'VEREADOR 13001'
          }
        ]
      });

      // Configura zona, seção e cobertura de 10 seções esperadas
      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0010', expectedBUs: 10 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0001', expectedBUs: 10 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundId, pollingSectionId: sec.id, expectedBUs: 10 }
      });
    });

    it('1.1 /api/totals deve exibir todos os candidatos cadastrados desde zero votos', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${newElectionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.processedReports).toBe(0);
      expect(json.expectedReports).toBe(10);
      expect(json.isProvisional).toBe(false);
      expect(json.coverageStatus).toBe('CONFIRMADA');

      // Verifica candidatos com 0 votos
      const pref13 = json.totals.find((t: any) => t.officeName === 'Prefeito' && t.candidateNumber === '13');
      const pref22 = json.totals.find((t: any) => t.officeName === 'Prefeito' && t.candidateNumber === '22');
      const ver13001 = json.totals.find((t: any) => t.officeName === 'Vereador' && t.candidateNumber === '13001');

      expect(pref13).toBeDefined();
      expect(pref13.quantity).toBe(0);
      expect(pref13.candidateName).toBe('PREFEITO 13');
      expect(pref13.partyAbbreviation).toBe('PT');

      expect(pref22).toBeDefined();
      expect(pref22.quantity).toBe(0);
      expect(pref22.candidateName).toBe('PREFEITO 22');
      expect(pref22.partyAbbreviation).toBe('PL');

      expect(ver13001).toBeDefined();
      expect(ver13001.quantity).toBe(0);
      expect(ver13001.candidateName).toBe('VEREADOR 13001');

      // Projeção deve estar indisponível aguardando primeiro BU
      expect(json.projections.Prefeito.hasProjection).toBe(false);
      expect(json.projections.Prefeito.reason).toBe('WAITING_FIRST_BU');
    });

    it('1.2 getOfficeDataAggregate deve preservar candidatos com 0 votos quando possuem nome cadastrado', () => {
      const mockTotals = [
        { officeName: 'Prefeito', candidateNumber: '13', candidateName: 'PREFEITO 13', partyAbbreviation: 'PT', voteType: 'NOMINAL', quantity: 0 },
        { officeName: 'Prefeito', candidateNumber: '22', candidateName: 'PREFEITO 22', partyAbbreviation: 'PL', voteType: 'NOMINAL', quantity: 0 }
      ];

      const agg = getOfficeDataAggregate(null, 1, 'Prefeito', mockTotals);
      expect(agg.candidates.length).toBe(2);
      expect(agg.totalValidos).toBe(0);
      expect(agg.totalGeral).toBe(0);
      // Ordenação de desempate numérica: 13 antes de 22
      expect(agg.candidates[0].candidateNumber).toBe('13');
      expect(agg.candidates[1].candidateNumber).toBe('22');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Múltiplas eleições com candidatos de números repetidos (Isolamento Estrito)
  // ---------------------------------------------------------------------------
  describe('2. Múltiplas eleições com candidatos de números repetidos', () => {
    let electionAId: string;
    let electionBId: string;
    let roundAId: string;
    let roundBId: string;

    beforeAll(async () => {
      // Eleição A (Gerais 2026)
      const elA = await prisma.election.create({
        data: {
          name: 'Eleição Federal 2026',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionAId = elA.id;
      roundAId = elA.rounds[0].id;

      // Eleição B (Municipal 2028)
      const elB = await prisma.election.create({
        data: {
          name: 'Eleição Municipal 2028',
          year: 2028,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionBId = elB.id;
      roundBId = elB.rounds[0].id;

      // Cargo Presidente na Eleição A e Prefeito na Eleição B
      const presOffice = await prisma.office.create({
        data: { electionId: electionAId, code: '1', name: 'Presidente', type: 'MAJORITARIO' }
      });

      const prefOffice = await prisma.office.create({
        data: { electionId: electionBId, code: '11', name: 'Prefeito', type: 'MAJORITARIO' }
      });

      // Candidato 13 em ambas as eleições com nomes diferentes
      await prisma.candidate.create({
        data: {
          officeId: presOffice.id,
          partyId: party13.id,
          candidateNumber: '13',
          name: 'Lula Federal',
          ballotName: 'LULA FEDERAL'
        }
      });

      await prisma.candidate.create({
        data: {
          officeId: prefOffice.id,
          partyId: party13.id,
          candidateNumber: '13',
          name: 'Silva Municipal',
          ballotName: 'SILVA PREFEITO'
        }
      });

      // Cria seções e coberturas
      const zoneA = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0020', expectedBUs: 1 }
      });
      const secA = await prisma.pollingSection.create({
        data: { pollingZoneId: zoneA.id, sectionNumber: '0021', expectedBUs: 1 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundAId, pollingSectionId: secA.id, expectedBUs: 1 }
      });

      const zoneB = await prisma.pollingZone.create({
        data: { municipalityId: muniChapeco.id, zoneNumber: '0030', expectedBUs: 1 }
      });
      const secB = await prisma.pollingSection.create({
        data: { pollingZoneId: zoneB.id, sectionNumber: '0031', expectedBUs: 1 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundBId, pollingSectionId: secB.id, expectedBUs: 1 }
      });

      // Registra BU com 500 votos para o candidato 13 na Eleição A
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-ELEC-A-1',
          electionId: electionAId,
          roundId: roundAId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0020',
          sectionCode: '0021',
          urnCode: '101',
          votes: {
            create: [
              { officeId: presOffice.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 500 }
            ]
          }
        }
      });

      // Registra BU com 250 votos para o candidato 13 na Eleição B
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-ELEC-B-1',
          electionId: electionBId,
          roundId: roundBId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80551',
          zoneCode: '0030',
          sectionCode: '0031',
          urnCode: '202',
          votes: {
            create: [
              { officeId: prefOffice.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 250 }
            ]
          }
        }
      });
    });

    it('2.1 /api/totals da Eleição A deve conter exatamente 500 votos e nome LULA FEDERAL', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionAId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.processedReports).toBe(1);
      const cand13 = json.totals.find((t: any) => t.candidateNumber === '13');
      expect(cand13).toBeDefined();
      expect(cand13.quantity).toBe(500);
      expect(cand13.candidateName).toBe('LULA FEDERAL');
      expect(cand13.officeName).toBe('Presidente');
    });

    it('2.2 /api/totals da Eleição B deve conter exatamente 250 votos e nome SILVA PREFEITO sem vazar Eleição A', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionBId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.processedReports).toBe(1);
      const cand13 = json.totals.find((t: any) => t.candidateNumber === '13');
      expect(cand13).toBeDefined();
      expect(cand13.quantity).toBe(250);
      expect(cand13.candidateName).toBe('SILVA PREFEITO');
      expect(cand13.officeName).toBe('Prefeito');
    });

    it('2.3 Requisição sem election em cenário de múltiplas eleições ativas retorna 400 CONFIGURACAO_AMBIGUA', async () => {
      const res = await totalsRoute(new Request('http://localhost/api/totals'));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('CONFIGURACAO_AMBIGUA');
      expect(Array.isArray(json.activeElections)).toBe(true);
      expect(json.activeElections.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Primeiro e segundo turnos com cobertura diferente
  // ---------------------------------------------------------------------------
  describe('3. Primeiro e segundo turnos com cobertura diferente', () => {
    let electionId: string;
    let r1Id: string;
    let r2Id: string;

    beforeAll(async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Dois Turnos Cobertura Diferente',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: [
              { roundNumber: 1, status: 'FINISHED', coverageStatus: 'REGISTERED' },
              { roundNumber: 2, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
            ]
          }
        },
        include: { rounds: true }
      });
      electionId = el.id;
      r1Id = el.rounds.find(r => r.roundNumber === 1)!.id;
      r2Id = el.rounds.find(r => r.roundNumber === 2)!.id;

      const govOffice = await prisma.office.create({
        data: { electionId, code: '3', name: 'Governador', type: 'MAJORITARIO' }
      });

      // T1 tem 15 urnas esperadas em duas seções
      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0040', expectedBUs: 15 }
      });
      const sec1 = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0041', expectedBUs: 10 }
      });
      const sec2 = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0042', expectedBUs: 5 }
      });

      await prisma.roundCoverage.createMany({
        data: [
          { electionRoundId: r1Id, pollingSectionId: sec1.id, expectedBUs: 10 },
          { electionRoundId: r1Id, pollingSectionId: sec2.id, expectedBUs: 5 }
        ]
      });

      // T2 tem apenas 10 urnas esperadas (apenas sec1)
      await prisma.roundCoverage.create({
        data: { electionRoundId: r2Id, pollingSectionId: sec1.id, expectedBUs: 10 }
      });

      // Injeta 1 BU no T1 e 1 BU no T2
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-T1-DIFF',
          electionId,
          roundId: r1Id,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0040',
          sectionCode: '0041',
          urnCode: '301',
          votes: {
            create: [
              { officeId: govOffice.id, voteType: 'NOMINAL', candidateNumber: '22', quantity: 300 }
            ]
          }
        }
      });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-T2-DIFF',
          electionId,
          roundId: r2Id,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0040',
          sectionCode: '0041',
          urnCode: '301',
          votes: {
            create: [
              { officeId: govOffice.id, voteType: 'NOMINAL', candidateNumber: '22', quantity: 450 }
            ]
          }
        }
      });
    });

    it('3.1 Turno 1 deve reportar 15 urnas esperadas e 300 votos', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.round.roundNumber).toBe(1);
      expect(json.expectedReports).toBe(15);
      expect(json.processedReports).toBe(1);
      const cand22 = json.totals.find((t: any) => t.candidateNumber === '22');
      expect(cand22.quantity).toBe(300);
    });

    it('3.2 Turno 2 deve reportar 10 urnas esperadas e 450 votos sem contaminação do T1', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=2`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.round.roundNumber).toBe(2);
      expect(json.expectedReports).toBe(10);
      expect(json.processedReports).toBe(1);
      const cand22 = json.totals.find((t: any) => t.candidateNumber === '22');
      expect(cand22.quantity).toBe(450);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Seções agregadas e expectedBUs igual a zero
  // ---------------------------------------------------------------------------
  describe('4. Seções agregadas e expectedBUs igual a zero', () => {
    let electionId: string;
    let roundId: string;

    beforeAll(async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição com Seções Agregadas',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionId = el.id;
      roundId = el.rounds[0].id;

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0050', expectedBUs: 2 }
      });

      // Seção principal: 1 BU esperado
      const secPrincipal = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0051', isAggregated: false, expectedBUs: 1 }
      });

      // Seção agregada na 0051: 0 BUs esperados (não gera urna física própria)
      const secAgregada = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0052', isAggregated: true, aggregatedIntoSec: '0051', expectedBUs: 0 }
      });

      // Outra seção normal: 1 BU esperado
      const secNormal = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0053', isAggregated: false, expectedBUs: 1 }
      });

      await prisma.roundCoverage.createMany({
        data: [
          { electionRoundId: roundId, pollingSectionId: secPrincipal.id, expectedBUs: 1 },
          { electionRoundId: roundId, pollingSectionId: secAgregada.id, expectedBUs: 0 },
          { electionRoundId: roundId, pollingSectionId: secNormal.id, expectedBUs: 1 }
        ]
      });
    });

    it('4.1 expectedReports deve somar exatamente 2 BUs (ignorando seção com 0 BUs)', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.expectedReports).toBe(2);
      expect(json.officialExpectedReports).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. BUs simulados versus reais
  // ---------------------------------------------------------------------------
  describe('5. BUs simulados versus reais', () => {
    let electionId: string;
    let roundId: string;
    let officeId: string;

    beforeAll(async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Teste Simulação Exclusão',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionId = el.id;
      roundId = el.rounds[0].id;

      const off = await prisma.office.create({
        data: { electionId, code: '1', name: 'Presidente', type: 'MAJORITARIO' }
      });

      await prisma.candidate.create({
        data: {
          officeId: off.id,
          partyId: party13.id,
          candidateNumber: '13',
          name: 'Candidato 13 Pres',
          ballotName: 'CANDIDATO 13'
        }
      });
      officeId = off.id;

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0060', expectedBUs: 2 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0061', expectedBUs: 1 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundId, pollingSectionId: sec.id, expectedBUs: 1 }
      });

      // BU Real: 100 votos
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-REAL-001',
          electionId,
          roundId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0060',
          sectionCode: '0061',
          urnCode: '601',
          votes: {
            create: [
              { officeId, voteType: 'NOMINAL', candidateNumber: '13', quantity: 100 }
            ]
          }
        }
      });

      // BU Simulado: 999 votos
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-SIM-999',
          electionId,
          roundId,
          status: 'PROCESSADO',
          isSimulation: true,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0060',
          sectionCode: '0061',
          urnCode: '601',
          votes: {
            create: [
              { officeId, voteType: 'NOMINAL', candidateNumber: '13', quantity: 999 }
            ]
          }
        }
      });
    });

    it('5.1 /api/totals deve contabilizar apenas o BU real (100 votos) e ignorar o simulado', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.processedReports).toBe(1);
      expect(json.receivedReports).toBe(1);
      const cand13 = json.totals.find((t: any) => t.candidateNumber === '13');
      expect(cand13.quantity).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. BUs pendentes versus confirmados
  // ---------------------------------------------------------------------------
  describe('6. BUs pendentes versus confirmados', () => {
    let electionId: string;
    let roundId: string;
    let officeId: string;

    beforeAll(async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Teste Pendentes vs Confirmados',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionId = el.id;
      roundId = el.rounds[0].id;

      const off = await prisma.office.create({
        data: { electionId, code: '1', name: 'Presidente', type: 'MAJORITARIO' }
      });

      await prisma.candidate.create({
        data: {
          officeId: off.id,
          partyId: party13.id,
          candidateNumber: '13',
          name: 'Candidato 13 Pres',
          ballotName: 'CANDIDATO 13'
        }
      });
      officeId = off.id;

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0070', expectedBUs: 2 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0071', expectedBUs: 2 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundId, pollingSectionId: sec.id, expectedBUs: 2 }
      });

      // BU Confirmado: 80 votos
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-CONF-001',
          electionId,
          roundId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0070',
          sectionCode: '0071',
          urnCode: '701',
          votes: {
            create: [
              { officeId, voteType: 'NOMINAL', candidateNumber: '22', quantity: 80 }
            ]
          }
        }
      });

      // BU Pendente: 120 votos
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-PEND-002',
          electionId,
          roundId,
          status: 'PENDENTE_CONFIRMACAO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0070',
          sectionCode: '0071',
          urnCode: '702',
          votes: {
            create: [
              { officeId, voteType: 'NOMINAL', candidateNumber: '22', quantity: 120 }
            ]
          }
        }
      });
    });

    it('6.1 /api/totals deve processar exatamente 1 BU (80 votos) e não contar BU pendente', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.processedReports).toBe(1);
      expect(json.receivedReports).toBe(2);
      const cand22 = json.totals.find((t: any) => t.candidateNumber === '22');
      expect(cand22.quantity).toBe(80);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Votos majoritários, proporcionais e de legenda
  // ---------------------------------------------------------------------------
  describe('7. Votos majoritários, proporcionais e de legenda', () => {
    let electionId: string;
    let roundId: string;

    beforeAll(async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Proporcional e Legenda',
          year: 2028,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionId = el.id;
      roundId = el.rounds[0].id;

      const verOffice = await prisma.office.create({
        data: { electionId, code: '13', name: 'Vereador', type: 'PROPORCIONAL' }
      });

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0080', expectedBUs: 1 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0081', expectedBUs: 1 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundId, pollingSectionId: sec.id, expectedBUs: 1 }
      });

      // BU com votos nominais e votos de legenda
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-PROP-LEG-1',
          electionId,
          roundId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0080',
          sectionCode: '0081',
          urnCode: '801',
          votes: {
            create: [
              { officeId: verOffice.id, voteType: 'NOMINAL', candidateNumber: '13001', quantity: 50 },
              { officeId: verOffice.id, voteType: 'LEGENDA', partyNumber: '13', quantity: 20 },
              { officeId: verOffice.id, voteType: 'LEGENDA', partyNumber: '22', quantity: 15 }
            ]
          }
        }
      });
    });

    it('7.1 /api/totals deve separar votos de legenda e nominais em proporcionais', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      const nom13001 = json.totals.find((t: any) => t.candidateNumber === '13001' && t.voteType === 'NOMINAL');
      const leg13 = json.totals.find((t: any) => t.partyNumber === '13' && t.voteType === 'LEGENDA');
      const leg22 = json.totals.find((t: any) => t.partyNumber === '22' && t.voteType === 'LEGENDA');

      expect(nom13001.quantity).toBe(50);
      expect(leg13.quantity).toBe(20);
      expect(leg22.quantity).toBe(15);
    });

    it('7.2 getOfficeDataAggregate deve totalizar votos válidos como nominais + legenda', () => {
      const mockTotals = [
        { officeName: 'Vereador', candidateNumber: '13001', candidateName: 'VEREADOR 13001', voteType: 'NOMINAL', quantity: 50 },
        { officeName: 'Vereador', partyNumber: '13', partyAbbreviation: 'PT', voteType: 'LEGENDA', quantity: 20 },
        { officeName: 'Vereador', partyNumber: '22', partyAbbreviation: 'PL', voteType: 'LEGENDA', quantity: 15 }
      ];

      const agg = getOfficeDataAggregate(null, 1, 'Vereador', mockTotals);
      expect(agg.validosNominais).toBe(50);
      expect(agg.validosLegenda).toBe(35);
      expect(agg.totalValidos).toBe(85);
      expect(agg.legendas.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Votos brancos e nulos
  // ---------------------------------------------------------------------------
  describe('8. Votos brancos e nulos', () => {
    let electionId: string;
    let roundId: string;

    beforeAll(async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Votos Brancos e Nulos',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionId = el.id;
      roundId = el.rounds[0].id;

      const off = await prisma.office.create({
        data: { electionId, code: '1', name: 'Presidente', type: 'MAJORITARIO' }
      });

      await prisma.candidate.create({
        data: {
          officeId: off.id,
          partyId: party13.id,
          candidateNumber: '13',
          name: 'Candidato 13 Pres',
          ballotName: 'CANDIDATO 13'
        }
      });

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0095', expectedBUs: 1 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0096', expectedBUs: 1 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundId, pollingSectionId: sec.id, expectedBUs: 1 }
      });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-BRAN-NULO-1',
          electionId,
          roundId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0095',
          sectionCode: '0096',
          urnCode: '901',
          votes: {
            create: [
              { officeId: off.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 200 },
              { officeId: off.id, voteType: 'BRANCO', quantity: 20 },
              { officeId: off.id, voteType: 'NULO', quantity: 30 }
            ]
          }
        }
      });
    });

    it('8.1 /api/totals deve computar votos brancos e nulos separadamente', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      const branco = json.totals.find((t: any) => t.voteType === 'BRANCO');
      const nulo = json.totals.find((t: any) => t.voteType === 'NULO');

      expect(branco.quantity).toBe(20);
      expect(nulo.quantity).toBe(30);

      const agg = getOfficeDataAggregate(null, 1, 'Presidente', json.totals);
      expect(agg.totalValidos).toBe(200);
      expect(agg.brancos).toBe(20);
      expect(agg.nulos).toBe(30);
      expect(agg.totalGeral).toBe(250);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Isolamento geográfico e escopo
  // ---------------------------------------------------------------------------
  describe('9. Isolamento geográfico e escopo', () => {
    let muniElectionId: string;
    let nacElectionId: string;

    beforeAll(async () => {
      const elMuni = await prisma.election.create({
        data: {
          name: 'Eleição Municipal Concórdia',
          year: 2028,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          scopes: {
            create: {
              scopeType: 'MUNICIPAL',
              scopeKey: 'MUN:80837',
              stateId: stateSC.id,
              municipalityId: muniConcordia.id
            }
          },
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        }
      });
      muniElectionId = elMuni.id;

      const elNac = await prisma.election.create({
        data: {
          name: 'Eleição Presidencial Brasil',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          scopes: {
            create: {
              scopeType: 'NACIONAL',
              scopeKey: 'BR'
            }
          },
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        }
      });
      nacElectionId = elNac.id;
    });

    it('9.1 Eleição municipal deve retornar contexto territorial de Concórdia / SC', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${muniElectionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.election.scope).toBeDefined();
      expect(json.election.scope.type).toBe('MUNICIPAL');
      expect(json.election.scope.municipality.name).toBe('Concórdia');
      expect(json.election.scope.state.uf).toBe('SC');
    });

    it('9.2 Eleição nacional deve retornar escopo NACIONAL sem município acoplado', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${nacElectionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.election.scope).toBeDefined();
      expect(json.election.scope.type).toBe('NACIONAL');
      expect(json.election.scope.municipality).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Projeções matemáticas honestas e condicionadas
  // ---------------------------------------------------------------------------
  describe('10. Projeções matemáticas honestas e condicionadas', () => {
    let electionId: string;
    let roundId: string;

    beforeAll(async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Teste Projeções',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      electionId = el.id;
      roundId = el.rounds[0].id;

      // Majoritário: Governador
      const govOffice = await prisma.office.create({
        data: { electionId, code: '3', name: 'Governador', type: 'MAJORITARIO' }
      });

      // Proporcional: Deputado Estadual
      const depOffice = await prisma.office.create({
        data: { electionId, code: '7', name: 'Deputado Estadual', type: 'PROPORCIONAL' }
      });

      // 10 seções esperadas
      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: '0100', expectedBUs: 10 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: '0101', expectedBUs: 10 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: roundId, pollingSectionId: sec.id, expectedBUs: 10 }
      });

      // Cadastra candidatos
      await prisma.candidate.createMany({
        data: [
          { officeId: govOffice.id, partyId: party13.id, candidateNumber: '13', name: 'Gov 13', ballotName: 'GOV 13' },
          { officeId: govOffice.id, partyId: party22.id, candidateNumber: '22', name: 'Gov 22', ballotName: 'GOV 22' },
          { officeId: depOffice.id, partyId: party13.id, candidateNumber: '13111', name: 'Dep 13111', ballotName: 'DEP 13111' }
        ]
      });

      // Insere 2 BUs reais processados (20% da malha)
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-PROJ-1',
          electionId,
          roundId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0100',
          sectionCode: '0101',
          urnCode: '1001',
          votes: {
            create: [
              { officeId: govOffice.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 60 },
              { officeId: govOffice.id, voteType: 'NOMINAL', candidateNumber: '22', quantity: 40 },
              { officeId: depOffice.id, voteType: 'NOMINAL', candidateNumber: '13111', quantity: 50 }
            ]
          }
        }
      });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-PROJ-2',
          electionId,
          roundId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0100',
          sectionCode: '0101',
          urnCode: '1002',
          votes: {
            create: [
              { officeId: govOffice.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 40 },
              { officeId: govOffice.id, voteType: 'NOMINAL', candidateNumber: '22', quantity: 60 },
              { officeId: depOffice.id, voteType: 'NOMINAL', candidateNumber: '13111', quantity: 50 }
            ]
          }
        }
      });
    });

    it('10.1 Projeção deve ser ativa para Governador (Majoritário) com disclaimer e sem vencedor precoce', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.processedReports).toBe(2);
      expect(json.expectedReports).toBe(10);

      const govProj = json.projections.Governador;
      expect(govProj).toBeDefined();
      expect(govProj.hasProjection).toBe(true);
      expect(govProj.status).toBe('ACTIVE');
      expect(govProj.method).toBe('LINEAR_PROPORTIONAL');
      expect(govProj.disclaimer).toContain('Não representa resultado oficial');

      // Votos atuais: 13 tem 100, 22 tem 100. Com 2 de 10 urnas, projeção = 100 * (10 / 2) = 500
      const cand13Proj = govProj.candidates.find((c: any) => c.candidateNumber === '13');
      const cand22Proj = govProj.candidates.find((c: any) => c.candidateNumber === '22');
      expect(cand13Proj.projectedVotes).toBe(500);
      expect(cand22Proj.projectedVotes).toBe(500);
    });

    it('10.2 Projeção deve ser estritamente bloqueada para Deputado Estadual (Proporcional)', async () => {
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${electionId}&round=1`));
      const json = await res.json();

      const depProj = json.projections['Deputado Estadual'];
      expect(depProj).toBeDefined();
      expect(depProj.hasProjection).toBe(false);
      expect(depProj.reason).toBe('PROPORTIONAL_NOT_ALLOWED');
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Cache e Cabeçalhos HTTP
  // ---------------------------------------------------------------------------
  describe('11. Cache e Cabeçalhos HTTP', () => {
    it('11.1 /api/totals deve conter Cache-Control no-store, no-cache, must-revalidate, proxy-revalidate', async () => {
      const res = await totalsRoute(new Request('http://localhost/api/totals?round=1'));
      expect(res.headers.get('Cache-Control')).toContain('no-store');
      expect(res.headers.get('Cache-Control')).toContain('no-cache');
      expect(res.headers.get('Cache-Control')).toContain('must-revalidate');
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Consulta pública estritamente read-only
  // ---------------------------------------------------------------------------
  describe('12. Consulta pública estritamente read-only', () => {
    it('12.1 GET /api/totals não deve criar nem alterar nenhuma linha no banco de dados', async () => {
      const countCandBefore = await prisma.candidate.count();
      const countOffBefore = await prisma.office.count();
      const countRepBefore = await prisma.ballotReport.count();
      const countVoteBefore = await prisma.ballotVote.count();

      const activeEl = await prisma.election.findFirst({ where: { status: 'ACTIVE' } });
      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${activeEl?.id}&round=1`));
      expect(res.status).toBe(200);

      const countCandAfter = await prisma.candidate.count();
      const countOffAfter = await prisma.office.count();
      const countRepAfter = await prisma.ballotReport.count();
      const countVoteAfter = await prisma.ballotVote.count();

      expect(countCandAfter).toBe(countCandBefore);
      expect(countOffAfter).toBe(countOffBefore);
      expect(countRepAfter).toBe(countRepBefore);
      expect(countVoteAfter).toBe(countVoteBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // 13. Projeções em Eleições Provisórias com diferentes denominadores (P0 Auditoria)
  // ---------------------------------------------------------------------------
  describe('13. Projeções em Eleições Provisórias com denominadores dinâmicos (0, 10, 30, 193, 250 BUs)', () => {
    it('13.1 Provisória com 0 BUs esperados deve retornar DENOMINATOR_UNAVAILABLE e jamais presumir 193', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Provisória 0 BUs',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
          }
        },
        include: { rounds: true }
      });

      const off = await prisma.office.create({
        data: { electionId: el.id, code: '11', name: 'Prefeito', type: 'MAJORITARIO' }
      });

      await prisma.candidate.create({
        data: { officeId: off.id, partyId: party13.id, candidateNumber: '13', name: 'Pref A', ballotName: 'PREF A' }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
      const json = await res.json();

      expect(json.projections.Prefeito.hasProjection).toBe(false);
      expect(json.projections.Prefeito.reason).toBe('DENOMINATOR_UNAVAILABLE');
      expect(json.expectedReports).toBe(0);
    });

    it('13.2 Provisórias com 10, 30, 193 e 250 BUs devem projetar rigorosamente com o respectivo denominador', async () => {
      const testCases = [10, 30, 193, 250];

      for (const expectedTotal of testCases) {
        const el = await prisma.election.create({
          data: {
            name: `Eleição Provisória ${expectedTotal} BUs`,
            year: 2026,
            type: 'MUNICIPAL',
            status: 'ACTIVE',
            rounds: {
              create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
            }
          },
          include: { rounds: true }
        });
        const rId = el.rounds[0].id;

        const off = await prisma.office.create({
          data: { electionId: el.id, code: '11', name: 'Prefeito', type: 'MAJORITARIO' }
        });

        await prisma.candidate.create({
          data: { officeId: off.id, partyId: party13.id, candidateNumber: '13', name: 'Pref Teste', ballotName: 'PREF TESTE' }
        });

        // Configura RoundCoverage com o total esperado
        const zone = await prisma.pollingZone.create({
          data: { municipalityId: muniConcordia.id, zoneNumber: `Z${expectedTotal}`, expectedBUs: expectedTotal }
        });
        const sec = await prisma.pollingSection.create({
          data: { pollingZoneId: zone.id, sectionNumber: `S${expectedTotal}`, expectedBUs: expectedTotal }
        });
        await prisma.roundCoverage.create({
          data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: expectedTotal }
        });

        // 1 BU processado com 10 votos
        await prisma.ballotReport.create({
          data: {
            deterministicId: `BU-PROV-${expectedTotal}`,
            electionId: el.id,
            roundId: rId,
            status: 'PROCESSADO',
            isSimulation: false,
            stateCode: 'SC',
            cityCode: '80837',
            zoneCode: `Z${expectedTotal}`,
            sectionCode: `S${expectedTotal}`,
            urnCode: `U${expectedTotal}`,
            votes: {
              create: [{ officeId: off.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 10 }]
            }
          }
        });

        const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
        const json = await res.json();

        expect(json.isProvisional).toBe(true);
        expect(json.projections.Prefeito.hasProjection).toBe(true);
        expect(json.projections.Prefeito.expectedReports).toBe(expectedTotal);

        // Projeção matemática: 10 * (expectedTotal / 1) = 10 * expectedTotal
        const candProj = json.projections.Prefeito.candidates.find((c: any) => c.candidateNumber === '13');
        expect(candProj.projectedVotes).toBe(10 * expectedTotal);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Respeito ao Status Canônico da Cobertura (Sem Homologação Implícita)
  // ---------------------------------------------------------------------------
  describe('14. Respeito ao Status Canônico da Cobertura', () => {
    it('14.1 Cobertura PROVISIONAL com 193 urnas deve permanecer estritamente PROVISIONAL e não virar HOMOLOGATED', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Provisória 193 Urnas',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 2, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'Z193P', expectedBUs: 193 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: 'S193P', expectedBUs: 193 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: 193 }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=2`));
      const json = await res.json();

      expect(json.canonicalCoverageStatus).toBe('PROVISIONAL');
      expect(json.coverageStatusLabel).toBe('Cobertura Provisória');
      expect(json.coverageStatus).toBe('PROVISORIA');
      expect(json.isProvisional).toBe(true);
      expect(json.coverageConfigured).toBe(false);
    });

    it('14.2 Cobertura PROVISIONAL com 250 urnas deve permanecer estritamente PROVISIONAL e não virar HOMOLOGATED', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Provisória 250 Urnas',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 2, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'Z250P', expectedBUs: 250 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: 'S250P', expectedBUs: 250 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: 250 }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=2`));
      const json = await res.json();

      expect(json.canonicalCoverageStatus).toBe('PROVISIONAL');
      expect(json.coverageStatusLabel).toBe('Cobertura Provisória');
      expect(json.coverageStatus).toBe('PROVISORIA');
      expect(json.isProvisional).toBe(true);
      expect(json.coverageConfigured).toBe(false);
    });

    it('14.3 Coberturas REGISTERED e HOMOLOGATED devem refletir seus status canônicos com precisão', async () => {
      // REGISTERED
      const elReg = await prisma.election.create({
        data: {
          name: 'Eleição Status REGISTERED',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      const resReg = await totalsRoute(new Request(`http://localhost/api/totals?election=${elReg.id}&round=1`));
      const jsonReg = await resReg.json();
      expect(jsonReg.canonicalCoverageStatus).toBe('REGISTERED');
      expect(jsonReg.coverageStatusLabel).toBe('Cobertura Cadastrada');
      expect(jsonReg.isProvisional).toBe(false);

      // HOMOLOGATED
      const elHom = await prisma.election.create({
        data: {
          name: 'Eleição Status HOMOLOGATED',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'HOMOLOGATED' }
          }
        },
        include: { rounds: true }
      });
      const resHom = await totalsRoute(new Request(`http://localhost/api/totals?election=${elHom.id}&round=1`));
      const jsonHom = await resHom.json();
      expect(jsonHom.canonicalCoverageStatus).toBe('HOMOLOGATED');
      expect(jsonHom.coverageStatusLabel).toBe('Cobertura Homologada');
      expect(jsonHom.isProvisional).toBe(false);

      // UNCONFIGURED
      const elUnc = await prisma.election.create({
        data: {
          name: 'Eleição Status UNCONFIGURED',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'UNCONFIGURED' }
          }
        },
        include: { rounds: true }
      });
      const resUnc = await totalsRoute(new Request(`http://localhost/api/totals?election=${elUnc.id}&round=1`));
      const jsonUnc = await resUnc.json();
      expect(jsonUnc.canonicalCoverageStatus).toBe('UNCONFIGURED');
      expect(jsonUnc.coverageStatusLabel).toBe('Não Configurada');
      expect(jsonUnc.coverageConfigured).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 15. Isolamento Estrito de Metadados e Não Injeção de Estranhos
  // ---------------------------------------------------------------------------
  describe('15. Isolamento Estrito de Metadados de Candidatos', () => {
    it('15.1 Eleição municipal fora de SC com candidato homônimo não deve sofrer vazamento de registros legados', async () => {
      // Cria estado PR e município Curitiba
      const statePR = await prisma.state.upsert({
        where: { abbreviation: 'PR' },
        update: {},
        create: { abbreviation: 'PR', name: 'Paraná' }
      });

      const muniCuritiba = await prisma.municipality.upsert({
        where: { officialCode: '75353' },
        update: {},
        create: { officialCode: '75353', name: 'Curitiba', stateId: statePR.id, isCoverage: true }
      });

      // Eleição Municipal em Curitiba/PR em 2026
      const elCuritiba = await prisma.election.create({
        data: {
          name: 'Eleição Curitiba 2026',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          scopes: {
            create: {
              scopeType: 'MUNICIPAL',
              scopeKey: 'MUN:75353',
              stateId: statePR.id,
              municipalityId: muniCuritiba.id
            }
          },
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });

      const prefOffice = await prisma.office.create({
        data: { electionId: elCuritiba.id, code: '11', name: 'Prefeito', type: 'MAJORITARIO' }
      });

      // Cadastra candidato legítimo de Curitiba: número 13
      await prisma.candidate.create({
        data: {
          officeId: prefOffice.id,
          partyId: party13.id,
          candidateNumber: '13',
          name: 'Goura Curitiba',
          ballotName: 'GOURA PREFEITO'
        }
      });

      // Popula CandidateMetadata com candidato número 13 de outro pleito (Presidente / SC / Lula)
      await prisma.candidateMetadata.upsert({
        where: { candidateSequence: 'LEGACY-LULA-SC' },
        update: {},
        create: {
          candidateSequence: 'LEGACY-LULA-SC',
          electionYear: 2026,
          electionCode: '9999',
          round: 1,
          state: 'SC',
          officeCode: '1',
          officeName: 'Presidente',
          candidateNumber: '13',
          ballotName: 'LULA PRESIDENTE SC',
          partyNumber: '13',
          partyAbbreviation: 'PT',
          partyName: 'PT'
        }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${elCuritiba.id}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      // Confirma contexto territorial de Curitiba / PR (sem fallback para SC)
      expect(json.election.scope.municipality.name).toBe('Curitiba');
      expect(json.election.scope.state.uf).toBe('PR');

      // Totais deve conter EXCLUSIVAMENTE o Prefeito GOURA de Curitiba
      expect(json.totals.length).toBe(1);
      const cand13 = json.totals[0];
      expect(cand13.candidateNumber).toBe('13');
      expect(cand13.candidateName).toBe('GOURA PREFEITO');
      expect(cand13.officeName).toBe('Prefeito');

      // Nenhum candidato 'LULA PRESIDENTE SC' ou de outro estado pode vazar
      const leakedCand = json.totals.find((t: any) => t.candidateName?.includes('PRESIDENTE') || t.candidateName?.includes('SC'));
      expect(leakedCand).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 16. Alinhamento de Denominador da API e Interface (Reauditoria P0)
  // ---------------------------------------------------------------------------
  describe('16. Alinhamento de Denominadores da API e Interface (Reauditoria P0)', () => {
    it('16.1 PROVISIONAL com 0 urnas esperadas: denominador zero e projeção indisponível', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Provisória 0 Esperadas',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      const off = await prisma.office.create({
        data: { electionId: el.id, code: '11', name: 'Prefeito', type: 'MAJORITARIO' }
      });

      await prisma.candidate.create({
        data: { officeId: off.id, partyId: party13.id, candidateNumber: '13', name: 'Candidato 13', ballotName: 'CANDIDATO 13' }
      });

      // 1 BU processado dinamicamente
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-PROV-0-TEST',
          electionId: el.id,
          roundId: rId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: '0001',
          urnCode: 'U0001',
          votes: {
            create: [{ officeId: off.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 10 }]
          }
        }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.isProvisional).toBe(true);
      expect(json.canonicalCoverageStatus).toBe('PROVISIONAL');
      expect(json.coverageStatusLabel).toBe('Cobertura Provisória');
      expect(json.expectedReports).toBe(0);
      expect(json.registeredExpectedReports).toBe(0);
      expect(json.officialExpectedReports).toBeNull();
      expect(json.processedReports).toBe(1);

      // Projeção declarada expressamente como indisponível
      const proj = json.projections[off.id] || json.projections[off.name];
      expect(proj.hasProjection).toBe(false);
      expect(proj.reason).toBe('DENOMINATOR_UNAVAILABLE');
    });

    it('16.2 PROVISIONAL com 30 urnas esperadas e 1 processada: projeção provisória ativa e denominadores alinhados', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Provisória 30 Esperadas',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      const off = await prisma.office.create({
        data: { electionId: el.id, code: '11', name: 'Prefeito', type: 'MAJORITARIO' }
      });

      await prisma.candidate.create({
        data: { officeId: off.id, partyId: party13.id, candidateNumber: '13', name: 'Candidato 13', ballotName: 'CANDIDATO 13' }
      });

      // Cadastra 30 urnas esperadas em RoundCoverage
      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'Z30_S16', expectedBUs: 30 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: 'S30_S16', expectedBUs: 30 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: 30 }
      });

      // 1 BU processado com 10 votos
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-PROV-30-TEST',
          electionId: el.id,
          roundId: rId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: 'Z30_S16',
          sectionCode: 'S30_S16',
          urnCode: 'U30',
          votes: {
            create: [{ officeId: off.id, voteType: 'NOMINAL', candidateNumber: '13', quantity: 10 }]
          }
        }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      // Denominadores alinhados e transparentes
      expect(json.isProvisional).toBe(true);
      expect(json.canonicalCoverageStatus).toBe('PROVISIONAL');
      expect(json.coverageStatusLabel).toBe('Cobertura Provisória');
      expect(json.expectedReports).toBe(30);
      expect(json.registeredExpectedReports).toBe(30);
      expect(json.officialExpectedReports).toBeNull(); // Não homologado oficialmente
      expect(json.processedReports).toBe(1);

      // Projeção provisória ativa usando exatamente as 30 urnas
      const proj = json.projections[off.id] || json.projections[off.name];
      expect(proj.hasProjection).toBe(true);
      expect(proj.isProvisional).toBe(true);
      expect(proj.expectedReports).toBe(30);
      expect(proj.processedReports).toBe(1);
      expect(proj.candidates[0].currentVotes).toBe(10);
      expect(proj.candidates[0].projectedVotes).toBe(300); // 10 * 30 / 1
    });

    it('16.3 PROVISIONAL com 193 urnas esperadas e 10 processadas: projeção e progresso proporcionais exatos', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Provisória 193 Esperadas',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      const off = await prisma.office.create({
        data: { electionId: el.id, code: '11', name: 'Prefeito', type: 'MAJORITARIO' }
      });

      await prisma.candidate.create({
        data: { officeId: off.id, partyId: party22.id, candidateNumber: '22', name: 'Candidato 22', ballotName: 'CANDIDATO 22' }
      });

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'Z193_S16', expectedBUs: 193 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: 'S193_S16', expectedBUs: 193 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: 193 }
      });

      // 10 BUs processados com 5 votos cada = 50 votos
      for (let i = 1; i <= 10; i++) {
        await prisma.ballotReport.create({
          data: {
            deterministicId: `BU-PROV-193-${i}`,
            electionId: el.id,
            roundId: rId,
            status: 'PROCESSADO',
            isSimulation: false,
            stateCode: 'SC',
            cityCode: '80837',
            zoneCode: 'Z193_S16',
            sectionCode: `S193_S16-${i}`,
            urnCode: `U193-${i}`,
            votes: {
              create: [{ officeId: off.id, voteType: 'NOMINAL', candidateNumber: '22', quantity: 5 }]
            }
          }
        });
      }

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.isProvisional).toBe(true);
      expect(json.expectedReports).toBe(193);
      expect(json.registeredExpectedReports).toBe(193);
      expect(json.officialExpectedReports).toBeNull();
      expect(json.processedReports).toBe(10);

      const proj = json.projections[off.id];
      expect(proj.hasProjection).toBe(true);
      expect(proj.expectedReports).toBe(193);
      expect(proj.processedReports).toBe(10);
      expect(proj.candidates[0].currentVotes).toBe(50);
      // Math.round((50 * 193) / 10) = Math.round(965) = 965
      expect(proj.candidates[0].projectedVotes).toBe(965);
    });

    it('16.4 REGISTERED e HOMOLOGATED expõem officialExpectedReports e status canônico', async () => {
      // REGISTERED
      const elReg = await prisma.election.create({
        data: {
          name: 'Eleição Registro Oficial',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      const rRegId = elReg.rounds[0].id;
      const zoneReg = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'ZREG_S16', expectedBUs: 50 }
      });
      const secReg = await prisma.pollingSection.create({
        data: { pollingZoneId: zoneReg.id, sectionNumber: 'SREG_S16', expectedBUs: 50 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rRegId, pollingSectionId: secReg.id, expectedBUs: 50 }
      });

      const resReg = await totalsRoute(new Request(`http://localhost/api/totals?election=${elReg.id}&round=1`));
      const jsonReg = await resReg.json();
      expect(jsonReg.canonicalCoverageStatus).toBe('REGISTERED');
      expect(jsonReg.isProvisional).toBe(false);
      expect(jsonReg.expectedReports).toBe(50);
      expect(jsonReg.officialExpectedReports).toBe(50);

      // HOMOLOGATED
      const elHom = await prisma.election.create({
        data: {
          name: 'Eleição Homologada Oficial',
          year: 2026,
          type: 'GENERAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'HOMOLOGATED' }
          }
        },
        include: { rounds: true }
      });
      const rHomId = elHom.rounds[0].id;
      const zoneHom = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'ZHOM_S16', expectedBUs: 80 }
      });
      const secHom = await prisma.pollingSection.create({
        data: { pollingZoneId: zoneHom.id, sectionNumber: 'SHOM_S16', expectedBUs: 80 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rHomId, pollingSectionId: secHom.id, expectedBUs: 80 }
      });

      const resHom = await totalsRoute(new Request(`http://localhost/api/totals?election=${elHom.id}&round=1`));
      const jsonHom = await resHom.json();
      expect(jsonHom.canonicalCoverageStatus).toBe('HOMOLOGATED');
      expect(jsonHom.isProvisional).toBe(false);
      expect(jsonHom.expectedReports).toBe(80);
      expect(jsonHom.officialExpectedReports).toBe(80);
    });

    it('16.5 Cargos proporcionais nunca recebem extrapolação mesmo com denominador definido', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Proporcional Sem Extrapolação',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'PROVISIONAL' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      const offProp = await prisma.office.create({
        data: { electionId: el.id, code: '13', name: 'Vereador', type: 'PROPORCIONAL' }
      });

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'ZPROP_S16', expectedBUs: 100 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: 'SPROP_S16', expectedBUs: 100 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: 100 }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
      const json = await res.json();
      const proj = json.projections[offProp.id] || json.projections[offProp.name];
      expect(proj.hasProjection).toBe(false);
      expect(proj.reason).toBe('PROPORTIONAL_NOT_ALLOWED');
    });
  });

  // ---------------------------------------------------------------------------
  // 17. Agrupamento de Cargos por ID e Isolamento de Cargos Homônimos (Reauditoria P1)
  // ---------------------------------------------------------------------------
  describe('17. Agrupamento Estrito de Cargos por ID e Isolamento de Homônimos (Reauditoria P1)', () => {
    it('17.1 Dois cargos com o mesmo nome, códigos distintos e candidatos repetidos devem ser 100% isolados', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição com Cargos de Mesmo Nome',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      // Dois cargos distintos compartilhando EXATAMENTE o mesmo nome 'Conselheiro'
      const cargoA = await prisma.office.create({
        data: { electionId: el.id, code: '91', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 1 }
      });
      const cargoB = await prisma.office.create({
        data: { electionId: el.id, code: '92', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 2 }
      });

      // Ambos os cargos possuem candidato com o MESMO número '10'
      const candA = await prisma.candidate.create({
        data: { officeId: cargoA.id, partyId: party13.id, candidateNumber: '10', name: 'Alfa A', ballotName: 'ALFA A' }
      });
      const candB = await prisma.candidate.create({
        data: { officeId: cargoB.id, partyId: party22.id, candidateNumber: '10', name: 'Alfa B', ballotName: 'ALFA B' }
      });

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'ZHOM1_S17', expectedBUs: 10 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: 'SHOM1_S17', expectedBUs: 10 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: 10 }
      });

      // 1 BU com votos distintos para cada cargo: 15 votos no cargo A, 40 votos no cargo B
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-HOMONIMO-TEST',
          electionId: el.id,
          roundId: rId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: 'ZHOM1_S17',
          sectionCode: 'SHOM1_S17',
          urnCode: 'UHOM1',
          votes: {
            create: [
              { officeId: cargoA.id, voteType: 'NOMINAL', candidateNumber: '10', quantity: 15 },
              { officeId: cargoB.id, voteType: 'NOMINAL', candidateNumber: '10', quantity: 40 }
            ]
          }
        }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      // 1. Totais contém 2 itens distintos com seus respectivos officeIds
      expect(json.totals.length).toBe(2);
      const itemA = json.totals.find((t: any) => t.officeId === cargoA.id);
      const itemB = json.totals.find((t: any) => t.officeId === cargoB.id);

      expect(itemA).toBeDefined();
      expect(itemB).toBeDefined();
      expect(itemA.candidateNumber).toBe('10');
      expect(itemA.candidateName).toBe('ALFA A');
      expect(itemA.quantity).toBe(15);

      expect(itemB.candidateNumber).toBe('10');
      expect(itemB.candidateName).toBe('ALFA B');
      expect(itemB.quantity).toBe(40);

      // 2. getOfficeDataAggregate filtra estritamente por officeId
      const aggA = getOfficeDataAggregate(json.election.plei, 1, cargoA.id, json.totals, cargoA.name);
      expect(aggA.candidates.length).toBe(1);
      expect(aggA.candidates[0].candidateNumber).toBe('10');
      expect(aggA.candidates[0].candidateName).toBe('ALFA A');
      expect(aggA.candidates[0].quantity).toBe(15);
      expect(aggA.totalValidos).toBe(15);

      const aggB = getOfficeDataAggregate(json.election.plei, 1, cargoB.id, json.totals, cargoB.name);
      expect(aggB.candidates.length).toBe(1);
      expect(aggB.candidates[0].candidateNumber).toBe('10');
      expect(aggB.candidates[0].candidateName).toBe('ALFA B');
      expect(aggB.candidates[0].quantity).toBe(40);
      expect(aggB.totalValidos).toBe(40);

      // 3. Projeções indexadas por officeId com cálculos isolados
      const projA = json.projections[cargoA.id];
      const projB = json.projections[cargoB.id];

      expect(projA).toBeDefined();
      expect(projB).toBeDefined();
      expect(projA.officeId).toBe(cargoA.id);
      expect(projB.officeId).toBe(cargoB.id);

      // 15 votos * 10 / 1 = 150
      expect(projA.candidates[0].projectedVotes).toBe(150);
      // 40 votos * 10 / 1 = 400
      expect(projB.candidates[0].projectedVotes).toBe(400);

      // Não cria alias por nome quando houver cargos homônimos
      expect(json.projections['Conselheiro']).toBeUndefined();

      // Nenhuma mutação executada na rota GET
      const totalCandidatesInDb = await prisma.candidate.count({ where: { officeId: { in: [cargoA.id, cargoB.id] } } });
      expect(totalCandidatesInDb).toBe(2);
    });

    it('17.2 Chamada por ID de B quando só existem totais de A: B deve retornar agregação vazia sem recorrer ao nome', () => {
      // Mock de totais contendo apenas votos do Cargo A ('id-cargo-a')
      const mockTotalsA: TotalItem[] = [
        {
          officeId: 'id-cargo-a',
          officeName: 'Conselheiro',
          candidateNumber: '10',
          partyNumber: '13',
          voteType: 'NOMINAL',
          quantity: 25,
          candidateName: 'Candidato Alfa A',
          partyAbbreviation: 'PT'
        },
        {
          officeId: 'id-cargo-a',
          officeName: 'Conselheiro',
          voteType: 'BRANCO',
          quantity: 3
        },
        {
          officeId: 'id-cargo-a',
          officeName: 'Conselheiro',
          voteType: 'NULO',
          quantity: 2
        }
      ];

      // Chamada fornecendo explicitamente officeId de B e nome de B
      const aggB = getOfficeDataAggregate('3220', 1, 'id-cargo-b', mockTotalsA, 'Conselheiro');

      // Deve retornar agregação 100% vazia - FAIL-CLOSED (sem fallback para votos de A)
      expect(aggB.candidates).toEqual([]);
      expect(aggB.legendas).toEqual([]);
      expect(aggB.totalValidos).toBe(0);
      expect(aggB.validosNominais).toBe(0);
      expect(aggB.validosLegenda).toBe(0);
      expect(aggB.brancos).toBe(0);
      expect(aggB.nulos).toBe(0);
      expect(aggB.totalGeral).toBe(0);

      // Chamada fornecendo officeId de B sem o 5º argumento
      const aggBSemFallback = getOfficeDataAggregate('3220', 1, 'id-cargo-b', mockTotalsA);
      expect(aggBSemFallback.candidates).toEqual([]);
      expect(aggBSemFallback.totalValidos).toBe(0);
      expect(aggBSemFallback.totalGeral).toBe(0);
    });

    it('17.3 Chamada por ID de B quando A e B possuem votos: cada agregação deve conter apenas seus próprios votos', () => {
      const mockTotalsAB: TotalItem[] = [
        {
          officeId: 'id-cargo-a',
          officeName: 'Conselheiro',
          candidateNumber: '10',
          partyNumber: '13',
          voteType: 'NOMINAL',
          quantity: 30,
          candidateName: 'Candidato Alfa A',
          partyAbbreviation: 'PT'
        },
        {
          officeId: 'id-cargo-a',
          officeName: 'Conselheiro',
          voteType: 'BRANCO',
          quantity: 5
        },
        {
          officeId: 'id-cargo-b',
          officeName: 'Conselheiro',
          candidateNumber: '10',
          partyNumber: '22',
          voteType: 'NOMINAL',
          quantity: 70,
          candidateName: 'Candidato Alfa B',
          partyAbbreviation: 'PL'
        },
        {
          officeId: 'id-cargo-b',
          officeName: 'Conselheiro',
          voteType: 'NULO',
          quantity: 8
        }
      ];

      const aggA = getOfficeDataAggregate('3220', 1, 'id-cargo-a', mockTotalsAB, 'Conselheiro');
      const aggB = getOfficeDataAggregate('3220', 1, 'id-cargo-b', mockTotalsAB, 'Conselheiro');

      // Cargo A: apenas seus 30 nominais e 5 brancos
      expect(aggA.totalValidos).toBe(30);
      expect(aggA.validosNominais).toBe(30);
      expect(aggA.brancos).toBe(5);
      expect(aggA.nulos).toBe(0);
      expect(aggA.totalGeral).toBe(35);
      expect(aggA.candidates.length).toBe(1);
      expect(aggA.candidates[0].candidateName).toBe('Candidato Alfa A');
      expect(aggA.candidates[0].quantity).toBe(30);

      // Cargo B: apenas seus 70 nominais e 8 nulos
      expect(aggB.totalValidos).toBe(70);
      expect(aggB.validosNominais).toBe(70);
      expect(aggB.brancos).toBe(0);
      expect(aggB.nulos).toBe(8);
      expect(aggB.totalGeral).toBe(78);
      expect(aggB.candidates.length).toBe(1);
      expect(aggB.candidates[0].candidateName).toBe('Candidato Alfa B');
      expect(aggB.candidates[0].quantity).toBe(70);
    });

    it('17.4 Chamada legada por nome com correspondência inequívoca: retorna agregação correta', () => {
      // Mock onde apenas 1 cargo se chama 'Prefeito'
      const mockTotalsPrefeito: TotalItem[] = [
        {
          officeId: 'id-prefeito',
          officeName: 'Prefeito',
          candidateNumber: '15',
          partyNumber: '15',
          voteType: 'NOMINAL',
          quantity: 120,
          candidateName: 'Candidato Prefeito 15',
          partyAbbreviation: 'MDB'
        },
        {
          officeId: 'id-prefeito',
          officeName: 'Prefeito',
          voteType: 'BRANCO',
          quantity: 10
        }
      ];

      // Chamada legada usando officeIdentifier = 'Prefeito' sem 5º argumento
      const aggNome = getOfficeDataAggregate(null, 1, 'Prefeito', mockTotalsPrefeito);
      expect(aggNome.totalValidos).toBe(120);
      expect(aggNome.brancos).toBe(10);
      expect(aggNome.totalGeral).toBe(130);
      expect(aggNome.candidates.length).toBe(1);
      expect(aggNome.candidates[0].candidateNumber).toBe('15');

      // Chamada legada fornecendo officeIdentifier nulo/vazio e officeNameFallback = 'Prefeito'
      const aggLegadoNull = getOfficeDataAggregate(null, 1, null, mockTotalsPrefeito, 'Prefeito');
      expect(aggLegadoNull.totalValidos).toBe(120);
      expect(aggLegadoNull.brancos).toBe(10);
    });

    it('17.5 Chamada legada por nome com dois cargos homônimos: deve recusar a agregação ambígua', () => {
      // Dois cargos homônimos distintos ('Conselheiro') com totais em allTotals
      const mockTotalsHomonym: TotalItem[] = [
        {
          officeId: 'id-cargo-a',
          officeName: 'Conselheiro',
          candidateNumber: '10',
          partyNumber: '13',
          voteType: 'NOMINAL',
          quantity: 30,
          candidateName: 'Candidato Alfa A',
          partyAbbreviation: 'PT'
        },
        {
          officeId: 'id-cargo-b',
          officeName: 'Conselheiro',
          candidateNumber: '10',
          partyNumber: '22',
          voteType: 'NOMINAL',
          quantity: 70,
          candidateName: 'Candidato Alfa B',
          partyAbbreviation: 'PL'
        }
      ];

      // Chamada legada passando apenas o nome 'Conselheiro'
      const aggAmbiguo = getOfficeDataAggregate(null, 1, 'Conselheiro', mockTotalsHomonym);
      expect(aggAmbiguo.totalValidos).toBe(0);
      expect(aggAmbiguo.totalGeral).toBe(0);
      expect(aggAmbiguo.candidates).toEqual([]);

      // Chamada legada passando officeIdentifier nulo e fallback 'Conselheiro'
      const aggAmbiguoNull = getOfficeDataAggregate(null, 1, null, mockTotalsHomonym, 'Conselheiro');
      expect(aggAmbiguoNull.totalValidos).toBe(0);
      expect(aggAmbiguoNull.totalGeral).toBe(0);
      expect(aggAmbiguoNull.candidates).toEqual([]);
    });

    it('17.6 Preservação do cenário em que ambos os cargos possuem candidatos com o mesmo número e múltiplos tipos de voto', () => {
      const mockTotalsComplex: TotalItem[] = [
        // Cargo A
        { officeId: 'id-cargo-a', officeName: 'Conselheiro', candidateNumber: '99', partyNumber: '10', voteType: 'NOMINAL', quantity: 50, candidateName: 'Cand 99 Cargo A' },
        { officeId: 'id-cargo-a', officeName: 'Conselheiro', partyNumber: '10', voteType: 'LEGENDA', quantity: 20, partyAbbreviation: 'PRB' },
        { officeId: 'id-cargo-a', officeName: 'Conselheiro', voteType: 'BRANCO', quantity: 5 },
        { officeId: 'id-cargo-a', officeName: 'Conselheiro', voteType: 'NULO', quantity: 3 },

        // Cargo B
        { officeId: 'id-cargo-b', officeName: 'Conselheiro', candidateNumber: '99', partyNumber: '20', voteType: 'NOMINAL', quantity: 80, candidateName: 'Cand 99 Cargo B' },
        { officeId: 'id-cargo-b', officeName: 'Conselheiro', partyNumber: '20', voteType: 'LEGENDA', quantity: 15, partyAbbreviation: 'PSC' },
        { officeId: 'id-cargo-b', officeName: 'Conselheiro', voteType: 'BRANCO', quantity: 12 },
        { officeId: 'id-cargo-b', officeName: 'Conselheiro', voteType: 'NULO', quantity: 9 }
      ];

      const aggA = getOfficeDataAggregate('3220', 1, 'id-cargo-a', mockTotalsComplex, 'Conselheiro');
      const aggB = getOfficeDataAggregate('3220', 1, 'id-cargo-b', mockTotalsComplex, 'Conselheiro');

      // Verificação Cargo A
      expect(aggA.validosNominais).toBe(50);
      expect(aggA.validosLegenda).toBe(20);
      expect(aggA.totalValidos).toBe(70);
      expect(aggA.brancos).toBe(5);
      expect(aggA.nulos).toBe(3);
      expect(aggA.totalGeral).toBe(78);
      expect(aggA.candidates.length).toBe(1);
      expect(aggA.candidates[0].candidateNumber).toBe('99');
      expect(aggA.candidates[0].candidateName).toBe('Cand 99 Cargo A');
      expect(aggA.candidates[0].quantity).toBe(50);
      expect(aggA.legendas.length).toBe(1);
      expect(aggA.legendas[0].partyNumber).toBe('10');
      expect(aggA.legendas[0].quantity).toBe(20);

      // Verificação Cargo B
      expect(aggB.validosNominais).toBe(80);
      expect(aggB.validosLegenda).toBe(15);
      expect(aggB.totalValidos).toBe(95);
      expect(aggB.brancos).toBe(12);
      expect(aggB.nulos).toBe(9);
      expect(aggB.totalGeral).toBe(116);
      expect(aggB.candidates.length).toBe(1);
      expect(aggB.candidates[0].candidateNumber).toBe('99');
      expect(aggB.candidates[0].candidateName).toBe('Cand 99 Cargo B');
      expect(aggB.candidates[0].quantity).toBe(80);
      expect(aggB.legendas.length).toBe(1);
      expect(aggB.legendas[0].partyNumber).toBe('20');
      expect(aggB.legendas[0].quantity).toBe(15);
    });

    it('17.7 A API cria alias por nome em projections APENAS para cargos com nome único, recusando alias para homônimos', async () => {
      const el = await prisma.election.create({
        data: {
          name: 'Eleição com Cargo Único e Homônimos',
          year: 2026,
          type: 'MUNICIPAL',
          status: 'ACTIVE',
          rounds: {
            create: { roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
          }
        },
        include: { rounds: true }
      });
      const rId = el.rounds[0].id;

      // Cargo único
      const cargoPrefeito = await prisma.office.create({
        data: { electionId: el.id, code: '11', name: 'Prefeito', type: 'MAJORITARIO', orderNumber: 1 }
      });

      // Dois cargos homônimos
      const cargoCons1 = await prisma.office.create({
        data: { electionId: el.id, code: '81', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 2 }
      });
      const cargoCons2 = await prisma.office.create({
        data: { electionId: el.id, code: '82', name: 'Conselheiro', type: 'MAJORITARIO', orderNumber: 3 }
      });

      await prisma.candidate.create({
        data: { officeId: cargoPrefeito.id, partyId: party13.id, candidateNumber: '15', name: 'Prefeito Alfa', ballotName: 'PREFEITO ALFA' }
      });
      await prisma.candidate.create({
        data: { officeId: cargoCons1.id, partyId: party13.id, candidateNumber: '10', name: 'Conselheiro 1', ballotName: 'CONSELHEIRO 1' }
      });
      await prisma.candidate.create({
        data: { officeId: cargoCons2.id, partyId: party22.id, candidateNumber: '20', name: 'Conselheiro 2', ballotName: 'CONSELHEIRO 2' }
      });

      const zone = await prisma.pollingZone.create({
        data: { municipalityId: muniConcordia.id, zoneNumber: 'ZHOM_ALIAS_S17', expectedBUs: 10 }
      });
      const sec = await prisma.pollingSection.create({
        data: { pollingZoneId: zone.id, sectionNumber: 'SHOM_ALIAS_S17', expectedBUs: 10 }
      });
      await prisma.roundCoverage.create({
        data: { electionRoundId: rId, pollingSectionId: sec.id, expectedBUs: 10 }
      });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'BU-ALIAS-TEST',
          electionId: el.id,
          roundId: rId,
          status: 'PROCESSADO',
          isSimulation: false,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: 'ZHOM_ALIAS_S17',
          sectionCode: 'SHOM_ALIAS_S17',
          urnCode: 'UALIAS1',
          votes: {
            create: [
              { officeId: cargoPrefeito.id, voteType: 'NOMINAL', candidateNumber: '15', quantity: 50 },
              { officeId: cargoCons1.id, voteType: 'NOMINAL', candidateNumber: '10', quantity: 30 },
              { officeId: cargoCons2.id, voteType: 'NOMINAL', candidateNumber: '20', quantity: 70 }
            ]
          }
        }
      });

      const res = await totalsRoute(new Request(`http://localhost/api/totals?election=${el.id}&round=1`));
      expect(res.status).toBe(200);
      const json = await res.json();

      // Canônico por ID sempre presente
      expect(json.projections[cargoPrefeito.id]).toBeDefined();
      expect(json.projections[cargoCons1.id]).toBeDefined();
      expect(json.projections[cargoCons2.id]).toBeDefined();

      // Nome único: cria alias por compatibilidade legada
      expect(json.projections['Prefeito']).toBeDefined();
      expect(json.projections['Prefeito'].officeId).toBe(cargoPrefeito.id);
      expect(json.projections['Prefeito'].candidates[0].projectedVotes).toBe(500);

      // Homônimos: JAMAIS cria alias por nome!
      expect(json.projections['Conselheiro']).toBeUndefined();
    });
  });
});
