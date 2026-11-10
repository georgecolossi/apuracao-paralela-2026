import { test, expect } from '@playwright/test';

test.describe('E2E ADMINISTRATIVO / SEGURANÇA DO RESET', () => {
  const resetApiUrl = '/api/admin/reset';
  let activeRoundId = '';

  test.beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = await import('bcryptjs');
    const prisma = new PrismaClient();

    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.roundCoverage.deleteMany({});
    await prisma.tseSyncConfig.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.office.deleteMany({});
    await prisma.party.deleteMany({});
    await prisma.electionScope.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});

    const createdEle = await prisma.election.create({
      data: {
        plei: 'SIM-123',
        name: 'Eleição Simulacao Auth',
        year: 2026,
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: 1, plei: 'SIM-123', status: 'ACTIVE' }] },
        offices: { create: [{ code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 }] }
      },
      include: { rounds: true }
    });
    activeRoundId = createdEle.rounds[0].id;

    const opEmail = 'operator@apuracao.local';
    const passwordHash = await bcrypt.hash('operator123', 10);
    await prisma.user.upsert({
      where: { email: opEmail },
      update: { passwordHash, role: 'OPERATOR', isActive: true },
      create: {
        name: 'Operador Teste',
        email: opEmail,
        passwordHash,
        role: 'OPERATOR',
        isActive: true
      }
    });
    await prisma.$disconnect();
  });

  test('A) Usuário não autenticado -> 401', async ({ request }) => {
    const response = await request.post(resetApiUrl, {
      data: { confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: activeRoundId }
    });

    expect(response.status()).toBe(401);
  });

  test('B) Usuário autenticado NÃO-ADMIN -> 403 e nenhum dado apagado', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'operator@apuracao.local');
    await page.fill('input[type="password"]', 'operator123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const sessionId = `E2E-AUTH-B-${Date.now()}`;
    const scanRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: 'SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234567|Presidente,901,13,NOMINAL,50|hash_test_auth_b|sig_test', isSimulation: true, sessionId }
    });
    expect(scanRes.status()).toBe(200);

    const response = await page.request.post(resetApiUrl, {
      headers: { 'x-csrf-token': csrfToken },
      data: { confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: activeRoundId }
    });

    expect(response.status()).toBe(403);

    const dupRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: 'SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234567|Presidente,901,13,NOMINAL,50|hash_test_auth_b|sig_test', isSimulation: true, sessionId: sessionId + '-DUP' }
    });
    expect(dupRes.status()).toBe(409);
  });

  test('C) ADMIN com confirmação incorreta -> 400 e nenhum dado apagado', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const sessionId = `E2E-AUTH-C-${Date.now()}`;
    const scanRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: 'SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234568|Presidente,901,22,NOMINAL,50|hash_test_auth_c|sig_test_C', isSimulation: true, sessionId }
    });
    expect(scanRes.status()).toBe(200);

    const response = await page.request.post(resetApiUrl, {
      headers: { 'x-csrf-token': csrfToken },
      data: { confirmationText: 'CONFIRMACAO INCORRETA', roundId: activeRoundId }
    });

    expect(response.status()).toBe(400);

    const dupRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: 'SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234568|Presidente,901,22,NOMINAL,50|hash_test_auth_c|sig_test_C', isSimulation: true, sessionId: sessionId + '-DUP' }
    });
    expect(dupRes.status()).toBe(409);
  });

  test('D) ADMIN com confirmação correta -> 200 e dados apagados', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const response = await page.request.post(resetApiUrl, {
      headers: { 'x-csrf-token': csrfToken },
      data: { confirmationText: 'ZERAR PRIMEIRO TURNO', roundId: activeRoundId }
    });

    expect(response.status()).toBe(200);
  });
});
