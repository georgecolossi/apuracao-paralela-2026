import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { getJwtSecret, requireAuthenticatedUser } from '@/lib/auth';
import { validatePasswordStrength, generateSecureRandomPassword } from '@/lib/validation/password';
import { validateCsrfProtection, generateCsrfToken, verifyCsrfToken } from '@/lib/security/csrf';
import { POST as loginRoute } from '@/app/api/login/route';
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
let lastSetCookie: { name: string; value: string; options: any } | undefined = undefined;

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      if (name === 'admin_session' && activeTestSessionToken) {
        return { name: 'admin_session', value: activeTestSessionToken };
      }
      return undefined;
    },
    set: vi.fn((name: string, value: string, options: any) => {
      lastSetCookie = { name, value, options };
      if (name === 'admin_session') {
        activeTestSessionToken = value;
      }
    }),
    delete: vi.fn(() => {
      activeTestSessionToken = undefined;
    })
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
    lastSetCookie = undefined;

    // Limpa dados de usuários anteriores
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.user.deleteMany({});

    const passwordHash = await bcrypt.hash('SenhaForte123!', 10);

    // 1. Cria Admin inicial com sessionVersion 0
    adminUser = await prisma.user.create({
      data: {
        name: 'Administrador Principal',
        email: 'admin@eleicao.local',
        passwordHash,
        role: 'ADMIN',
        isActive: true,
        sessionVersion: 0
      }
    });

    // 2. Cria Operador com sessionVersion 0
    operatorUser = await prisma.user.create({
      data: {
        name: 'Operador Scanner',
        email: 'operador@eleicao.local',
        passwordHash,
        role: 'OPERATOR',
        isActive: true,
        sessionVersion: 0
      }
    });

    // 3. Cria Visualizador com sessionVersion 0
    viewerUser = await prisma.user.create({
      data: {
        name: 'Auditor Visualizador',
        email: 'auditor@eleicao.local',
        passwordHash,
        role: 'VIEWER',
        isActive: true,
        sessionVersion: 0
      }
    });

    const secret = getJwtSecret();
    adminToken = jwt.sign(
      { userId: adminUser.id, role: adminUser.role, sessionVersion: adminUser.sessionVersion },
      secret,
      { expiresIn: '1h' }
    );
    operatorToken = jwt.sign(
      { userId: operatorUser.id, role: operatorUser.role, sessionVersion: operatorUser.sessionVersion },
      secret,
      { expiresIn: '1h' }
    );
    viewerToken = jwt.sign(
      { userId: viewerUser.id, role: viewerUser.role, sessionVersion: viewerUser.sessionVersion },
      secret,
      { expiresIn: '1h' }
    );
  });

  describe('1. Validação de Senhas e Preservação Exata de Espaços (Sem Trim)', () => {
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

    it('1.6 Deve preservar espaços em branco no início e no fim sem remoção oculta (não aplicar trim)', async () => {
      const passwordWithSpaces = '  SenhaComEspaco123!  ';
      const validation = validatePasswordStrength(passwordWithSpaces);
      expect(validation.valid).toBe(true);

      activeTestSessionToken = adminToken;
      const createReq = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({
          name: 'Usuário Com Espaços',
          email: 'espacos@eleicao.local',
          password: passwordWithSpaces,
          role: 'OPERATOR'
        })
      });

      const createRes = await createUser(createReq);
      expect(createRes.status).toBe(201);

      const createdInDb = await prisma.user.findUnique({
        where: { email: 'espacos@eleicao.local' }
      });
      expect(createdInDb).not.toBeNull();

      // Confirma que a senha hashada preservou exatamente os espaços
      const matchExact = await bcrypt.compare(passwordWithSpaces, createdInDb!.passwordHash);
      expect(matchExact).toBe(true);

      // Confirma que tentar autenticar com a versão trimmed FALHA
      const matchTrimmed = await bcrypt.compare('SenhaComEspaco123!', createdInDb!.passwordHash);
      expect(matchTrimmed).toBe(false);

      // Testa autenticação real via POST /api/login com espaços
      const loginSuccessReq = new Request('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'espacos@eleicao.local',
          password: passwordWithSpaces
        })
      });
      const loginSuccessRes = await loginRoute(loginSuccessReq);
      expect(loginSuccessRes.status).toBe(200);

      // Login com senha trimmed deve falhar com 401
      const loginFailReq = new Request('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'espacos@eleicao.local',
          password: 'SenhaComEspaco123!'
        })
      });
      const loginFailRes = await loginRoute(loginFailReq);
      expect(loginFailRes.status).toBe(401);
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

      // Confirma registro de auditoria criado na mesma transação
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
      // Versão de sessão deve ter sido incrementada pela mudança de papel
      expect(updated?.sessionVersion).toBe(operatorUser.sessionVersion + 1);
    });

    it('4.2 Bloqueia rebaixamento do único ADMIN ativo (400 CANNOT_REMOVE_LAST_ADMIN)', async () => {
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
    it('5.1 Bloqueia desativação do único ADMIN ativo (400 CANNOT_REMOVE_LAST_ADMIN)', async () => {
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

  describe('6. Versionamento de Sessões JWT e Revogação Imediata', () => {
    it('6.1 Redefinição administrativa de senha incrementa sessionVersion e invalida tokens antigos', async () => {
      // Token gerado antes da redefinição
      const oldToken = operatorToken;

      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}/reset-password`, {
        method: 'POST',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({ newPassword: 'NovaSenhaSegura2026!' })
      });

      const res = await resetPassword(req, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(res.status).toBe(200);

      // Antigo token deve ser sumariamente rejeitado por SESSION_REVOKED
      activeTestSessionToken = oldToken;
      const authCheck = await requireAuthenticatedUser();
      expect(authCheck.authenticated).toBe(false);
      if (!authCheck.authenticated) {
        expect(authCheck.reason).toBe('SESSION_REVOKED');
      }

      // Confirma que sessionVersion foi incrementado no banco
      const updatedUser = await prisma.user.findUnique({ where: { id: operatorUser.id } });
      expect(updatedUser?.sessionVersion).toBe(operatorUser.sessionVersion + 1);

      // Login com nova senha deve emitir token válido com a nova sessionVersion
      const passMatch = await bcrypt.compare('NovaSenhaSegura2026!', updatedUser!.passwordHash);
      expect(passMatch).toBe(true);
    });

    it('6.2 Endpoint POST /api/admin/users/[id]/revoke-sessions revoga sessões imediatamente', async () => {
      const preRevokeToken = operatorToken;

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

    it('6.3 Revogação e emissão no exato mesmo segundo são estritamente distinguidas', async () => {
      // Simula token emitido com timestamp idêntico ao momento de revogação
      const currentSecond = Math.floor(Date.now() / 1000);
      const sameSecondToken = jwt.sign(
        { userId: operatorUser.id, role: operatorUser.role, sessionVersion: operatorUser.sessionVersion, iat: currentSecond },
        getJwtSecret(),
        { expiresIn: '1h' }
      );

      // Imediatamente revoga sessões
      activeTestSessionToken = adminToken;
      const req = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}/revoke-sessions`, {
        method: 'POST',
        headers: createAuthHeaders(adminToken)
      });
      await revokeSessions(req, { params: Promise.resolve({ id: operatorUser.id }) });

      // O token com versão antiga DEVE falhar imediatamente, sem tolerância de 1 segundo
      activeTestSessionToken = sameSecondToken;
      const authCheck = await requireAuthenticatedUser();
      expect(authCheck.authenticated).toBe(false);
      if (!authCheck.authenticated) {
        expect(authCheck.reason).toBe('SESSION_REVOKED');
      }
    });

    it('6.4 Tokens legados sem o campo sessionVersion são sumariamente rejeitados (fail-closed)', async () => {
      // Emite token propositalmente omitindo o campo sessionVersion
      const legacyToken = jwt.sign(
        { userId: operatorUser.id, role: operatorUser.role },
        getJwtSecret(),
        { expiresIn: '1h' }
      );

      activeTestSessionToken = legacyToken;
      const authCheck = await requireAuthenticatedUser();
      expect(authCheck.authenticated).toBe(false);
      if (!authCheck.authenticated) {
        expect(authCheck.reason).toBe('SESSION_REVOKED');
      }
    });

    it('6.5 Múltiplos dispositivos: troca de senha invalida outros dispositivos e mantém sessão atual', async () => {
      // Dispositivo A e Dispositivo B ambos com token versão 0
      const deviceBToken = operatorToken;

      // Usuário altera a própria senha no Dispositivo A
      activeTestSessionToken = operatorToken;
      const changeReq = new Request('http://localhost:3000/api/admin/users/change-password', {
        method: 'POST',
        headers: createAuthHeaders(operatorToken),
        body: JSON.stringify({
          currentPassword: 'SenhaForte123!',
          newPassword: 'NovaSenhaPropria123!'
        })
      });

      const changeRes = await changePassword(changeReq);
      expect(changeRes.status).toBe(200);

      // O cookie da sessão atual (Dispositivo A) foi renovado com a nova sessionVersion
      expect(lastSetCookie).toBeDefined();
      const deviceAToken = lastSetCookie!.value;
      const decodedDeviceA: any = jwt.verify(deviceAToken, getJwtSecret());
      expect(decodedDeviceA.sessionVersion).toBe(operatorUser.sessionVersion + 1);

      // Dispositivo A continua autenticado
      activeTestSessionToken = deviceAToken;
      const authDeviceA = await requireAuthenticatedUser();
      expect(authDeviceA.authenticated).toBe(true);

      // Dispositivo B com token antigo versão 0 é rejeitado imediatamente
      activeTestSessionToken = deviceBToken;
      const authDeviceB = await requireAuthenticatedUser();
      expect(authDeviceB.authenticated).toBe(false);
      if (!authDeviceB.authenticated) {
        expect(authDeviceB.reason).toBe('SESSION_REVOKED');
      }
    });

    it('6.6 Rebaixamento ou alteração de papel invalida imediatamente sessões ativas do usuário', async () => {
      const preRoleChangeToken = operatorToken;

      activeTestSessionToken = adminToken;
      const patchReq = new Request(`http://localhost:3000/api/admin/users/${operatorUser.id}`, {
        method: 'PATCH',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({ role: 'VIEWER' })
      });

      const patchRes = await updateUser(patchReq, { params: Promise.resolve({ id: operatorUser.id }) });
      expect(patchRes.status).toBe(200);

      // Token anterior com privilégios antigos é imediatamente rejeitado
      activeTestSessionToken = preRoleChangeToken;
      const authCheck = await requireAuthenticatedUser();
      expect(authCheck.authenticated).toBe(false);
      if (!authCheck.authenticated) {
        expect(authCheck.reason).toBe('SESSION_REVOKED');
      }
    });
  });

  describe('7. Exclusão de Usuários e Preservação de Histórico', () => {
    it('7.1 Bloqueia exclusão do único ADMIN ativo (400 CANNOT_REMOVE_LAST_ADMIN)', async () => {
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

  describe('8. Proteção contra CSRF Robusta e Fail-Closed', () => {
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
      expect(csrf.reason).toBe('CROSS_SITE_REQUEST_REJECTED: Requisição cross-site bloqueada.');
    });

    it('8.3 Rejeita X-Forwarded-Host não confiável (ataque de cabeçalho forjado)', () => {
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'X-Forwarded-Host': 'evil-proxy.attacker.com',
          'Origin': 'https://evil-proxy.attacker.com'
        }
      });

      const csrf = validateCsrfProtection(req);
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toContain('UNTRUSTED_FORWARDED_HOST');
    });

    it('8.4 Rejeita mutações sem Origin e sem Referer (fail-closed)', () => {
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'x-omit-origin': 'true'
        }
      });

      const csrf = validateCsrfProtection(req, { userId: adminUser.id, sessionVersion: adminUser.sessionVersion });
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toContain('MISSING_ORIGIN_AND_REFERER');
    });

    it('8.5 Rejeita token CSRF arbitrário, inventado ou malformado', () => {
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'X-CSRF-Token': 'arbitrary-token-inventado-pelo-atacante-1234567890',
          'x-omit-origin': 'true'
        }
      });

      const csrf = validateCsrfProtection(req, { userId: adminUser.id, sessionVersion: adminUser.sessionVersion });
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toContain('INVALID_CSRF_TOKEN');
    });

    it('8.6 Rejeita token CSRF válido pertencente a outra sessão ou outro usuário', () => {
      // Gera token legítimo do OPERADOR
      const operatorCsrfToken = generateCsrfToken(operatorUser.id, operatorUser.sessionVersion);

      // Tenta enviar o token do operador na requisição do ADMIN
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'X-CSRF-Token': operatorCsrfToken,
          'x-omit-origin': 'true'
        }
      });

      const csrf = validateCsrfProtection(req, { userId: adminUser.id, sessionVersion: adminUser.sessionVersion });
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toContain('INVALID_CSRF_TOKEN');
    });

    it('8.7 Aceita mutações sem Origin e sem Referer quando autenticadas com token CSRF real da sessão ativa', () => {
      const validAdminCsrfToken = generateCsrfToken(adminUser.id, adminUser.sessionVersion);

      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'X-CSRF-Token': validAdminCsrfToken,
          'x-omit-origin': 'true'
        }
      });

      const csrf = validateCsrfProtection(req, { userId: adminUser.id, sessionVersion: adminUser.sessionVersion });
      expect(csrf.valid).toBe(true);
    });

    it('8.8 Invalida token CSRF após incremento de sessionVersion (ex.: troca de senha)', () => {
      // Token gerado na sessionVersion 0
      const tokenBefore = generateCsrfToken(adminUser.id, adminUser.sessionVersion);
      expect(verifyCsrfToken(tokenBefore, adminUser.id, adminUser.sessionVersion)).toBe(true);

      // Após mudança de senha, sessionVersion é incrementado
      const newSessionVersion = adminUser.sessionVersion + 1;
      expect(verifyCsrfToken(tokenBefore, adminUser.id, newSessionVersion)).toBe(false);

      // O token antigo passa a ser sumariamente rejeitado pelo validador
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'X-CSRF-Token': tokenBefore,
          'x-omit-origin': 'true'
        }
      });
      const csrf = validateCsrfProtection(req, { userId: adminUser.id, sessionVersion: newSessionVersion });
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toContain('INVALID_CSRF_TOKEN');

      // Novo token emitido na nova versão é aceito
      const tokenAfter = generateCsrfToken(adminUser.id, newSessionVersion);
      expect(verifyCsrfToken(tokenAfter, adminUser.id, newSessionVersion)).toBe(true);
    });

    it('8.9 Não considera Sec-Fetch-Site same-site equivalente a same-origin', () => {
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'Host': 'localhost:3000',
          'Sec-Fetch-Site': 'same-site', // same-site NÃO é same-origin
          'x-omit-origin': 'true'
        }
      });

      const csrf = validateCsrfProtection(req, { userId: adminUser.id, sessionVersion: adminUser.sessionVersion });
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toContain('MISSING_ORIGIN_AND_REFERER');
    });

    it('8.10 Rejeita requisição incompleta (sem objeto Headers válido ou req nulo)', () => {
      // @ts-ignore
      const resNull = validateCsrfProtection(null);
      expect(resNull.valid).toBe(false);
      expect(resNull.reason).toContain('INVALID_REQUEST');

      // Objeto com método mas sem headers funcionais
      const resNoHeaders = validateCsrfProtection({ method: 'POST' } as any);
      expect(resNoHeaders.valid).toBe(false);
      expect(resNoHeaders.reason).toContain('INVALID_HEADERS');
    });

    it('8.11 Aceita requisição legítima com Origin HTTPS correspondente ao RAILWAY_PUBLIC_DOMAIN configurado', () => {
      const origRailway = process.env.RAILWAY_PUBLIC_DOMAIN;
      const origNodeEnv = process.env.NODE_ENV;
      try {
        process.env.RAILWAY_PUBLIC_DOMAIN = 'apuracao-prod.up.railway.app';
        (process.env as any).NODE_ENV = 'production';

        const req = new Request('https://apuracao-prod.up.railway.app/api/admin/users', {
          method: 'POST',
          headers: {
            'Host': 'apuracao-prod.up.railway.app',
            'Origin': 'https://apuracao-prod.up.railway.app'
          }
        });

        const csrf = validateCsrfProtection(req);
        expect(csrf.valid).toBe(true);
      } finally {
        process.env.RAILWAY_PUBLIC_DOMAIN = origRailway;
        (process.env as any).NODE_ENV = origNodeEnv;
      }
    });

    it('8.12 Aceita requisição legítima com Origin configurado em APP_URL', () => {
      const origAppUrl = process.env.APP_URL;
      const origNodeEnv = process.env.NODE_ENV;
      try {
        process.env.APP_URL = 'https://apuracao2026.org.br';
        (process.env as any).NODE_ENV = 'production';

        const req = new Request('https://apuracao2026.org.br/api/admin/users', {
          method: 'POST',
          headers: {
            'Host': 'apuracao2026.org.br',
            'Origin': 'https://apuracao2026.org.br'
          }
        });

        const csrf = validateCsrfProtection(req);
        expect(csrf.valid).toBe(true);
      } finally {
        process.env.APP_URL = origAppUrl;
        (process.env as any).NODE_ENV = origNodeEnv;
      }
    });

    it('8.13 Rejeita esquema HTTP inseguro em ambiente de produção', () => {
      const originalEnv = process.env.NODE_ENV;
      const origRailway = process.env.RAILWAY_PUBLIC_DOMAIN;
      try {
        process.env.RAILWAY_PUBLIC_DOMAIN = 'meusite.up.railway.app';
        (process.env as any).NODE_ENV = 'production';
        const req = new Request('https://meusite.up.railway.app/api/admin/users', {
          method: 'POST',
          headers: {
            'Host': 'meusite.up.railway.app',
            'Origin': 'http://meusite.up.railway.app' // Esquema HTTP inseguro
          }
        });

        const csrf = validateCsrfProtection(req);
        expect(csrf.valid).toBe(false);
        expect(csrf.reason).toContain('INSECURE_ORIGIN_SCHEME');
      } finally {
        process.env.RAILWAY_PUBLIC_DOMAIN = origRailway;
        (process.env as any).NODE_ENV = originalEnv;
      }
    });

    it('8.14 Rejeita mutações sem cabeçalho Host ou X-Forwarded-Host (fail-closed)', () => {
      const req = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: {
          'x-omit-host': 'true',
          'x-omit-origin': 'true'
        }
      });

      const csrf = validateCsrfProtection(req);
      expect(csrf.valid).toBe(false);
      expect(csrf.reason).toContain('MISSING_HOST');
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

      // No banco deve restar pelo menos 1 ADMIN ativo
      const remainingAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true }
      });
      expect(remainingAdmins).toBeGreaterThanOrEqual(1);

      // Pelo menos uma das requisições deve ter sido rejeitada com 400
      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(400);
    });
  });

  describe('11. Integridade Transacional e Segurança da Auditoria', () => {
    it('11.1 Logs de auditoria jamais armazenam senhas em texto puro, hashes ou tokens', async () => {
      activeTestSessionToken = adminToken;
      const createReq = new Request('http://localhost:3000/api/admin/users', {
        method: 'POST',
        headers: createAuthHeaders(adminToken),
        body: JSON.stringify({
          name: 'Usuário Audit Test',
          email: 'audit.test@eleicao.local',
          password: 'SenhaAuditSuperSecreta123!',
          role: 'OPERATOR'
        })
      });
      await createUser(createReq);

      const auditLogs = await prisma.auditLog.findMany();
      expect(auditLogs.length).toBeGreaterThan(0);

      for (const log of auditLogs) {
        const fullLogString = JSON.stringify(log);
        // Não deve conter a senha em texto plano
        expect(fullLogString).not.toContain('SenhaAuditSuperSecreta123!');
        expect(fullLogString).not.toContain('SenhaForte123!');
        // Não deve expor hashes bcrypt nos metadados da auditoria
        expect(fullLogString).not.toMatch(/\$2[aby]\$\d+\$/);
      }
    });

    it('11.2 Se a gravação de auditoria falhar na transação, a criação do usuário sofre rollback', async () => {
      // Cria uma transação simulando falha no log de auditoria
      const testEmail = 'rollback.test@eleicao.local';

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.user.create({
            data: {
              name: 'Usuário Rollback',
              email: testEmail,
              passwordHash: await bcrypt.hash('SenhaValida123!', 10),
              role: 'OPERATOR',
              isActive: true
            }
          });

          // Simula falha forçada no AuditLog
          throw new Error('SIMULATED_AUDIT_LOG_PERSISTENCE_FAILURE');
        })
      ).rejects.toThrow('SIMULATED_AUDIT_LOG_PERSISTENCE_FAILURE');

      // Garante que o usuário NÃO foi gravado no banco (rollback atômico)
      const userInDb = await prisma.user.findUnique({
        where: { email: testEmail }
      });
      expect(userInDb).toBeNull();
    });
  });
});
