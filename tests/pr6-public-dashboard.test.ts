import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';
import { GET as totalsRoute } from '../src/app/api/totals/route';
import { getOfficeDataAggregate, classifyVotePresentation } from '../src/lib/presentation/apuracaoHelper';

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
});
