import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { GET as getWizard, POST as saveWizard } from '@/app/api/admin/wizard/route';
import { POST as activateWizard } from '@/app/api/admin/wizard/activate/route';
import { POST as importTse } from '@/app/api/admin/wizard/import-tse/route';
import { generateCsrfToken } from '@/lib/security/csrf';

let activeTestSessionToken: string | undefined = undefined;

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === 'admin_session' && activeTestSessionToken) {
        return { name: 'admin_session', value: activeTestSessionToken };
      }
      return undefined;
    },
    set: vi.fn((name: string, value: string) => {
      if (name === 'admin_session') {
        activeTestSessionToken = value;
      }
    }),
    delete: vi.fn(() => {
      activeTestSessionToken = undefined;
    })
  }))
}));

describe('PR 3 — Assistente Universal de Configuração (Wizard)', () => {
  let adminUser: any;
  let operatorUser: any;
  let viewerUser: any;
  let adminCsrfToken: string;

  const createAuthHeaders = (csrf?: string) => ({
    'Content-Type': 'application/json',
    'Host': 'localhost:3000',
    'Origin': 'http://localhost:3000',
    ...(csrf ? { 'X-CSRF-Token': csrf } : {})
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-key-for-pr3-wizard-32chars-min!';
    expect(process.env.DATABASE_URL).toContain('test.db');
  });

  beforeEach(async () => {
    // Limpeza de tabelas na ordem de dependência referencial
    await prisma.ballotVote.deleteMany();
    await prisma.ballotReportPart.deleteMany();
    await prisma.ballotReport.deleteMany();
    await prisma.scanSession.deleteMany();
    await prisma.roundCoverage.deleteMany();
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

    // Criar usuários com papéis distintos
    const passHash = await bcrypt.hash('SenhaForte123!', 10);

    adminUser = await prisma.user.create({
      data: {
        name: 'Administrador Geral',
        email: 'admin.wizard@teste.gov.br',
        passwordHash: passHash,
        role: 'ADMIN',
        isActive: true,
        sessionVersion: 1
      }
    });

    operatorUser = await prisma.user.create({
      data: {
        name: 'Operador Scanner',
        email: 'operador.wizard@teste.gov.br',
        passwordHash: passHash,
        role: 'OPERATOR',
        isActive: true,
        sessionVersion: 1
      }
    });

    viewerUser = await prisma.user.create({
      data: {
        name: 'Auditor Visualizador',
        email: 'viewer.wizard@teste.gov.br',
        passwordHash: passHash,
        role: 'VIEWER',
        isActive: true,
        sessionVersion: 1
      }
    });

    // Token JWT do Admin
    const token = jwt.sign(
      {
        userId: adminUser.id,
        role: adminUser.role,
        email: adminUser.email,
        sessionVersion: adminUser.sessionVersion
      },
      process.env.JWT_SECRET!
    );
    activeTestSessionToken = token;

    adminCsrfToken = generateCsrfToken(adminUser.id, adminUser.sessionVersion);
  });

  describe('1. Instalação Limpa e Metadados do Wizard (GET /api/admin/wizard)', () => {
    it('1.1 Deve rejeitar acesso se não estiver autenticado (401)', async () => {
      activeTestSessionToken = undefined;
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'GET',
        headers: createAuthHeaders()
      });

      const res = await getWizard(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('1.2 Deve rejeitar acesso para papéis OPERATOR e VIEWER (403)', async () => {
      // Como OPERATOR
      activeTestSessionToken = jwt.sign(
        { userId: operatorUser.id, role: operatorUser.role, sessionVersion: operatorUser.sessionVersion },
        process.env.JWT_SECRET!
      );
      const reqOp = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'GET',
        headers: createAuthHeaders()
      });
      const resOp = await getWizard(reqOp);
      expect(resOp.status).toBe(403);
      expect((await resOp.json()).error).toBe('FORBIDDEN');

      // Como VIEWER
      activeTestSessionToken = jwt.sign(
        { userId: viewerUser.id, role: viewerUser.role, sessionVersion: viewerUser.sessionVersion },
        process.env.JWT_SECRET!
      );
      const reqVi = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'GET',
        headers: createAuthHeaders()
      });
      const resVi = await getWizard(reqVi);
      expect(resVi.status).toBe(403);
    });

    it('1.3 Deve carregar metadados com banco limpo para o ADMIN', async () => {
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'GET',
        headers: createAuthHeaders()
      });

      const res = await getWizard(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('drafts');
      expect(data).toHaveProperty('allElections');
      expect(data.drafts).toEqual([]);
      expect(data.allElections).toEqual([]);
      expect(data.election).toBeNull();
    });
  });

  describe('2. Salvamento de Eleição como Rascunho (POST /api/admin/wizard)', () => {
    it('2.1 Deve criar nova eleição em DRAFT com turnos, cargos e escopo municipal', async () => {
      const payload = {
        name: 'Eleição Municipal Piloto 2024',
        year: 2024,
        type: 'MUNICIPAL',
        description: 'Pleito de testes do assistente universal',
        status: 'DRAFT',
        scopes: [
          {
            scopeType: 'MUNICIPAL',
            stateAbbreviation: 'SC',
            municipalityOfficialCode: '80837',
            municipalityName: 'Concórdia'
          }
        ],
        rounds: [
          { roundNumber: 1, plei: '6257' },
          { roundNumber: 2, plei: '6258' }
        ],
        offices: [
          { code: '11', name: 'Prefeito', type: 'MAJORITARIO' },
          { code: '13', name: 'Vereador', type: 'PROPORCIONAL' }
        ],
        parties: [
          { officialIdentifier: '13', name: 'Partido A', abbreviation: 'PA' },
          { officialIdentifier: '22', name: 'Partido B', abbreviation: 'PB' }
        ],
        candidates: [
          {
            officeCode: '11',
            candidateNumber: '13',
            name: 'Candidato Um',
            ballotName: 'Um',
            partyNumber: '13'
          },
          {
            officeCode: '11',
            candidateNumber: '22',
            name: 'Candidato Dois',
            ballotName: 'Dois',
            partyNumber: '22'
          }
        ],
        coverage: [
          {
            municipalityOfficialCode: '80837',
            zoneNumber: '090',
            sectionNumber: '0001',
            expectedBUs: 1,
            isAggregated: false
          },
          {
            municipalityOfficialCode: '80837',
            zoneNumber: '090',
            sectionNumber: '0002',
            expectedBUs: 1,
            isAggregated: false
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);
      const resData = await res.json();
      expect(resData.success).toBe(true);
      expect(resData.electionId).toBeDefined();

      // Verificar persistência no banco
      const savedElection = await prisma.election.findUnique({
        where: { id: resData.electionId },
        include: {
          rounds: { orderBy: { roundNumber: 'asc' }, include: { coverage: true } },
          offices: { include: { candidates: true } },
          scopes: true
        }
      });

      expect(savedElection).toBeDefined();
      expect(savedElection?.status).toBe('DRAFT');
      expect(savedElection?.year).toBe(2024);
      expect(savedElection?.rounds.length).toBe(2);
      expect(savedElection?.offices.length).toBe(2);
      expect(savedElection?.scopes.length).toBe(1);

      // 2.2 e 2.3: REGRA OBRIGATÓRIA - Não homologar automaticamente cobertura apenas por cadastrá-la!
      for (const r of savedElection!.rounds) {
        expect(r.coverageStatus).toBe('REGISTERED'); // Cadastrada — validação pendente
        expect(r.coverageHomologatedAt).toBeNull();
        expect(r.coverage.length).toBe(2); // 2 seções cadastradas em RoundCoverage
      }
    });

    it('2.4 Deve permitir salvar rascunho sem cobertura de seções mantendo coverageStatus PROVISIONAL', async () => {
      const payload = {
        name: 'Consulta Popular 2025',
        year: 2025,
        type: 'CONSULTA',
        status: 'DRAFT',
        scopes: [
          {
            scopeType: 'ESTADUAL',
            stateAbbreviation: 'PR'
          }
        ],
        rounds: [
          { roundNumber: 1 }
        ],
        offices: [
          { code: '99', name: 'Pergunta 1', type: 'MAJORITARIO' }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);
      const resData = await res.json();

      const round = await prisma.electionRound.findFirst({
        where: { electionId: resData.electionId }
      });
      expect(round?.coverageStatus).toBe('PROVISIONAL');
    });
  });

  describe('3. Retomada e Atualização de Rascunho', () => {
    it('3.1 Deve permitir carregar e atualizar os dados de um rascunho existente', async () => {
      // 1. Criar rascunho inicial
      const createReq = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Rascunho Inicial',
          year: 2028,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SP', municipalityOfficialCode: '71072', municipalityName: 'São Paulo' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }]
        })
      });
      const createRes = await saveWizard(createReq);
      const { electionId } = await createRes.json();

      // 2. Consultar detalhes do rascunho via GET com electionId
      const getReq = new Request(`http://localhost:3000/api/admin/wizard?electionId=${electionId}`, {
        method: 'GET',
        headers: createAuthHeaders()
      });
      const getRes = await getWizard(getReq);
      const getData = await getRes.json();
      expect(getData.election.id).toBe(electionId);
      expect(getData.election.name).toBe('Eleição Rascunho Inicial');

      // 3. Atualizar o rascunho adicionando mais um cargo e mudando o nome
      const updateReq = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição Rascunho Atualizada 2028',
          year: 2028,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SP', municipalityOfficialCode: '71072', municipalityName: 'São Paulo' }],
          rounds: [{ roundNumber: 1 }],
          offices: [
            { code: '11', name: 'Prefeito' },
            { code: '13', name: 'Vereador', type: 'PROPORCIONAL' }
          ]
        })
      });
      const updateRes = await saveWizard(updateReq);
      expect(updateRes.status).toBe(200);

      const checkUpdated = await prisma.election.findUnique({
        where: { id: electionId },
        include: { offices: true }
      });
      expect(checkUpdated?.name).toBe('Eleição Rascunho Atualizada 2028');
      expect(checkUpdated?.offices.length).toBe(2);
    });

    it('3.2 Deve proteger contra alterações destrutivas caso a eleição possua BUs reais processados', async () => {
      // Criar eleição ativa com relatório processado
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Ativa Intocável',
          year: 2026,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 1,
              status: 'ACTIVE'
            }
          }
        },
        include: { rounds: true }
      });

      // Simular BU real processado
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'det-report-prod-001',
          electionId: election.id,
          roundId: election.rounds[0].id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'PROCESSADO',
          isSimulation: false
        }
      });

      // Tentar alteração profunda via wizard
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          name: 'Tentativa de Modificação Bloqueada',
          year: 2026,
          type: 'GENERAL',
          scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '1', name: 'Presidente' }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('ELECTION_HAS_PROCESSED_VOTES');
    });
  });

  describe('4. Abrangência Geográfica e Múltiplos Municípios', () => {
    it('4.1 Deve configurar múltiplos municípios em uma mesma eleição', async () => {
      const payload = {
        name: 'Eleição Consórcio Regional 2024',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [
          {
            scopeType: 'MUNICIPAL',
            stateAbbreviation: 'SC',
            municipalityOfficialCode: '80837',
            municipalityName: 'Concórdia'
          },
          {
            scopeType: 'MUNICIPAL',
            stateAbbreviation: 'SC',
            municipalityOfficialCode: '81051',
            municipalityName: 'Seara'
          },
          {
            scopeType: 'MUNICIPAL',
            stateAbbreviation: 'SC',
            municipalityOfficialCode: '81132',
            municipalityName: 'Itá'
          }
        ],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);
      const { electionId } = await res.json();

      const scopes = await prisma.electionScope.findMany({
        where: { electionId },
        orderBy: { scopeKey: 'asc' }
      });

      expect(scopes.length).toBe(3);
      expect(scopes.map(s => s.scopeKey)).toEqual([
        'MUNICIPAL:SC:80837',
        'MUNICIPAL:SC:81051',
        'MUNICIPAL:SC:81132'
      ]);
    });

    it('4.2 Deve configurar escopo nacional canônico (NACIONAL:BR)', async () => {
      const payload = {
        name: 'Eleições Gerais Brasil 2026',
        year: 2026,
        type: 'GENERAL',
        scopes: [
          {
            scopeType: 'NACIONAL',
            stateAbbreviation: 'BR'
          }
        ],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '1', name: 'Presidente' }]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);
      const { electionId } = await res.json();

      const scope = await prisma.electionScope.findFirst({
        where: { electionId }
      });
      expect(scope?.scopeKey).toBe('NACIONAL:BR');
    });
  });

  describe('5. Importação e Validação de Dados Externos (POST /api/admin/wizard/import-tse)', () => {
    it('5.1 Deve rejeitar arquivos malformados ou payloads inválidos', async () => {
      const req = new Request('http://localhost:3000/api/admin/wizard/import-tse', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({ arquivoInvalido: true })
      });

      const res = await importTse(req);
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('5.2 Deve validar formato ele-c do TSE com segurança e retornar sumário pré-visualizável', async () => {
      const tsePayload = {
        plei: '6258',
        ano: 2024,
        nm: 'Eleições Municipais 2024 Oficial',
        tp: 'M',
        t: '2',
        car: [
          { cd: '11', nm: 'Prefeito', tp: 'M', nv: 1 },
          { cd: '13', nm: 'Vereador', tp: 'P', nv: 1 }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard/import-tse', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(tsePayload)
      });

      const res = await importTse(req);
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.valid).toBe(true);
      expect(result.format).toBe('TSE_ELE_C');
      expect(result.summary.officesCount).toBe(2);
      expect(result.summary.roundsCount).toBe(2);
      expect(result.data.election.name).toBe('Eleições Municipais 2024 Oficial');

      // Garantir que a importação NÃO escreveu no banco sem confirmação
      const electionCount = await prisma.election.count({
        where: { name: 'Eleições Municipais 2024 Oficial' }
      });
      expect(electionCount).toBe(0);
    });

    it('5.3 Deve validar e estruturar catálogo de candidatos do TSE sem ingestão cega no banco', async () => {
      const candPayload = {
        candidatos: [
          {
            nr: '13',
            nm: 'Candidato Presidencial A',
            nmu: 'Nome Urna A',
            cdCargo: '1',
            dsCargo: 'Presidente',
            nrPartido: '13',
            sgPartido: 'PT',
            nmPartido: 'Partido dos Trabalhadores'
          },
          {
            nr: '22',
            nm: 'Candidato Presidencial B',
            nmu: 'Nome Urna B',
            cdCargo: '1',
            dsCargo: 'Presidente',
            nrPartido: '22',
            sgPartido: 'PL',
            nmPartido: 'Partido Liberal'
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard/import-tse', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(candPayload)
      });

      const res = await importTse(req);
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.valid).toBe(true);
      expect(result.format).toBe('TSE_CANDIDATES');
      expect(result.summary.candidatesCount).toBe(2);
      expect(result.data.candidates.length).toBe(2);
      expect(result.data.parties.length).toBe(2);

      // Confirmar que o banco permanece intocado antes de salvar no wizard
      const candCount = await prisma.candidate.count();
      expect(candCount).toBe(0);
    });
  });

  describe('6. Ativação Contextual da Eleição (POST /api/admin/wizard/activate)', () => {
    it('6.1 Deve rejeitar ativação com frase de confirmação incorreta', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Para Ativar',
          year: 2026,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1 } },
          scopes: { create: { scopeKey: 'NACIONAL:BR', scopeType: 'NACIONAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'QUERO ATIVAR'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('INVALID_CONFIRMATION');
    });

    it('6.2 Deve rejeitar ativação de eleição sem os requisitos mínimos (sem cargos)', async () => {
      const electionIncomplete = await prisma.election.create({
        data: {
          name: 'Eleição Incompleta',
          year: 2026,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1 } },
          scopes: { create: { scopeKey: 'NACIONAL:BR', scopeType: 'NACIONAL' } }
          // Sem cargos
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: electionIncomplete.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('NO_OFFICES_CONFIGURED');
    });

    it('6.3 Deve ativar eleição consistente e desativar contextualmente a eleição anterior', async () => {
      // 1. Criar Eleição A já ativa
      const electionA = await prisma.election.create({
        data: {
          name: 'Eleição A (Antiga Ativa)',
          year: 2024,
          status: 'ACTIVE',
          rounds: {
            create: {
              roundNumber: 1,
              status: 'ACTIVE'
            }
          }
        },
        include: { rounds: true }
      });

      // 2. Criar Eleição B em DRAFT pronta para ativação
      const electionB = await prisma.election.create({
        data: {
          name: 'Eleição B (Nova Ativada)',
          year: 2026,
          status: 'DRAFT',
          rounds: {
            create: {
              roundNumber: 1,
              status: 'PLANNED'
            }
          },
          scopes: {
            create: {
              scopeKey: 'NACIONAL:BR',
              scopeType: 'NACIONAL'
            }
          },
          offices: {
            create: {
              code: '1',
              name: 'Presidente'
            }
          }
        },
        include: { rounds: true }
      });

      // 3. Ativar Eleição B com frase canônica tolerando variações ('ativar eleicao')
      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: electionB.id,
          confirmationText: 'ativar eleicao'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verificar que Eleição A foi desativada contextualmente
      const checkA = await prisma.election.findUnique({
        where: { id: electionA.id },
        include: { rounds: true }
      });
      expect(checkA?.status).toBe('FINISHED');
      expect(checkA?.rounds[0].status).toBe('FINISHED');

      // Verificar que Eleição B e seu Round 1 passaram para ACTIVE
      const checkB = await prisma.election.findUnique({
        where: { id: electionB.id },
        include: { rounds: true }
      });
      expect(checkB?.status).toBe('ACTIVE');
      expect(checkB?.rounds[0].status).toBe('ACTIVE');

      // Verificar registro de auditoria
      const audit = await prisma.auditLog.findFirst({
        where: { electionId: electionB.id, action: 'ACTIVATE_ELECTION' }
      });
      expect(audit).toBeDefined();
      expect(audit?.result).toBe('SUCCESS');
      expect(audit?.newStatus).toBe('ACTIVE');
    });
  });

  describe('7. Isolamento Multi-Eleição e Independência de Entidades', () => {
    it('7.1 Criação de candidatos e cargos na Eleição B não colide nem afeta a Eleição A', async () => {
      // Criar Eleição A com cargo Prefeito (code: 11) e candidato 13
      const saveReqA = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição A Município Alfa',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          candidates: [{ officeCode: '11', candidateNumber: '13', name: 'Candidato Alfa', partyNumber: '13' }]
        })
      });
      const resA = await saveWizard(saveReqA);
      const { electionId: idA } = await resA.json();

      // Criar Eleição B com mesmo cargo (code: 11) e mesmo número de candidato (13), porém em outro município
      const saveReqB = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição B Município Beta',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '81051' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          candidates: [{ officeCode: '11', candidateNumber: '13', name: 'Candidato Beta', partyNumber: '13' }]
        })
      });
      const resB = await saveWizard(saveReqB);
      const { electionId: idB } = await resB.json();

      expect(idA).not.toBe(idB);

      // Verificar que ambos os candidatos coexistem de forma isolada
      const candA = await prisma.candidate.findFirst({
        where: { office: { electionId: idA }, candidateNumber: '13' }
      });
      const candB = await prisma.candidate.findFirst({
        where: { office: { electionId: idB }, candidateNumber: '13' }
      });

      expect(candA?.name).toBe('Candidato Alfa');
      expect(candB?.name).toBe('Candidato Beta');
      expect(candA?.id).not.toBe(candB?.id);
    });
  });
});
