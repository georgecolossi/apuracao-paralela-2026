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

      const checkB = await prisma.election.findUnique({ where: { id: electionB.id } });
      expect(checkB?.status).toBe('ACTIVE');
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

  describe('7. Cobertura Distinta por Turno (Item 6 da Auditoria)', () => {
    it('7.1 Deve permitir configurar RoundCoverage distinto para o 1º e 2º turnos', async () => {
      const payload = {
        name: 'Eleição com Cobertura Distinta por Turno',
        year: 2024,
        type: 'MUNICIPAL',
        scopes: [{ scopeType: 'MUNICIPAL', stateAbbreviation: 'SC', municipalityOfficialCode: '80837' }],
        rounds: [
          { roundNumber: 1 },
          { roundNumber: 2 }
        ],
        offices: [{ code: '11', name: 'Prefeito' }],
        coverage: [
          {
            roundNumber: 1, // Apenas 1º turno
            municipalityOfficialCode: '80837',
            zoneNumber: '090',
            sectionNumber: '0001',
            expectedBUs: 1
          },
          {
            roundNumber: 2, // Apenas 2º turno
            municipalityOfficialCode: '80837',
            zoneNumber: '090',
            sectionNumber: '0002',
            expectedBUs: 1
          },
          {
            // Omitido: aplica a ambos os turnos
            municipalityOfficialCode: '80837',
            zoneNumber: '090',
            sectionNumber: '0003',
            expectedBUs: 1
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

      const rounds = await prisma.electionRound.findMany({
        where: { electionId },
        orderBy: { roundNumber: 'asc' },
        include: { coverage: { include: { pollingSection: true } } }
      });

      expect(rounds.length).toBe(2);

      // Turno 1 deve ter seções 0001 e 0003
      const t1Sections = rounds[0].coverage.map(c => c.pollingSection.sectionNumber).sort();
      expect(t1Sections).toEqual(['0001', '0003']);

      // Turno 2 deve ter seções 0002 e 0003
      const t2Sections = rounds[1].coverage.map(c => c.pollingSection.sectionNumber).sort();
      expect(t2Sections).toEqual(['0002', '0003']);

      // NUNCA promover automaticamente a HOMOLOGATED
      expect(rounds[0].coverageStatus).toBe('REGISTERED');
      expect(rounds[1].coverageStatus).toBe('REGISTERED');
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
