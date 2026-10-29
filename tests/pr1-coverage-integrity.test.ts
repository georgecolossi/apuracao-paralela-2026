import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import * as auth from '@/lib/auth';
import { POST as coberturaRoute } from '@/app/api/admin/cobertura/route';

describe('PR 1 — Integridade da Cobertura Multi-Eleição e RoundCoverage (13 Cenários Obrigatórios)', () => {
  const runId = Date.now().toString();
  let adminUserId: string;

  let stateSC: any;
  let stateSP: any;
  let muniConcordia: any;
  let muniErval: any;
  let muniChapeco: any;
  let muniSaoPaulo: any;
  let secConcordia1: any;
  let secConcordia2: any;
  let secErval1: any;
  let secChapeco1: any;

  beforeAll(async () => {
    // 1. Cria usuário ADMIN real para auditoria
    const admin = await prisma.user.create({
      data: {
        name: 'Admin Cobertura Universal',
        email: `admin-cov-universal-${runId}@example.com`,
        passwordHash: 'hash-test',
        role: 'ADMIN'
      }
    });
    adminUserId = admin.id;

    // 2. Cria Estados e Municípios
    stateSC = await prisma.state.upsert({
      where: { abbreviation: 'SC' },
      update: {},
      create: { name: 'Santa Catarina', abbreviation: 'SC' }
    });

    stateSP = await prisma.state.upsert({
      where: { abbreviation: 'SP' },
      update: {},
      create: { name: 'São Paulo', abbreviation: 'SP' }
    });

    muniConcordia = await prisma.municipality.upsert({
      where: { officialCode: '80837' },
      update: {},
      create: { name: 'Concórdia', officialCode: '80837', stateId: stateSC.id, isCoverage: true }
    });

    muniErval = await prisma.municipality.upsert({
      where: { officialCode: '81051' },
      update: {},
      create: { name: 'Erval Velho', officialCode: '81051', stateId: stateSC.id, isCoverage: false }
    });

    muniChapeco = await prisma.municipality.upsert({
      where: { officialCode: '80977' },
      update: {},
      create: { name: 'Chapecó', officialCode: '80977', stateId: stateSC.id, isCoverage: false }
    });

    muniSaoPaulo = await prisma.municipality.upsert({
      where: { officialCode: '71072' },
      update: {},
      create: { name: 'São Paulo', officialCode: '71072', stateId: stateSP.id, isCoverage: false }
    });

    // 3. Cria Zonas e Seções Eleitorais para testes de RoundCoverage
    const zoneConcordia = await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniConcordia.id, zoneNumber: '0090' } },
      update: {},
      create: { municipalityId: muniConcordia.id, zoneNumber: '0090', expectedBUs: 2 }
    });

    secConcordia1 = await prisma.pollingSection.upsert({
      where: { pollingZoneId_sectionNumber: { pollingZoneId: zoneConcordia.id, sectionNumber: '0010' } },
      update: {},
      create: { pollingZoneId: zoneConcordia.id, sectionNumber: '0010', expectedBUs: 1 }
    });

    secConcordia2 = await prisma.pollingSection.upsert({
      where: { pollingZoneId_sectionNumber: { pollingZoneId: zoneConcordia.id, sectionNumber: '0020' } },
      update: {},
      create: { pollingZoneId: zoneConcordia.id, sectionNumber: '0020', expectedBUs: 1 }
    });

    const zoneErval = await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniErval.id, zoneNumber: '0018' } },
      update: {},
      create: { municipalityId: muniErval.id, zoneNumber: '0018', expectedBUs: 1 }
    });

    secErval1 = await prisma.pollingSection.upsert({
      where: { pollingZoneId_sectionNumber: { pollingZoneId: zoneErval.id, sectionNumber: '0005' } },
      update: {},
      create: { pollingZoneId: zoneErval.id, sectionNumber: '0005', expectedBUs: 1 }
    });

    const zoneChapeco = await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniChapeco.id, zoneNumber: '0035' } },
      update: {},
      create: { municipalityId: muniChapeco.id, zoneNumber: '0035', expectedBUs: 1 }
    });

    secChapeco1 = await prisma.pollingSection.upsert({
      where: { pollingZoneId_sectionNumber: { pollingZoneId: zoneChapeco.id, sectionNumber: '0001' } },
      update: {},
      create: { pollingZoneId: zoneChapeco.id, sectionNumber: '0001', expectedBUs: 1 }
    });

    // Mock autenticação ADMIN padrão
    vi.spyOn(auth, 'requireAuthenticatedUser').mockResolvedValue({
      authenticated: true,
      user: { userId: adminUserId, role: 'ADMIN' }
    } as any);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Adicionar município e verificar ElectionScope e RoundCoverage
  // -------------------------------------------------------------------------
  it('1. Adicionar município e verificar ElectionScope e RoundCoverage reais', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t1-${runId}`, name: 'Eleição Teste 1', year: 2026, status: 'CONFIGURING' }
    });
    const round = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    const req = new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({
        electionId: elec.id,
        roundId: round.id,
        coverageCodes: ['80837'] // Concórdia (possui 2 seções cadastradas)
      })
    });

    const concordiaSectionsCount = await prisma.pollingSection.count({
      where: { zone: { municipality: { officialCode: '80837' } } }
    });

    const res = await coberturaRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.sectionsAdded).toBe(concordiaSectionsCount);
    expect(json.totalSections).toBe(concordiaSectionsCount);
    expect(json.coverageStatus).toBe('REGISTERED');

    // Verifica ElectionScope no banco
    const scopes = await prisma.electionScope.findMany({ where: { electionId: elec.id } });
    expect(scopes).toHaveLength(1);
    expect(scopes[0].scopeKey).toBe('MUNICIPAL:SC:80837');
    expect(scopes[0].isCoverageArea).toBe(true);

    // Verifica RoundCoverage no banco
    const coverages = await prisma.roundCoverage.findMany({ where: { electionRoundId: round.id } });
    expect(coverages).toHaveLength(concordiaSectionsCount);

    // Verifica status da rodada atualizado para REGISTERED
    const updatedRound = await prisma.electionRound.findUnique({ where: { id: round.id } });
    expect(updatedRound?.coverageStatus).toBe('REGISTERED');
  });

  // -------------------------------------------------------------------------
  // 2. Remover município e verificar exclusão apenas das seções correspondentes
  // -------------------------------------------------------------------------
  it('2. Remover município e verificar exclusão apenas das seções correspondentes', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t2-${runId}`, name: 'Eleição Teste 2', year: 2026, status: 'CONFIGURING' }
    });
    const round = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Inicialmente com Concórdia (2 seções) e Erval Velho (1 seção)
    const req1 = new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({
        electionId: elec.id,
        roundId: round.id,
        coverageCodes: ['80837', '81051']
      })
    });
    const res1 = await coberturaRoute(req1);
    expect(res1.status).toBe(200);

    const concordiaSectionsCount = await prisma.pollingSection.count({
      where: { zone: { municipality: { officialCode: '80837' } } }
    });
    const ervalSectionsCount = await prisma.pollingSection.count({
      where: { zone: { municipality: { officialCode: '81051' } } }
    });

    const initialCoverages = await prisma.roundCoverage.findMany({ where: { electionRoundId: round.id } });
    expect(initialCoverages).toHaveLength(concordiaSectionsCount + ervalSectionsCount);

    // Agora remove Erval Velho (mantém apenas Concórdia)
    const req2 = new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({
        electionId: elec.id,
        roundId: round.id,
        coverageCodes: ['80837']
      })
    });
    const res2 = await coberturaRoute(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.sectionsRemoved).toBe(ervalSectionsCount);
    expect(json2.totalSections).toBe(concordiaSectionsCount);

    // Verifica que exclusivamente a seção de Erval Velho foi excluída do RoundCoverage
    const remainingCoverages = await prisma.roundCoverage.findMany({ where: { electionRoundId: round.id } });
    expect(remainingCoverages).toHaveLength(concordiaSectionsCount);

    // Verifica que Erval Velho foi removido do ElectionScope
    const remainingScopes = await prisma.electionScope.findMany({ where: { electionId: elec.id } });
    expect(remainingScopes).toHaveLength(1);
    expect(remainingScopes[0].scopeKey).toBe('MUNICIPAL:SC:80837');
  });

  // -------------------------------------------------------------------------
  // 3. Alterar eleição A sem afetar eleição B
  // -------------------------------------------------------------------------
  it('3. Alterar eleição A sem afetar eleição B', async () => {
    const elecA = await prisma.election.create({
      data: { slug: `elec-iso-a-${runId}`, name: 'Eleição A', year: 2026, status: 'CONFIGURING' }
    });
    const roundA = await prisma.electionRound.create({
      data: { electionId: elecA.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    const elecB = await prisma.election.create({
      data: { slug: `elec-iso-b-${runId}`, name: 'Eleição B', year: 2026, status: 'CONFIGURING' }
    });
    const roundB = await prisma.electionRound.create({
      data: { electionId: elecB.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Eleição B cobre Erval Velho (81051)
    await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elecB.id, roundId: roundB.id, coverageCodes: ['81051'] })
    }));

    // Eleição A inicialmente cobre Concórdia (80837)
    await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elecA.id, roundId: roundA.id, coverageCodes: ['80837'] })
    }));

    // Altera Eleição A para Chapecó (80977)
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elecA.id, roundId: roundA.id, coverageCodes: ['80977'] })
    }));
    expect(res.status).toBe(200);

    // Verifica Eleição A: Chapecó
    const scopesA = await prisma.electionScope.findMany({ where: { electionId: elecA.id } });
    expect(scopesA).toHaveLength(1);
    expect(scopesA[0].scopeKey).toBe('MUNICIPAL:SC:80977');

    const covsA = await prisma.roundCoverage.findMany({ where: { electionRoundId: roundA.id } });
    expect(covsA).toHaveLength(1);
    expect(covsA[0].pollingSectionId).toBe(secChapeco1.id);

    // Verifica Eleição B: PERMANECE INTACTA com Erval Velho
    const scopesB = await prisma.electionScope.findMany({ where: { electionId: elecB.id } });
    expect(scopesB).toHaveLength(1);
    expect(scopesB[0].scopeKey).toBe('MUNICIPAL:SC:81051');

    const covsB = await prisma.roundCoverage.findMany({ where: { electionRoundId: roundB.id } });
    expect(covsB).toHaveLength(1);
    expect(covsB[0].pollingSectionId).toBe(secErval1.id);
  });

  // -------------------------------------------------------------------------
  // 4. Alterar turno 1 sem afetar turno 2
  // -------------------------------------------------------------------------
  it('4. Alterar turno 1 sem afetar turno 2', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-rounds-${runId}`, name: 'Eleição Multi-Turnos', year: 2026, status: 'CONFIGURING' }
    });
    const round1 = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });
    const round2 = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 2, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Configura Turno 1 com Concórdia (2 seções)
    await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round1.id, coverageCodes: ['80837'] })
    }));

    // Configura Turno 2 com Erval Velho (1 seção)
    await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round2.id, coverageCodes: ['81051'] })
    }));

    // Altera Turno 1 para Chapecó (80977)
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round1.id, coverageCodes: ['80977'] })
    }));
    expect(res.status).toBe(200);

    // Turno 1 agora possui seções de Chapecó
    const covs1 = await prisma.roundCoverage.findMany({ where: { electionRoundId: round1.id } });
    expect(covs1).toHaveLength(1);
    expect(covs1[0].pollingSectionId).toBe(secChapeco1.id);

    // Turno 2 PERMANECE INTACTO com seções de Erval Velho
    const covs2 = await prisma.roundCoverage.findMany({ where: { electionRoundId: round2.id } });
    expect(covs2).toHaveLength(1);
    expect(covs2[0].pollingSectionId).toBe(secErval1.id);
  });

  // -------------------------------------------------------------------------
  // 5. Rejeitar turno inexistente
  // -------------------------------------------------------------------------
  it('5. Rejeitar turno inexistente (404 TURNO_NAO_ENCONTRADO)', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t5-${runId}`, name: 'Eleição Teste 5', year: 2026, status: 'CONFIGURING' }
    });

    // Teste com roundId inexistente
    const res1 = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: 'non-existent-uuid', coverageCodes: ['80837'] })
    }));
    expect(res1.status).toBe(404);
    const json1 = await res1.json();
    expect(json1.error).toBe('TURNO_NAO_ENCONTRADO');

    // Teste com roundNumber inexistente
    const res2 = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundNumber: 99, coverageCodes: ['80837'] })
    }));
    expect(res2.status).toBe(404);
    const json2 = await res2.json();
    expect(json2.error).toBe('TURNO_NAO_ENCONTRADO');
  });

  // -------------------------------------------------------------------------
  // 6. Rejeitar turno pertencente a outra eleição
  // -------------------------------------------------------------------------
  it('6. Rejeitar turno pertencente a outra eleição (400 TURNO_OUTRA_ELEICAO)', async () => {
    const elecA = await prisma.election.create({
      data: { slug: `elec-t6a-${runId}`, name: 'Eleição 6A', year: 2026, status: 'CONFIGURING' }
    });
    const roundA = await prisma.electionRound.create({
      data: { electionId: elecA.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    const elecB = await prisma.election.create({
      data: { slug: `elec-t6b-${runId}`, name: 'Eleição 6B', year: 2026, status: 'CONFIGURING' }
    });
    const roundB = await prisma.electionRound.create({
      data: { electionId: elecB.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Submete com electionId de A, mas roundId de B
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elecA.id, roundId: roundB.id, coverageCodes: ['80837'] })
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('TURNO_OUTRA_ELEICAO');
  });

  // -------------------------------------------------------------------------
  // 7. Rejeitar identificadores de turno contraditórios
  // -------------------------------------------------------------------------
  it('7. Rejeitar identificadores de turno contraditórios (400 TURNO_DIVERGENTE)', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t7-${runId}`, name: 'Eleição Teste 7', year: 2026, status: 'CONFIGURING' }
    });
    const round1 = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Submete roundId do Turno 1, mas informando roundNumber = 2
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({
        electionId: elec.id,
        roundId: round1.id,
        roundNumber: 2, // Conflito direto com round1.roundNumber === 1
        coverageCodes: ['80837']
      })
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('TURNO_DIVERGENTE');
  });

  // -------------------------------------------------------------------------
  // 8. Rejeitar escopos geográficos sobrepostos
  // -------------------------------------------------------------------------
  it('8. Rejeitar escopos geográficos sobrepostos (400 OVERLAPPING_SCOPE)', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t8-${runId}`, name: 'Eleição Teste 8', year: 2026, status: 'CONFIGURING' }
    });
    const round = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Pré-cadastra abrangência ESTADUAL integral em SC
    await prisma.electionScope.create({
      data: {
        electionId: elec.id,
        scopeType: 'ESTADUAL',
        scopeKey: 'ESTADUAL:SC',
        stateId: stateSC.id,
        isCoverageArea: true
      }
    });

    // Tenta adicionar Concórdia/SC (MUNICIPAL no mesmo estado que já possui escopo ESTADUAL)
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({
        electionId: elec.id,
        roundId: round.id,
        coverageCodes: ['80837']
      })
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('OVERLAPPING_SCOPE_STATE_CONTAINS_MUNICIPALITY');
  });

  // -------------------------------------------------------------------------
  // 9. Bloquear alteração de cobertura homologada
  // -------------------------------------------------------------------------
  it('9. Bloquear alteração de cobertura homologada (403 COVERAGE_HOMOLOGATED)', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t9-${runId}`, name: 'Eleição Teste 9', year: 2026, status: 'ACTIVE' }
    });
    const roundHomo = await prisma.electionRound.create({
      data: {
        electionId: elec.id,
        roundNumber: 1,
        status: 'ACTIVE',
        coverageStatus: 'HOMOLOGATED',
        coverageHomologatedAt: new Date(),
        coverageHomologatedBy: 'admin-auditor@justica.gov.br'
      }
    });

    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: roundHomo.id, coverageCodes: ['80837'] })
    }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code || json.error).toMatch(/COVERAGE_HOMOLOGATED/);
  });

  // -------------------------------------------------------------------------
  // 10. Bloquear remoção que comprometa BUs reais
  // -------------------------------------------------------------------------
  it('10. Bloquear remoção que comprometa BUs reais (409 CONFLITO_DADOS_REAIS)', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t10-${runId}`, name: 'Eleição Teste 10', year: 2026, status: 'ACTIVE' }
    });
    const round = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'ACTIVE', coverageStatus: 'REGISTERED' }
    });

    // Configura cobertura inicial em Concórdia
    await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round.id, coverageCodes: ['80837'] })
    }));

    // Cria um BU real processado em Concórdia (80837)
    await prisma.ballotReport.create({
      data: {
        deterministicId: `DET-BU-REAL-T10-${runId}`,
        electionId: elec.id,
        roundId: round.id,
        stateCode: 'SC',
        cityCode: '80837',
        zoneCode: '0090',
        sectionCode: '0010',
        urnCode: '11223344',
        status: 'PROCESSADO',
        isSimulation: false
      }
    });

    // Tenta remover Concórdia (substituindo cobertura apenas por Chapecó)
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round.id, coverageCodes: ['80977'] })
    }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('CONFLITO_DADOS_REAIS');
  });

  // -------------------------------------------------------------------------
  // 11. Verificar rollback completo quando qualquer etapa falhar
  // -------------------------------------------------------------------------
  it('11. Verificar rollback completo quando qualquer etapa falhar', async () => {
    const elec = await prisma.election.create({
      data: { slug: `elec-t11-${runId}`, name: 'Eleição Teste 11', year: 2026, status: 'CONFIGURING' }
    });
    const round = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Cobertura inicial legítima com Concórdia
    await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round.id, coverageCodes: ['80837'] })
    }));

    const concordiaSectionsCount = await prisma.pollingSection.count({
      where: { zone: { municipality: { officialCode: '80837' } } }
    });

    const initialScopes = await prisma.electionScope.findMany({ where: { electionId: elec.id } });
    const initialCoverages = await prisma.roundCoverage.findMany({ where: { electionRoundId: round.id } });
    expect(initialScopes).toHaveLength(1);
    expect(initialCoverages).toHaveLength(concordiaSectionsCount);

    // Pré-cadastra escopo ESTADUAL para forçar falha no meio da transação durante validação de escopos
    await prisma.electionScope.create({
      data: {
        electionId: elec.id,
        scopeType: 'ESTADUAL',
        scopeKey: 'ESTADUAL:SP',
        stateId: stateSP.id,
        isCoverageArea: true
      }
    });

    // Tenta adicionar São Paulo (cujo estado já possui escopo ESTADUAL:SP, violando sobreposição)
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round.id, coverageCodes: ['80837', '71072'] })
    }));
    expect(res.status).toBe(400);

    // Verifica que NENHUMA alteração foi persistida em RoundCoverage (rollback total)
    const afterCoverages = await prisma.roundCoverage.findMany({ where: { electionRoundId: round.id } });
    expect(afterCoverages).toHaveLength(concordiaSectionsCount);
    expect(afterCoverages.map(c => c.pollingSectionId).sort()).toEqual(initialCoverages.map(c => c.pollingSectionId).sort());
  });

  // -------------------------------------------------------------------------
  // 12. Verificar ausência de mutação global indevida
  // -------------------------------------------------------------------------
  it('12. Verificar ausência de mutação global indevida em Municipality.isCoverage', async () => {
    // Força um estado prévio conhecido em Municipality.isCoverage
    await prisma.municipality.update({ where: { officialCode: '80837' }, data: { isCoverage: true } });
    await prisma.municipality.update({ where: { officialCode: '81051' }, data: { isCoverage: false } });

    const elec = await prisma.election.create({
      data: { slug: `elec-t12-${runId}`, name: 'Eleição Teste 12', year: 2026, status: 'CONFIGURING' }
    });
    const round = await prisma.electionRound.create({
      data: { electionId: elec.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    // Altera cobertura da Eleição 12 para Erval Velho (81051)
    const res = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elec.id, roundId: round.id, coverageCodes: ['81051'] })
    }));
    expect(res.status).toBe(200);

    // O endpoint multi-eleição NÃO deve ter limpado nem alterado globalmente os valores em Municipality.isCoverage!
    const muniConcordiaCheck = await prisma.municipality.findUnique({ where: { officialCode: '80837' } });
    const muniErvalCheck = await prisma.municipality.findUnique({ where: { officialCode: '81051' } });

    // Concórdia preserva seu isCoverage e Erval Velho também não teve mutação global espúria
    expect(muniConcordiaCheck?.isCoverage).toBe(true);
    expect(muniErvalCheck?.isCoverage).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 13. Verificar que operação sem contexto válido não retorna sucesso falso
  // -------------------------------------------------------------------------
  it('13. Verificar que uma operação sem contexto válido não retorna sucesso falso', async () => {
    // A) Eleição inexistente -> 404
    const resElec404 = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: 'fake-elec-id', coverageCodes: ['80837'] })
    }));
    expect(resElec404.status).toBe(404);
    expect((await resElec404.json()).error).toBe('ELEICAO_NAO_ENCONTRADA');

    // B) Eleição sem turnos cadastrados -> 400 SEM_TURNOS_CADASTRADOS
    const elecNoRounds = await prisma.election.create({
      data: { slug: `elec-norounds-${runId}`, name: 'Eleição Sem Turnos', year: 2026, status: 'CONFIGURING' }
    });
    const resNoRounds = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elecNoRounds.id, coverageCodes: ['80837'] })
    }));
    expect(resNoRounds.status).toBe(400);
    expect((await resNoRounds.json()).error).toBe('SEM_TURNOS_CADASTRADOS');

    // C) Eleição com múltiplos turnos planejados e sem especificação de turno -> 400 TURNO_OBRIGATORIO
    const elecMulti = await prisma.election.create({
      data: { slug: `elec-multi-${runId}`, name: 'Eleição Múltiplos Turnos', year: 2026, status: 'CONFIGURING' }
    });
    await prisma.electionRound.create({
      data: { electionId: elecMulti.id, roundNumber: 1, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });
    await prisma.electionRound.create({
      data: { electionId: elecMulti.id, roundNumber: 2, status: 'PLANNED', coverageStatus: 'PROVISIONAL' }
    });

    const resAmbigRound = await coberturaRoute(new Request('http://localhost/api/admin/cobertura', {
      method: 'POST',
      body: JSON.stringify({ electionId: elecMulti.id, coverageCodes: ['80837'] })
    }));
    expect(resAmbigRound.status).toBe(400);
    expect((await resAmbigRound.json()).error).toBe('TURNO_OBRIGATORIO');
  });
});
