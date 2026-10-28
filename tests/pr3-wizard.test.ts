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

describe('PR 3 — Assistente Universal de Configuração (Auditoria Independente)', () => {
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

  describe('2. Proteção de Eleições com Boletins Vinculados (Item 1 da Auditoria)', () => {
    it('2.1 Deve bloquear alterações estruturais em eleição DRAFT que possua BUs processados', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Rascunho com BU Processado',
          year: 2026,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        },
        include: { rounds: true }
      });

      // Relatório real processado
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-processado-draft',
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

      // Tentativa de alteração estrutural no rascunho
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          name: 'Eleição Rascunho com BU Processado',
          year: 2026,
          type: 'GENERAL',
          scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SP' }] // Alteração estrutural
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('ELECTION_HAS_BOUND_REPORTS');
    });

    it('2.2 Deve bloquear alterações estruturais em eleição com BUs em PENDENTE_CONFIRMACAO', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição com BU Pendente',
          year: 2026,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } }
        },
        include: { rounds: true }
      });

      // Relatório pendente de confirmação
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-pendente-001',
          electionId: election.id,
          roundId: election.rounds[0].id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'PENDENTE_CONFIRMACAO',
          isSimulation: false
        }
      });

      // Tentativa de alterar cargos da eleição
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          name: 'Eleição com BU Pendente',
          year: 2026,
          type: 'GENERAL',
          offices: [{ code: '11', name: 'Prefeito' }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('ELECTION_HAS_BOUND_REPORTS');
    });

    it('2.3 Deve permitir alterações não destrutivas (descrição, notas) mesmo com BUs vinculados', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição com BUs Reais',
          year: 2026,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } }
        },
        include: { rounds: true }
      });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-real-001',
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

      // Envia apenas metadados textuais (sem arrays estruturais)
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          name: 'Eleição com BUs Reais (Nome Atualizado)',
          year: 2026,
          type: 'GENERAL',
          description: 'Anotação administrativa atualizada com segurança'
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const check = await prisma.election.findUnique({ where: { id: election.id } });
      expect(check?.name).toBe('Eleição com BUs Reais (Nome Atualizado)');
      expect(check?.description).toBe('Anotação administrativa atualizada com segurança');
    });

    it('2.4 Deve preservar o status de eleições ACTIVE, FINISHED e ARCHIVED ao atualizar descrição (sem converter para DRAFT)', async () => {
      // 1. Eleição ACTIVE
      const activeEl = await prisma.election.create({
        data: {
          name: 'Eleição Em Andamento',
          year: 2026,
          status: 'ACTIVE',
          description: 'Desc Original Active'
        }
      });

      // 2. Eleição FINISHED
      const finishedEl = await prisma.election.create({
        data: {
          name: 'Eleição Concluída',
          year: 2024,
          status: 'FINISHED',
          description: 'Desc Original Finished'
        }
      });

      // 3. Eleição ARCHIVED
      const archivedEl = await prisma.election.create({
        data: {
          name: 'Eleição Histórica Arquivada',
          year: 2022,
          status: 'ARCHIVED',
          description: 'Desc Original Archived'
        }
      });

      // Atualizar ACTIVE
      const reqActive = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: activeEl.id,
          name: 'Eleição Em Andamento',
          year: 2026,
          type: 'GENERAL',
          description: 'Nova Descrição da Eleição Ativa'
        })
      });
      const resActive = await saveWizard(reqActive);
      expect(resActive.status).toBe(200);
      const checkActive = await prisma.election.findUnique({ where: { id: activeEl.id } });
      expect(checkActive?.status).toBe('ACTIVE'); // Não virou DRAFT!
      expect(checkActive?.description).toBe('Nova Descrição da Eleição Ativa');

      // Atualizar FINISHED
      const reqFinished = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: finishedEl.id,
          name: 'Eleição Concluída',
          year: 2024,
          type: 'MUNICIPAL',
          description: 'Nota Histórica da Eleição Encerrada'
        })
      });
      const resFinished = await saveWizard(reqFinished);
      expect(resFinished.status).toBe(200);
      const checkFinished = await prisma.election.findUnique({ where: { id: finishedEl.id } });
      expect(checkFinished?.status).toBe('FINISHED'); // Não virou DRAFT!
      expect(checkFinished?.description).toBe('Nota Histórica da Eleição Encerrada');

      // Atualizar ARCHIVED
      const reqArchived = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: archivedEl.id,
          name: 'Eleição Histórica Arquivada',
          year: 2022,
          type: 'GENERAL',
          description: 'Nota da Eleição Arquivada'
        })
      });
      const resArchived = await saveWizard(reqArchived);
      expect(resArchived.status).toBe(200);
      const checkArchived = await prisma.election.findUnique({ where: { id: archivedEl.id } });
      expect(checkArchived?.status).toBe('ARCHIVED'); // Não virou DRAFT!
      expect(checkArchived?.description).toBe('Nota da Eleição Arquivada');
    });

    it('2.5 Deve bloquear alterações estruturais em eleições encerradas ou arquivadas (CANNOT_MODIFY_CLOSED_ELECTION)', async () => {
      const closedEl = await prisma.election.create({
        data: {
          name: 'Eleição Finalizada Antiga',
          year: 2020,
          status: 'FINISHED'
        }
      });

      // Tentativa de alterar escopo
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: closedEl.id,
          name: 'Eleição Finalizada Antiga',
          year: 2020,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CANNOT_MODIFY_CLOSED_ELECTION');
    });
  });

  describe('3. Prevenção de Alterações Globais Indevidas (Item 2 da Auditoria)', () => {
    it('3.1 Deve rejeitar cadastro com código TSE de município existente em UF divergente', async () => {
      // 1. Cadastrar Estado SC e Município 80837 Concórdia
      const stateSC = await prisma.state.create({ data: { name: 'Santa Catarina', abbreviation: 'SC' } });
      await prisma.municipality.create({
        data: {
          name: 'Concórdia',
          officialCode: '80837',
          stateId: stateSC.id,
          isCoverage: true
        }
      });

      // 2. Tentar cadastrar Eleição informando 80837 no Paraná (PR)
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Conflitante',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [
            {
              scopeType: 'MUNICIPAL',
              stateAbbreviation: 'PR',
              municipalityOfficialCode: '80837',
              municipalityName: 'Cidade Fictícia'
            }
          ],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('MUNICIPALITY_STATE_CONFLICT');

      // Garantir que os dados de Concórdia permanecem intactos
      const checkMuni = await prisma.municipality.findUnique({
        where: { officialCode: '80837' },
        include: { state: true }
      });
      expect(checkMuni?.state.abbreviation).toBe('SC');
      expect(checkMuni?.name).toBe('Concórdia');
    });

    it('3.2 Deve rejeitar sobrescrita de dados de Partido com sigla conflitante', async () => {
      // 1. Registrar Partido 13 com sigla PT
      await prisma.party.create({
        data: {
          officialIdentifier: '13',
          name: 'Partido dos Trabalhadores',
          abbreviation: 'PT'
        }
      });

      // 2. Eleição tenta cadastrar partido 13 com sigla divergente "XYZ"
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição com Partido Conflitante',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SP' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          parties: [{ officialIdentifier: '13', name: 'Outro Nome', abbreviation: 'XYZ' }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('PARTY_DATA_CONFLICT');

      // Garantir que a sigla do partido 13 continua PT
      const checkParty = await prisma.party.findUnique({ where: { officialIdentifier: '13' } });
      expect(checkParty?.abbreviation).toBe('PT');
    });
  });

  describe('4. Sincronização Consistente de Rascunhos (Item 3 da Auditoria)', () => {
    it('4.1 Campos omitidos (undefined) não devem apagar entidades existentes', async () => {
      // 1. Criar rascunho com escopos, cargos e candidatos
      const createReq = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Rascunho Inicial',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          candidates: [{ officeCode: '11', candidateNumber: '10', name: 'Candidato Dez', partyNumber: '10' }]
        })
      });
      const createRes = await saveWizard(createReq);
      const { electionId } = await createRes.json();

      // 2. Atualizar apenas o nome, omitindo scopes, offices e candidates
      const updateReq = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição Rascunho Renomeada',
          year: 2024,
          type: 'MUNICIPAL'
          // scopes, offices, candidates OMITIDOS
        })
      });
      const updateRes = await saveWizard(updateReq);
      expect(updateRes.status).toBe(200);

      // Verificar que escopos, cargos e candidatos NÃO foram apagados
      const check = await prisma.election.findUnique({
        where: { id: electionId },
        include: { scopes: true, offices: { include: { candidates: true } } }
      });
      expect(check?.scopes.length).toBe(1);
      expect(check?.offices.length).toBe(1);
      expect(check?.offices[0].candidates.length).toBe(1);
    });

    it('4.2 Não deve permitir exclusão de candidato que já possua votos', async () => {
      // Criar eleição com cargo e candidato
      const election = await prisma.election.create({
        data: {
          name: 'Eleição com Votos',
          year: 2024,
          rounds: { create: { roundNumber: 1 } },
          offices: {
            create: {
              code: '11',
              name: 'Prefeito',
              candidates: {
                create: {
                  candidateNumber: '55',
                  name: 'Candidato Cisa',
                  ballotName: 'Cisa',
                  party: {
                    create: { officialIdentifier: '55', name: 'Partido 55', abbreviation: 'P55' }
                  }
                }
              }
            }
          }
        },
        include: { rounds: true, offices: { include: { candidates: true } } }
      });

      const report = await prisma.ballotReport.create({
        data: {
          deterministicId: 'report-voto-cand-001',
          electionId: election.id,
          roundId: election.rounds[0].id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'RECEBIDO',
          isSimulation: true // simulação para permitir teste de votos
        }
      });

      // Criar voto para o candidato 55
      await prisma.ballotVote.create({
        data: {
          reportId: report.id,
          officeId: election.offices[0].id,
          candidateId: election.offices[0].candidates[0].id,
          candidateNumber: '55',
          quantity: 10
        }
      });

      // Tentar atualizar candidatos passando lista vazia (tentando remover candidato com votos)
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          name: 'Eleição com Votos',
          year: 2024,
          type: 'MUNICIPAL',
          candidates: [] // Lista vazia: tenta remover todos os candidatos
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CANNOT_REMOVE_REFERENCED_CANDIDATE');
    });
  });

  describe('5. Ativação Contextual sem Encerramento Indevido (Item 4 da Auditoria)', () => {
    it('5.1 Deve rejeitar ativação se já existir eleição ativa sem consentimento explícito', async () => {
      // 1. Eleição A ativa
      const electionA = await prisma.election.create({
        data: {
          name: 'Eleição Ordinária Ativa',
          year: 2024,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      // 2. Eleição B pronta para ativação
      const electionB = await prisma.election.create({
        data: {
          name: 'Eleição Suplementar Nova',
          year: 2024,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        }
      });

      // 3. Tentar ativar Eleição B sem allowDeactivateCurrent
      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: electionB.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
          // allowDeactivateCurrent omitido (false)
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('ACTIVE_ELECTION_CONFLICT');

      // Garantir que a Eleição A permanece ACTIVE e não foi modificada
      const checkA = await prisma.election.findUnique({ where: { id: electionA.id } });
      expect(checkA?.status).toBe('ACTIVE');
    });

    it('5.2 Deve arquivar contextualmente (não marcar FINISHED nem alterar votos) quando consentido', async () => {
      const electionA = await prisma.election.create({
        data: {
          name: 'Eleição Anterior a Pausar',
          year: 2024,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } }
        }
      });

      const electionB = await prisma.election.create({
        data: {
          name: 'Eleição Nova a Ativar',
          year: 2026,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: electionB.id,
          confirmationText: 'ATIVAR ELEIÇÃO',
          allowDeactivateCurrent: true
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(200);

      const checkA = await prisma.election.findUnique({ where: { id: electionA.id } });
      expect(checkA?.status).toBe('ARCHIVED'); // Arquivada contextualmente, NÃO finalizada

      // ITEM 2 DA AUDITORIA: Nenhuma eleição ARCHIVED permanece com turno operacional ACTIVE
      const roundsA = await prisma.electionRound.findMany({ where: { electionId: electionA.id } });
      expect(roundsA.some(r => r.status === 'ACTIVE')).toBe(false);
      expect(roundsA[0].status).toBe('PLANNED');

      const checkB = await prisma.election.findUnique({ where: { id: electionB.id } });
      expect(checkB?.status).toBe('ACTIVE');

      const roundsB = await prisma.electionRound.findMany({ where: { electionId: electionB.id } });
      expect(roundsB.find(r => r.roundNumber === 1)?.status).toBe('ACTIVE');
    });

    it('5.3 Deve permitir retomada de eleição arquivada garantindo consistência com componentes legados', async () => {
      // Cenário com Eleição A (ARCHIVED, com round PLANNED) e Eleição B (ACTIVE, com round ACTIVE)
      const electionA = await prisma.election.create({
        data: {
          name: 'Eleição A a Retomar',
          year: 2024,
          status: 'ARCHIVED',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        },
        include: { rounds: true }
      });

      // Evidência de auditoria exigida para retomada fail-closed de eleição arquivada
      await prisma.auditLog.create({
        data: {
          userId: adminUser.id,
          electionId: electionA.id,
          roundId: electionA.rounds[0].id,
          action: 'ELECTION_CONTEXT_SWITCH_ARCHIVED',
          result: 'SUCCESS'
        }
      });

      const electionB = await prisma.election.create({
        data: {
          name: 'Eleição B Ativa no Momento',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SP', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        }
      });

      // Retomada explícita de A com consentimento para arquivar B
      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: electionA.id,
          confirmationText: 'ATIVAR ELEIÇÃO',
          allowDeactivateCurrent: true
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(200);

      const checkA = await prisma.election.findUnique({ where: { id: electionA.id } });
      expect(checkA?.status).toBe('ACTIVE');
      const roundA = await prisma.electionRound.findFirst({ where: { electionId: electionA.id } });
      expect(roundA?.status).toBe('ACTIVE');

      const checkB = await prisma.election.findUnique({ where: { id: electionB.id } });
      expect(checkB?.status).toBe('ARCHIVED');
      const roundB = await prisma.electionRound.findFirst({ where: { electionId: electionB.id } });
      expect(roundB?.status).toBe('PLANNED');

      // Proteção de componentes legados: deve haver EXATAMENTE UM turno ACTIVE no banco inteiro
      const globalActiveRounds = await prisma.electionRound.findMany({ where: { status: 'ACTIVE' } });
      expect(globalActiveRounds.length).toBe(1);
      expect(globalActiveRounds[0].electionId).toBe(electionA.id);
    });

    it('5.4 Não deve permitir reativação de eleição no status FINISHED', async () => {
      const finishedEl = await prisma.election.create({
        data: {
          name: 'Eleição Encerrada Definitiva',
          year: 2020,
          status: 'FINISHED',
          rounds: { create: { roundNumber: 1, status: 'FINISHED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: finishedEl.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CANNOT_ACTIVATE_FINISHED_ELECTION');
    });

    it('5.5 Deve ser idempotente ao repetir ativação de eleição já ativa, sem ativar o 2º turno', async () => {
      // Eleição com 1º Turno ACTIVE e 2º Turno PLANNED
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Já Ativa Idempotente',
          year: 2024,
          status: 'ACTIVE',
          rounds: {
            create: [
              { roundNumber: 1, status: 'ACTIVE' },
              { roundNumber: 2, status: 'PLANNED' }
            ]
          },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        },
        include: { rounds: true }
      });

      // Chamar ativação novamente na mesma eleição
      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.alreadyActive).toBe(true);

      // Verificar que o 1º turno CONTINUA ativo e o 2º turno CONTINUA PLANNED (não foi ativado!)
      const rounds = await prisma.electionRound.findMany({
        where: { electionId: election.id },
        orderBy: { roundNumber: 'asc' }
      });
      expect(rounds[0].status).toBe('ACTIVE');
      expect(rounds[1].status).toBe('PLANNED');

      // Garantir que no banco todo continua existindo apenas UM turno ativo
      const totalActiveRounds = await prisma.electionRound.count({ where: { status: 'ACTIVE' } });
      expect(totalActiveRounds).toBe(1);
    });

    it('5.6 Nova eleição com dois turnos PLANNED deve ativar obrigatoriamente o 1º turno e nunca o 2º turno', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Nova Dois Turnos Planned',
          year: 2024,
          status: 'DRAFT',
          rounds: {
            create: [
              { roundNumber: 1, status: 'PLANNED' },
              { roundNumber: 2, status: 'PLANNED' }
            ]
          },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(200);

      const rounds = await prisma.electionRound.findMany({
        where: { electionId: election.id },
        orderBy: { roundNumber: 'asc' }
      });
      expect(rounds[0].status).toBe('ACTIVE'); // 1º Turno ativado
      expect(rounds[1].status).toBe('PLANNED'); // 2º Turno permanece PLANNED
    });

    it('5.7 Retomada de eleição arquivada cujo 2º turno estava ativo deve retomar inequivocamente o 2º turno', async () => {
      // 1. Eleição A com 1º Turno FINISHED e 2º Turno ACTIVE
      const electionA = await prisma.election.create({
        data: {
          name: 'Eleição Municipal Turno 2 Ativo',
          year: 2024,
          status: 'ACTIVE',
          rounds: {
            create: [
              { roundNumber: 1, status: 'FINISHED' },
              { roundNumber: 2, status: 'ACTIVE' }
            ]
          },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        },
        include: { rounds: true }
      });

      // 2. Eleição B entra em ativação contextualmente, pausando a Eleição A
      const electionB = await prisma.election.create({
        data: {
          name: 'Eleição Temporária Concorrente',
          year: 2026,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SP', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        }
      });

      // Ativar B pausando A
      await activateWizard(new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: electionB.id,
          confirmationText: 'ATIVAR ELEIÇÃO',
          allowDeactivateCurrent: true
        })
      }));

      // Confirmar que A foi arquivada e seu 2º turno foi pausado para PLANNED
      const roundsAPaused = await prisma.electionRound.findMany({
        where: { electionId: electionA.id },
        orderBy: { roundNumber: 'asc' }
      });
      expect(roundsAPaused[0].status).toBe('FINISHED');
      expect(roundsAPaused[1].status).toBe('PLANNED');

      // 3. Retomada de A: deve ativar inequivocamente o 2º turno (que estava pausado)
      const resResume = await activateWizard(new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: electionA.id,
          confirmationText: 'ATIVAR ELEIÇÃO',
          allowDeactivateCurrent: true
        })
      }));

      expect(resResume.status).toBe(200);
      const dataResume = await resResume.json();
      expect(dataResume.roundId).toBe(roundsAPaused[1].id);

      const roundsAResumed = await prisma.electionRound.findMany({
        where: { electionId: electionA.id },
        orderBy: { roundNumber: 'asc' }
      });
      expect(roundsAResumed[0].status).toBe('FINISHED');
      expect(roundsAResumed[1].status).toBe('ACTIVE'); // 2º Turno retomado com precisão!

      // Garantir apenas 1 turno ativo no sistema
      const totalActive = await prisma.electionRound.count({ where: { status: 'ACTIVE' } });
      expect(totalActive).toBe(1);
    });

    it('5.8 Rollback transacional integral em falha na ativação', async () => {
      // Eleição sem cargos
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Sem Cargos Falha',
          year: 2024,
          status: 'DRAFT',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } }
          // offices ausentes!
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('NO_OFFICES_CONFIGURED');

      // Estado permanece DRAFT e PLANNED sem nenhuma alteração
      const checkEl = await prisma.election.findUnique({ where: { id: election.id } });
      expect(checkEl?.status).toBe('DRAFT');
      const checkRound = await prisma.electionRound.findFirst({ where: { electionId: election.id } });
      expect(checkRound?.status).toBe('PLANNED');
    });

    it('5.9 Retomada de eleição ARCHIVED sem log de pausa deve ser rejeitada com PAUSED_ROUND_NOT_RESOLVED (Fail-Closed)', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Arquivada Sem Log',
          year: 2024,
          status: 'ARCHIVED',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('PAUSED_ROUND_NOT_RESOLVED');

      // Garantir integridade fail-closed: continua ARCHIVED
      const checkEl = await prisma.election.findUnique({ where: { id: election.id } });
      expect(checkEl?.status).toBe('ARCHIVED');
    });

    it('5.10 Retomada com log apontando para turno inexistente deve ser rejeitada com PAUSED_ROUND_NOT_RESOLVED', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Arquivada Log Turno Inexistente',
          year: 2024,
          status: 'ARCHIVED',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        }
      });

      // Criar turno em outra eleição para satisfazer a foreign key do AuditLog,
      // simulando inconsistência em que o roundId do log não pertence aos rounds da eleição alvo
      const otherEl = await prisma.election.create({
        data: {
          name: 'Outra Eleição Externa',
          year: 2024,
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } }
        },
        include: { rounds: true }
      });

      await prisma.auditLog.create({
        data: {
          userId: adminUser.id,
          electionId: election.id,
          roundId: otherEl.rounds[0].id,
          action: 'ELECTION_CONTEXT_SWITCH_ARCHIVED',
          result: 'SUCCESS'
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('PAUSED_ROUND_NOT_RESOLVED');

      // Garantir integridade: eleição continua ARCHIVED
      const checkEl = await prisma.election.findUnique({ where: { id: election.id } });
      expect(checkEl?.status).toBe('ARCHIVED');
    });

    it('5.11 Retomada com log apontando para turno FINISHED deve ser rejeitada com PAUSED_ROUND_NOT_RESOLVED', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Arquivada Log Turno Finished',
          year: 2024,
          status: 'ARCHIVED',
          rounds: {
            create: [
              { roundNumber: 1, status: 'FINISHED' },
              { roundNumber: 2, status: 'PLANNED' }
            ]
          },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        },
        include: { rounds: true }
      });

      const round1 = election.rounds.find(r => r.roundNumber === 1)!;

      // Log aponta para o round 1 que já está FINISHED
      await prisma.auditLog.create({
        data: {
          userId: adminUser.id,
          electionId: election.id,
          roundId: round1.id,
          action: 'ELECTION_CONTEXT_SWITCH_ARCHIVED',
          result: 'SUCCESS'
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('PAUSED_ROUND_NOT_RESOLVED');

      // Eleição continua ARCHIVED e turno 1 FINISHED, turno 2 PLANNED
      const checkEl = await prisma.election.findUnique({ where: { id: election.id } });
      expect(checkEl?.status).toBe('ARCHIVED');
      const checkRounds = await prisma.electionRound.findMany({ where: { electionId: election.id } });
      expect(checkRounds.find(r => r.roundNumber === 1)?.status).toBe('FINISHED');
      expect(checkRounds.find(r => r.roundNumber === 2)?.status).toBe('PLANNED');
    });

    it('5.12 Eleição DRAFT sem turno 1 configurado deve ser rejeitada com FIRST_ROUND_NOT_READY', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Sem Turno 1',
          year: 2024,
          status: 'DRAFT',
          rounds: {
            create: [
              { roundNumber: 2, status: 'PLANNED' } // Somente turno 2 configurado
            ]
          },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('FIRST_ROUND_NOT_READY');

      // Garantir que round 2 NUNCA é ativado automaticamente
      const checkRound = await prisma.electionRound.findFirst({ where: { electionId: election.id } });
      expect(checkRound?.status).toBe('PLANNED');
      const checkEl = await prisma.election.findUnique({ where: { id: election.id } });
      expect(checkEl?.status).toBe('DRAFT');
    });

    it('5.13 Eleição DRAFT com turno 1 FINISHED e turno 2 PLANNED deve ser rejeitada com FIRST_ROUND_NOT_READY', async () => {
      const election = await prisma.election.create({
        data: {
          name: 'Eleição Draft Turno 1 Incompatível',
          year: 2024,
          status: 'DRAFT',
          rounds: {
            create: [
              { roundNumber: 1, status: 'FINISHED' },
              { roundNumber: 2, status: 'PLANNED' }
            ]
          },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: election.id,
          confirmationText: 'ATIVAR ELEIÇÃO'
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('FIRST_ROUND_NOT_READY');

      // Garantir que o 2º turno NÃO foi ativado automaticamente
      const checkRounds = await prisma.electionRound.findMany({ where: { electionId: election.id } });
      expect(checkRounds.find(r => r.roundNumber === 2)?.status).toBe('PLANNED');
      const checkEl = await prisma.election.findUnique({ where: { id: election.id } });
      expect(checkEl?.status).toBe('DRAFT');
    });

    it('5.14 Rollback transacional completo ao rejeitar ativação fail-closed preservando eleição ativa concorrente', async () => {
      // 1. Eleição X atualmente ACTIVE com round 1 ACTIVE
      const activeEl = await prisma.election.create({
        data: {
          name: 'Eleição Ativa Intacta',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: { roundNumber: 1, status: 'ACTIVE' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '1', name: 'Presidente' } }
        },
        include: { rounds: true }
      });

      // 2. Eleição Y ARCHIVED sem log de pausa
      const archivedEl = await prisma.election.create({
        data: {
          name: 'Eleição Arquivada Sem Evidência',
          year: 2024,
          status: 'ARCHIVED',
          rounds: { create: { roundNumber: 1, status: 'PLANNED' } },
          scopes: { create: { scopeKey: 'ESTADUAL:SC', scopeType: 'ESTADUAL' } },
          offices: { create: { code: '11', name: 'Prefeito' } }
        },
        include: { rounds: true }
      });

      // Contagem de logs antes
      const logCountBefore = await prisma.auditLog.count();

      // Tentativa de ativação de Y com consentimento de desativação
      const req = new Request('http://localhost:3000/api/admin/wizard/activate', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: archivedEl.id,
          confirmationText: 'ATIVAR ELEIÇÃO',
          allowDeactivateCurrent: true
        })
      });

      const res = await activateWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('PAUSED_ROUND_NOT_RESOLVED');

      // Garantir integridade absoluta pós-falha (rollback integral):
      // Eleição X continua ACTIVE e seu turno continua ACTIVE
      const checkActive = await prisma.election.findUnique({ where: { id: activeEl.id } });
      expect(checkActive?.status).toBe('ACTIVE');
      const checkActiveRound = await prisma.electionRound.findFirst({ where: { electionId: activeEl.id } });
      expect(checkActiveRound?.status).toBe('ACTIVE');

      // Eleição Y continua ARCHIVED e seu turno continua PLANNED
      const checkArchived = await prisma.election.findUnique({ where: { id: archivedEl.id } });
      expect(checkArchived?.status).toBe('ARCHIVED');
      const checkArchivedRound = await prisma.electionRound.findFirst({ where: { electionId: archivedEl.id } });
      expect(checkArchivedRound?.status).toBe('PLANNED');

      // Nenhum log espúrio persistido
      const logCountAfter = await prisma.auditLog.count();
      expect(logCountAfter).toBe(logCountBefore);
    });
  });

  describe('6. Validação de Importações do TSE (Item 5 da Auditoria)', () => {
    it('6.1 Não deve inferir silenciosamente partido ou cargo ausente', async () => {
      const candPayloadIncompleto = {
        candidatos: [
          {
            nr: '123',
            nm: 'Candidato Sem Partido Nem Cargo'
            // cdCargo, nrPartido, sgPartido AUSENTES
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard/import-tse', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(candPayloadIncompleto)
      });

      const res = await importTse(req);
      expect(res.status).toBe(200);
      const result = await res.json();

      expect(result.valid).toBe(false); // Inválido para ingestão direta
      expect(result.summary.confirmedRecordsCount).toBe(0);
      expect(result.summary.recordsWithWarningsCount).toBe(1);
      expect(result.validationDetails[0].isConfirmed).toBe(false);
      expect(result.validationDetails[0].missingFields).toContain('officeCode');
      expect(result.validationDetails[0].missingFields).toContain('partyNumber');
      expect(result.validationDetails[0].missingFields).toContain('partyAbbreviation');
    });

    it('6.2 Deve rejeitar candidatos duplicados com o mesmo número no mesmo cargo', async () => {
      const candPayloadDuplicado = {
        candidatos: [
          {
            nr: '10',
            nm: 'Candidato Alfa',
            cdCargo: '11',
            nrPartido: '10',
            sgPartido: 'PA'
          },
          {
            nr: '10',
            nm: 'Candidato Alfa Duplicado',
            cdCargo: '11',
            nrPartido: '10',
            sgPartido: 'PA'
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard/import-tse', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(candPayloadDuplicado)
      });

      const res = await importTse(req);
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors[0]).toContain('Candidato duplicado detectado');
    });
  });

  describe('7. Sincronização Exata da Cobertura por Turno e Algoritmo de Diff (Item 3 da Auditoria)', () => {
    const ensureMuni = async () => {
      const state = await prisma.state.upsert({
        where: { abbreviation: 'SC' },
        update: {},
        create: { name: 'Santa Catarina', abbreviation: 'SC' }
      });
      return await prisma.municipality.upsert({
        where: { officialCode: '80837' },
        update: {},
        create: { name: 'Concórdia', officialCode: '80837', stateId: state.id }
      });
    };

    it('7.1 Seção com expectedBUs = 2 e Seção agregada com expectedBUs = 0', async () => {
      await ensureMuni();
      const payload = {
        name: 'Eleição Teste ExpectedBUs',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        coverage: [
          {
            municipalityOfficialCode: '80837',
            zoneNumber: '090',
            sectionNumber: '0001',
            expectedBUs: 2 // 1. Seção com expectedBUs = 2
          },
          {
            municipalityOfficialCode: '80837',
            zoneNumber: '090',
            sectionNumber: '0002',
            isAggregated: true // 2. Seção agregada com expectedBUs = 0
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
      const { electionId } = await res.json();

      const round = await prisma.electionRound.findFirst({
        where: { electionId },
        include: {
          coverage: {
            include: { pollingSection: true }
          }
        }
      });

      expect(round?.coverageStatus).toBe('REGISTERED');
      const cov1 = round?.coverage.find(c => c.pollingSection.sectionNumber === '0001');
      const cov2 = round?.coverage.find(c => c.pollingSection.sectionNumber === '0002');

      expect(cov1?.expectedBUs).toBe(2);
      expect(cov2?.expectedBUs).toBe(0);
    });

    it('7.2 Remoção de seção do turno 1 mantendo-a no turno 2', async () => {
      await ensureMuni();
      // Criar inicialmente com seções 0001 e 0002 em ambos os turnos
      const payload1 = {
        name: 'Eleição Diff Cobertura',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
        rounds: [{ roundNumber: 1 }, { roundNumber: 2 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        coverage: [
          { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 },
          { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0002', expectedBUs: 1 }
        ]
      };

      const req1 = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload1)
      });
      const res1 = await saveWizard(req1);
      expect(res1.status).toBe(200);
      const { electionId } = await res1.json();

      // Atualizar malha: remover 0001 do turno 1 (atribuindo-a apenas ao turno 2)
      const payload2 = {
        electionId,
        name: 'Eleição Diff Cobertura',
        year: 2024,
        type: 'MUNICIPAL',
        coverage: [
          { roundNumber: 2, municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 },
          { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0002', expectedBUs: 1 }
        ]
      };

      const req2 = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload2)
      });
      const res2 = await saveWizard(req2);
      expect(res2.status).toBe(200);

      const rounds = await prisma.electionRound.findMany({
        where: { electionId },
        orderBy: { roundNumber: 'asc' },
        include: { coverage: { include: { pollingSection: true } } }
      });

      // Turno 1 só deve ter a seção 0002
      const t1Secs = rounds[0].coverage.map(c => c.pollingSection.sectionNumber);
      expect(t1Secs).toEqual(['0002']);

      // Turno 2 deve ter seções 0001 e 0002
      const t2Secs = rounds[1].coverage.map(c => c.pollingSection.sectionNumber).sort();
      expect(t2Secs).toEqual(['0001', '0002']);
    });

    it('7.3 Remoção de todas as seções de um turno (reversão para PROVISIONAL)', async () => {
      await ensureMuni();
      // Criar com cobertura
      const payload = {
        name: 'Eleição Esvaziar Cobertura',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        coverage: [
          { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 }
        ]
      };

      const req1 = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });
      const res1 = await saveWizard(req1);
      const { electionId } = await res1.json();

      // Enviar coverage vazia []
      const req2 = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição Esvaziar Cobertura',
          year: 2024,
          type: 'MUNICIPAL',
          coverage: []
        })
      });
      const res2 = await saveWizard(req2);
      expect(res2.status).toBe(200);

      const round = await prisma.electionRound.findFirst({
        where: { electionId },
        include: { coverage: true }
      });

      expect(round?.coverage.length).toBe(0);
      expect(round?.coverageStatus).toBe('PROVISIONAL');
    });

    it('7.4 Atualização da malha da eleição A preservando a eleição B', async () => {
      await ensureMuni();
      // 1. Criar Eleição A com seção 0001
      const resA = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Alfa Cobertura',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 }]
        })
      }));
      const { electionId: idA } = await resA.json();

      // 2. Criar Eleição B com seção 0002
      const resB = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Beta Cobertura',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0002', expectedBUs: 1 }]
        })
      }));
      const { electionId: idB } = await resB.json();

      // 3. Atualizar Eleição A para seção 0003
      await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: idA,
          name: 'Eleição Alfa Cobertura',
          year: 2024,
          type: 'MUNICIPAL',
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0003', expectedBUs: 1 }]
        })
      }));

      // 4. Verificar que Eleição A tem seção 0003 e Eleição B continua com 0002 intacta
      const roundA = await prisma.electionRound.findFirst({
        where: { electionId: idA },
        include: { coverage: { include: { pollingSection: true } } }
      });
      const roundB = await prisma.electionRound.findFirst({
        where: { electionId: idB },
        include: { coverage: { include: { pollingSection: true } } }
      });

      expect(roundA?.coverage.map(c => c.pollingSection.sectionNumber)).toEqual(['0003']);
      expect(roundB?.coverage.map(c => c.pollingSection.sectionNumber)).toEqual(['0002']);
    });

    it('7.5 Bloqueio de edição de cobertura homologada (CANNOT_MODIFY_HOMOLOGATED_COVERAGE)', async () => {
      await ensureMuni();
      const el = await prisma.election.create({
        data: {
          name: 'Eleição Cobertura Homologada',
          year: 2024,
          status: 'DRAFT',
          rounds: {
            create: {
              roundNumber: 1,
              status: 'PLANNED',
              coverageStatus: 'HOMOLOGATED' // Cobertura Homologada!
            }
          }
        }
      });

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId: el.id,
          name: 'Eleição Cobertura Homologada',
          year: 2024,
          type: 'MUNICIPAL',
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001' }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CANNOT_MODIFY_HOMOLOGATED_COVERAGE');
    });

    it('7.6 Bloqueio de remoção de seção com BUs reais vinculados (CANNOT_REMOVE_SECTION_WITH_REAL_BUS)', async () => {
      await ensureMuni();
      // Criar eleição com seção 0001
      const resCreate = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição BU Real Cobertura',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 }]
        })
      }));
      const { electionId } = await resCreate.json();

      const round = await prisma.electionRound.findFirst({ where: { electionId } });

      // Inserir um BU real para a seção 0001
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-real-sec-0001',
          electionId,
          roundId: round!.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'PROCESSADO',
          isSimulation: false
        }
      });

      // Tentativa de remover a seção 0001 enviando apenas a seção 0002
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição BU Real Cobertura',
          year: 2024,
          type: 'MUNICIPAL',
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0002', expectedBUs: 1 }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CANNOT_REMOVE_SECTION_WITH_REAL_BUS');

      // Garantir que a seção 0001 continua presente na cobertura do turno
      const checkCov = await prisma.roundCoverage.findFirst({
        where: { electionRoundId: round!.id },
        include: { pollingSection: true }
      });
      expect(checkCov?.pollingSection.sectionNumber).toBe('0001');
    });

    it('7.7 Repetição idempotente do salvamento da cobertura', async () => {
      await ensureMuni();
      const payload = {
        name: 'Eleição Idempotente',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        coverage: [
          { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 2 },
          { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0002', expectedBUs: 1 }
        ]
      };

      // 1ª Execução
      const res1 = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      }));
      expect(res1.status).toBe(200);
      const { electionId } = await res1.json();

      const covs1 = await prisma.roundCoverage.findMany({
        where: { electionRound: { electionId } },
        orderBy: { pollingSectionId: 'asc' }
      });

      // 2ª Execução com payload idêntico
      const res2 = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({ ...payload, electionId })
      }));
      expect(res2.status).toBe(200);

      const covs2 = await prisma.roundCoverage.findMany({
        where: { electionRound: { electionId } },
        orderBy: { pollingSectionId: 'asc' }
      });

      expect(covs1.length).toBe(covs2.length);
      expect(covs1.map(c => c.id)).toEqual(covs2.map(c => c.id));
      expect(covs1.map(c => c.expectedBUs)).toEqual(covs2.map(c => c.expectedBUs));
    });

    it('7.8 Rollback integral quando uma das etapas de cobertura falhar', async () => {
      await ensureMuni();
      const payload = {
        name: 'Eleição Rollback Cobertura',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        coverage: [
          { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 },
          { municipalityOfficialCode: '99999', zoneNumber: '090', sectionNumber: '0002', expectedBUs: 1 } // Município inexistente!
        ]
      };

      const res = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      }));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('MUNICIPALITY_NOT_FOUND');

      // Garantir rollback total: nenhuma eleição foi criada
      const count = await prisma.election.count({ where: { name: 'Eleição Rollback Cobertura' } });
      expect(count).toBe(0);
    });

    it('7.9 Bloqueio de alteração de expectedBUs em turno com BUs reais vinculados (CANNOT_MODIFY_COVERAGE_WITH_REAL_BUS)', async () => {
      await ensureMuni();
      // Criar eleição com seção 0001 esperada = 1
      const resCreate = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Modificar ExpectedBUs BU Real',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 }]
        })
      }));
      const { electionId } = await resCreate.json();
      const round = await prisma.electionRound.findFirst({ where: { electionId } });

      // Inserir BU real vinculado ao turno
      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-real-turn-modify-exp',
          electionId,
          roundId: round!.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'PROCESSADO',
          isSimulation: false
        }
      });

      // Tentativa de alterar expectedBUs para 2
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição Modificar ExpectedBUs BU Real',
          year: 2024,
          type: 'MUNICIPAL',
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 2 }]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CANNOT_MODIFY_COVERAGE_WITH_REAL_BUS');
    });

    it('7.10 Bloqueio de adição de nova seção ao turno com BUs reais vinculados (CANNOT_MODIFY_COVERAGE_WITH_REAL_BUS)', async () => {
      await ensureMuni();
      const resCreate = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Adicionar Secao BU Real',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 }]
        })
      }));
      const { electionId } = await resCreate.json();
      const round = await prisma.electionRound.findFirst({ where: { electionId } });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-real-turn-add-sec',
          electionId,
          roundId: round!.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'PROCESSADO',
          isSimulation: false
        }
      });

      // Tentativa de adicionar a seção 0002 ao turno com BU real
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição Adicionar Secao BU Real',
          year: 2024,
          type: 'MUNICIPAL',
          coverage: [
            { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 },
            { municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0002', expectedBUs: 1 }
          ]
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CANNOT_MODIFY_COVERAGE_WITH_REAL_BUS');
    });

    it('7.11 Reenvio idempotente idêntico de cobertura em turno com BUs reais vinculados (sucesso 200)', async () => {
      await ensureMuni();
      const payloadCoverage = [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 }];

      const resCreate = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Idempotente BU Real',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          coverage: payloadCoverage
        })
      }));
      const { electionId } = await resCreate.json();
      const round = await prisma.electionRound.findFirst({ where: { electionId } });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-real-turn-idempotent',
          electionId,
          roundId: round!.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'PROCESSADO',
          isSimulation: false
        }
      });

      // Reenvio com configuração 100% idêntica da cobertura
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição Idempotente BU Real',
          year: 2024,
          type: 'MUNICIPAL',
          coverage: payloadCoverage
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('7.12 Edição administrativa textual legítima (descrição, nome) em eleição com BUs reais (sucesso 200)', async () => {
      await ensureMuni();
      const resCreate = await saveWizard(new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          name: 'Eleição Edição Textual BU Real',
          year: 2024,
          type: 'MUNICIPAL',
          scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
          rounds: [{ roundNumber: 1 }],
          offices: [{ code: '11', name: 'Prefeito' }],
          coverage: [{ municipalityOfficialCode: '80837', zoneNumber: '090', sectionNumber: '0001', expectedBUs: 1 }]
        })
      }));
      const { electionId } = await resCreate.json();
      const round = await prisma.electionRound.findFirst({ where: { electionId } });

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'bu-real-text-edit',
          electionId,
          roundId: round!.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '090',
          sectionCode: '0001',
          urnCode: '1001',
          status: 'PROCESSADO',
          isSimulation: false
        }
      });

      // Edição apenas de descrição e identificação (coverage omitida)
      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify({
          electionId,
          name: 'Eleição Edição Textual BU Real (Nome Atualizado)',
          year: 2024,
          type: 'MUNICIPAL',
          description: 'Anotação legítima de auditoria durante apuração'
        })
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const checkEl = await prisma.election.findUnique({ where: { id: electionId } });
      expect(checkEl?.name).toBe('Eleição Edição Textual BU Real (Nome Atualizado)');
      expect(checkEl?.description).toBe('Anotação legítima de auditoria durante apuração');
    });
  });

  describe('8. Gestão Segura de Operadores (Item 7 da Auditoria)', () => {
    it('8.1 Não deve permitir rebaixar ou alterar o papel de usuários ADMIN existentes', async () => {
      const payload = {
        name: 'Eleição Tentativa Conflito Operador',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        operators: [
          { email: adminUser.email, name: 'Tentando rebaixar admin para operador' }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('OPERATOR_ROLE_CONFLICT');

      // Garantir que o admin permaneceu ADMIN
      const checkAdmin = await prisma.user.findUnique({ where: { email: adminUser.email } });
      expect(checkAdmin?.role).toBe('ADMIN');
    });

    it('8.2 Novo operador sem senha inicial deve ser criado como inativo (isActive = false)', async () => {
      const payload = {
        name: 'Eleição Novo Operador Inativo',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        operators: [
          { email: 'novo.operador.inativo@teste.gov.br', name: 'Novo Operador Sem Senha' }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(200);

      const createdOp = await prisma.user.findUnique({
        where: { email: 'novo.operador.inativo@teste.gov.br' }
      });
      expect(createdOp).toBeDefined();
      expect(createdOp?.isActive).toBe(false); // Inativo aguardando ativação de senha
      expect(createdOp?.role).toBe('OPERATOR');
    });

    it('8.3 Novo operador com senha inicial fraca deve ser rejeitado', async () => {
      const payload = {
        name: 'Eleição Senha Fraca',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        operators: [
          { email: 'op.fraco@teste.gov.br', initialPassword: '123' } // Senha fraca
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('INVALID_OPERATOR_PASSWORD');
    });
  });

  describe('9. Validação de Escopos e Rollback Transacional Integral', () => {
    it('9.1 validateElectionScopesSet() deve rejeitar contradição Nacional vs Estadual', async () => {
      const payload = {
        name: 'Eleição com Escopos Contraditórios',
        year: 2026,
        type: 'GENERAL',
        scopes: [
          { scopeType: 'NACIONAL', stateAbbreviation: 'BR' },
          { scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }
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
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('CONTRADICTORY_SCOPE_NATIONAL_EXISTS');

      // Garantir rollback total: nenhuma eleição criada
      const count = await prisma.election.count({ where: { name: 'Eleição com Escopos Contraditórios' } });
      expect(count).toBe(0);
    });

    it('9.2 Falha transacional em candidatos deve efetuar rollback completo de tudo', async () => {
      const payload = {
        name: 'Eleição Falha Candidato Rollback',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'ESTADUAL', stateAbbreviation: 'SC' }],
        rounds: [{ roundNumber: 1 }],
        offices: [{ code: '11', name: 'Prefeito' }],
        candidates: [
          {
            officeCode: '99', // Cargo 99 NÃO EXISTE em offices
            candidateNumber: '10',
            name: 'Candidato Erro',
            partyNumber: '10'
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/admin/wizard', {
        method: 'POST',
        headers: createAuthHeaders(adminCsrfToken),
        body: JSON.stringify(payload)
      });

      const res = await saveWizard(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('OFFICE_NOT_FOUND');

      // Garantir que a eleição NÃO foi persistida (rollback integral)
      const count = await prisma.election.count({ where: { name: 'Eleição Falha Candidato Rollback' } });
      expect(count).toBe(0);
    });
  });
});
