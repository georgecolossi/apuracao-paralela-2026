import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { getJwtSecret, requireAuthenticatedUser } from '@/lib/auth';
import { validatePasswordStrength, generateSecureRandomPassword } from '@/lib/validation/password';
import { validateCsrfProtection } from '@/lib/security/csrf';
import { GET as listUsers, POST as createUser } from '@/app/api/admin/users/route';
import { GET as getUser, PATCH as updateUser, DELETE as deleteUser } from '@/app/api/admin/users/[id]/route';
import { PATCH as updateStatus } from '@/app/api/admin/users/[id]/status/route';
import { POST as resetPassword } from '@/app/api/admin/users/[id]/reset-password/route';
import { POST as revokeSessions } from '@/app/api/admin/users/[id]/revoke-sessions/route';
import { POST as changePassword } from '@/app/api/admin/users/change-password/route';
import { POST as scanRoute } from '@/app/api/scan/route';
import { POST as confirmRoute } from '@/app/api/reports/[id]/confirm/route';
import { POST as cancelRoute } from '@/app/api/reports/[id]/cancel/route';

let activeTestSessionToken: string | undefined = undefined;

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === 'admin_session' && activeTestSessionToken) {
        return { name: 'admin_session', value: activeTestSessionToken };
      }
      return undefined;
    },
    set: vi.fn(),
    delete: vi.fn()
  }))
}));

describe('PR 2 — Gestão Administrativa de Usuários, RBAC e Segurança de Sessões', () => {
  let adminUser: any;
  let operatorUser: any;
  let viewerUser: any;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;

  const createAuthHeaders = (token: string, host = 'localhost:3000', origin = 'http://localhost:3000') => ({
    'Content-Type': 'application/json',
    'Host': host,
    'Origin': origin
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-key-for-pr2-user-management-32chars!';
    expect(process.env.DATABASE_URL).toContain('test.db');
  });

  beforeEach(async () => {
    activeTestSessionToken = undefined;

    // Limpa dados de usuários anteriores
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.user.deleteMany({});

    const passwordHash = await bcrypt.hash('SenhaForte123!', 10);

    // 1. Cria Admin inicial
    adminUser = await prisma.user.create({
      data: {
        name: 'Administrador Principal',
        email: 'admin@eleicao.local',
        passwordHash,
        role: 'ADMIN',
        isActive: true
      }
    });

    // 2. Cria Operador
    operatorUser = await prisma.user.create({
      data: {
        name: 'Operador Scanner',
        email: 'operador@eleicao.local',
        passwordHash,
        role: 'OPERATOR',
        isActive: true
      }
    });

    // 3. Cria Visualizador
    viewerUser = await prisma.user.create({
      data: {
        name: 'Auditor Visualizador',
        email: 'auditor@eleicao.local',
        passwordHash,
        role: 'VIEWER',
        isActive: true
      }
    });

    const secret = getJwtSecret();
    adminToken = jwt.sign({ userId: adminUser.id, role: adminUser.role }, secret, { expiresIn: '1h' });
    operatorToken = jwt.sign({ userId: operatorUser.id, role: operatorUser.role }, secret, { expiresIn: '1h' });
    viewerToken = jwt.sign({ userId: viewerUser.id, role: viewerUser.role }, secret, { expiresIn: '1h' });
  });

  describe('1. Validação de Senhas e Complexidade', () => {
    it('1.1 Deve rejeitar senhas com menos de 8 caracteres', () => {
      const res = validatePasswordStrength('Ab1!');
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('A senha deve ter no mínimo 8 caracteres.');
    });

    it('1.2 Deve rejeitar senhas sem letra maiúscula', () => {
      const res = validatePasswordStrength('senhaforte123!');
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('A senha deve conter pelo menos uma letra maiúscula.');
    });

    it('1.3 Deve rejeitar senhas sem número ou símbolo', () => {
      const res = validatePasswordStrength('SenhaForteSemNumero');
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('A senha deve conter pelo menos um número ou símbolo especial.');
    });

    it('1.4 Deve rejeitar senhas da lista de bloqueio comum', () => {
      const res = validatePasswordStrength('admin123');
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('A senha escolhida é excessivamente comum e insegura.');
    });

    it('1.5 Deve aprovar senha gerada dinamicamente pelo gerador seguro', () => {
      const pwd = generateSecureRandomPassword(16);
      expect(pwd.length).toBe(16);
      const res = validatePasswordStrength(pwd);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe('2. Criação de Usuários com RBAC (POST /api/admin/users)', () => {
    it('2.1 ADMIN deve conseguir criar novos usuários OPERATOR e VIEWER', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({
          name: 'Novo Operador',
          email: 'novo.operador@eleicao.local',
          password: 'SenhaValida987!',
          role: 'OPERATOR'
        })
      });

      const res = await createUser(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.user.name).toBe('Novo Operador');
      expect(data.user.email).toBe('novo.operador@eleicao.local');
      expect(data.user.role).toBe('OPERATOR');
      expect(data.user.passwordHash).toBeUndefined(); // Garante não-exposição de hash

      // Confirma registro de auditoria
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'USER_CREATED', identifiers: { contains: 'novo.operador@eleicao.local' } }
      });
      expect(audit).not.toBeNull();
      expect(audit?.userId).toBe(adminUser.id);
    });

    it('2.2 OPERATOR e VIEWER são proibidos de criar usuários (403)', async () => {
      const payload = {
        name: 'Tentativa Invasão',
        email: 'hacker@eleicao.local',
        password: 'SenhaForte123!',
        role: 'ADMIN'
      };

      activeTestSessionToken = operatorToken;
      const reqOp = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: createAuthHeaders(operatorToken),
        body: JSON.stringify(payload)
      });
      const resOp = await createUser(reqOp);
      expect(resOp.status).toBe(403);

      activeTestSessionToken = viewerToken;
      const reqView = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: createAuthHeaders(viewerToken),
        body: JSON.stringify(payload)
      });
      const resView = await createUser(reqView);
      expect(resView.status).toBe(403);
    });

    it('2.3 Rejeita email duplicado com 409', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({
          name: 'Duplicado',
          email: 'operador@eleicao.local', // Já existente
          password: 'SenhaValida987!',
          role: 'OPERATOR'
        })
      });

      const res = await createUser(req);
      expect(res.status).toBe(409);
    });
  });

  describe('3. Consulta e Listagem (GET /api/admin/users)', () => {
    it('3.1 ADMIN pode listar usuários e filtrar por papel', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request('http://localhost:3000/api/admin/users?role=OPERATOR', {
        method: 'GET',
        headers: createAuthHeaders(adminToken)
      });

      const res = await listUsers(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.users).toBeInstanceOf(Array);
      expect(data.users.every((u: any) => u.role === 'OPERATOR')).toBe(true);
      expect(data.users.every((u: any) => u.passwordHash === undefined)).toBe(true);
    });

    it('3.2 OPERATOR e VIEWER são proibidos de listar usuários (403)', async () => {
      activeTestSessionToken = operatorToken;
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'GET',
        headers: createAuthHeaders(operatorToken)
      });
      const res = await listUsers(req);
      expect(res.status).toBe(403);
    });
  });

  describe('4. Edição de Usuários (PATCH /api/admin/users/[id])', () => {
    it('4.1 ADMIN altera nome e papel de um operador com sucesso', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}`, {
        method: 'PATCH',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({
          name: 'Operador Promovido',
          role: 'ADMIN'
        })
      });

      const res = await updateUser(req, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.name).toBe('Operador Promovido');
      expect(data.user.role).toBe('ADMIN');

      const updated = await prisma.user.findUnique({ where: { id: operatorUser.id } });
      expect(updated?.name).toBe('Operador Promovido');
      expect(updated?.role).toBe('ADMIN');
    });

    it('4.2 Bloqueia rebaixamento do único ADMIN ativo (400)', async () => {
      // adminUser é o único ADMIN ativo no momento
      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${adminUser.id}`, {
        method: 'PATCH',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({
          role: 'OPERATOR'
        })
      });

      const res = await updateUser(req, { params: Promise.resolve({ id: adminUser.id }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('CANNOT_REMOVE_LAST_ADMIN');

      // Garante que o papel permaneceu ADMIN
      const stillAdmin = await prisma.user.findUnique({ where: { id: adminUser.id } });
      expect(stillAdmin?.role).toBe('ADMIN');
    });
  });

  describe('5. Ativação e Desativação (PATCH /api/admin/users/[id]/status)', () => {
    it('5.1 Bloqueia desativação do único ADMIN ativo', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${adminUser.id}/status`, {
        method: 'PATCH',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({ isActive: false })
      });

      const res = await updateStatus(req, { params: Promise.resolve({ id: adminUser.id }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('CANNOT_REMOVE_LAST_ADMIN');
    });

    it('5.2 Desativação de operador invalida imediatamente sessões ativas', async () => {
      // 1. Desativa o operador
      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}/status`, {
        method: 'PATCH',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({ isActive: false })
      });
      const res = await updateStatus(req, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(res.status).toBe(200);

      // 2. Operador tenta fazer operação com seu token antigo
      activeTestSessionToken = operatorToken;
      const authResult = await requireAuthenticatedUser();
      expect(authResult.authenticated).toBe(false);
      if (!authResult.authenticated) {
        expect(authResult.reason).toBe('USER_INACTIVE');
      }
    });
  });

  describe('6. Redefinição de Senha e Revogação Forçada de Sessões', () => {
    it('6.1 Redefinição de senha invalida tokens emitidos anteriormente', async () => {
      // Token gerado no passado antes da redefinição
      const oldToken = jwt.sign(
        { userId: operatorUser.id, role: operatorUser.role, iat: Math.floor(Date.now() / 1000) - 10 },
        getJwtSecret(),
        { expiresIn: '1h' }
      );

      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}/reset-password`, {
        method: 'POST',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({ newPassword: 'NovaSenhaSegura2026!' })
      });

      const res = await resetPassword(req, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(res.status).toBe(200);

      // Antigo token deve ser rejeitado por SESSION_REVOKED
      activeTestSessionToken = oldToken;
      const authCheck = await requireAuthenticatedUser();
      expect(authCheck.authenticated).toBe(false);
      if (!authCheck.authenticated) {
        expect(authCheck.reason).toBe('SESSION_REVOKED');
      }

      // Login com nova senha deve emitir token válido
      const updatedUser = await prisma.user.findUnique({ where: { id: operatorUser.id } });
      const passMatch = await bcrypt.compare('NovaSenhaSegura2026!', updatedUser!.passwordHash);
      expect(passMatch).toBe(true);
    });

    it('6.2 Endpoint POST /api/admin/users/[id]/revoke-sessions revoga sessões imediatamente', async () => {
      const preRevokeToken = jwt.sign(
        { userId: operatorUser.id, role: operatorUser.role, iat: Math.floor(Date.now() / 1000) - 10 },
        getJwtSecret(),
        { expiresIn: '1h' }
      );

      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}/revoke-sessions`, {
        method: 'POST',
        headers: createAuthHeaders(adminToken)
      });

      const res = await revokeSessions(req, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(res.status).toBe(200);

      activeTestSessionToken = preRevokeToken;
      const authCheck = await requireAuthenticatedUser();
      expect(authCheck.authenticated).toBe(false);
      if (!authCheck.authenticated) {
        expect(authCheck.reason).toBe('SESSION_REVOKED');
      }
    });
  });

  describe('7. Exclusão de Usuários e Preservação de Histórico', () => {
    it('7.1 Bloqueia exclusão do único ADMIN ativo', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${adminUser.id}`, {
        method: 'DELETE',
        headers: createAuthHeaders(adminToken)
      });

      const res = await deleteUser(req, { params: Promise.resolve({ id: adminUser.id }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('CANNOT_REMOVE_LAST_ADMIN');
    });

    it('7.2 Usuário sem histórico operacional é excluído fisicamente', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}`, {
        method: 'DELETE',
        headers: createAuthHeaders(adminToken)
      });

      const res = await deleteUser(req, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);

      const inDb = await prisma.user.findUnique({ where: { id: operatorUser.id } });
      expect(inDb).toBeNull();
    });

    it('7.3 Usuário com BUs vinculados tem exclusão convertida em desativação lógica segura', async () => {
      // Vincula um relatório ao operador
      let election = await prisma.election.findFirst();
      if (!election) {
        election = await prisma.election.create({
          data: {
            name: 'Eleição Teste',
            year: 2026,
            slug: 'eleicao-teste-' + Date.now(),
            plei: '2110',
            status: 'ACTIVE'
          }
        });
      }

      let round = await prisma.electionRound.findFirst({ where: { electionId: election.id } });
      if (!round) {
        round = await prisma.electionRound.create({
          data: {
            electionId: election.id,
            roundNumber: 1,
            plei: '2110',
            status: 'ACTIVE'
          }
        });
      }

      await prisma.ballotReport.create({
        data: {
          deterministicId: 'test-bu-for-user-' + Date.now(),
          electionId: election.id,
          roundId: round.id,
          stateCode: 'SC',
          cityCode: '80837',
          zoneCode: '0090',
          sectionCode: '0001',
          urnCode: '1',
          operatorId: operatorUser.id
        }
      });

      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}`, {
        method: 'DELETE',
        headers: createAuthHeaders(adminToken)
      });

      const res = await deleteUser(req, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(false);
      expect(data.deactivated).toBe(true);

      // O usuário permanece no banco, porém desativado
      const inDb = await prisma.user.findUnique({ where: { id: operatorUser.id } });
      expect(inDb).not.toBeNull();
      expect(inDb?.isActive).toBe(false);
    });
  });

  describe('8. Proteção contra CSRF e Riscos de Sessão', () => {
    it('8.1 Rejeita mutações com Origin diferente do Host (CSRF)', async () => {
      activeTestSessionToken = adminToken;
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Host': 'localhost:3000',
          'Origin': 'http://site-malicioso.com'
        },
        body: JSON.stringify({
          name: 'Tentativa CSRF',
          email: 'csrf@malicioso.com',
          password: 'SenhaForte123!',
          role: 'ADMIN'
        })
      });

      const res = await createUser(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.reason).toContain('ORIGIN_MISMATCH');
    });

    it('8.2 Rejeita mutações com Sec-Fetch-Site cross-site', () => {
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'Sec-Fetch-Site': 'cross-site'
        }
      });

      const csrf = validateCsrfProtection(req);
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toBe('CROSS_SITE_REQUEST_REJECTED');
    });
  });

  describe('9. Restrições de Perfil VIEWER em Rotas Operacionais', () => {
    it('9.1 VIEWER é bloqueado de submeter BUs no /api/scan (403)', async () => {
      activeTestSessionToken = viewerToken;
      const req = new Request('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'fake-qr', sessionId: 'ses-1' })
      });

      const res = await scanRoute(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('FORBIDDEN_ROLE');
    });

    it('9.2 VIEWER é bloqueado de confirmar BUs em /api/reports/[id]/confirm (403)', async () => {
      activeTestSessionToken = viewerToken;
      const req = new Request('http://localhost:3000/api/reports/fake-id/confirm', {
        method: 'POST'
      });

      const res = await confirmRoute(req, { params: Promise.resolve({ id: 'fake-id' }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('FORBIDDEN_ROLE');
    });

    it('9.3 VIEWER é bloqueado de cancelar BUs em /api/reports/[id]/cancel (403)', async () => {
      activeTestSessionToken = viewerToken;
      const req = new Request('http://localhost:3000/api/reports/fake-id/cancel', {
        method: 'POST'
      });

      const res = await cancelRoute(req, { params: Promise.resolve({ id: 'fake-id' }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('10. Concorrência: Proteção contra Desativação Simultânea de Administradores', () => {
    it('10.1 Duas requisições simultâneas para desativar os únicos 2 admins mantêm 1 ativo', async () => {
      // Cria um segundo admin
      const secondAdmin = await prisma.user.create({
        data: {
          name: 'Segundo Administrador',
          email: 'admin2@eleicao.local',
          passwordHash: adminUser.passwordHash,
          role: 'ADMIN',
          isActive: true
        }
      });

      activeTestSessionToken = adminToken;

      // Tenta desativar ambos simultaneamente
      const p1 = updateStatus(
        new Request(`http://localhost:3000/api/admin/users/${adminUser.id}/status`, {
          method: 'PATCH',
          headers: createAuthHeaders(adminToken),
          body: JSON.stringify({ isActive: false })
        }),
        { params: Promise.resolve({ id: adminUser.id }) }
      );

      const p2 = updateStatus(
        new Request(`http://localhost:3000/api/admin/users/${secondAdmin.id}/status`, {
          method: 'PATCH',
          headers: createAuthHeaders(adminToken),
          body: JSON.stringify({ isActive: false })
        }),
        { params: Promise.resolve({ id: secondAdmin.id }) }
      );

      const [res1, res2] = await Promise.all([p1, p2]);
      const statuses = [res1.status, res2.status];

      // Pelo menos uma deve falhar ou no banco deve restar pelo menos 1 ADMIN ativo
      const remainingAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true }
      });
      expect(remainingAdmins).toBeGreaterThanOrEqual(1);
    });
  });
});
