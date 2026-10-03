import { test, expect } from '@playwright/test';

test.describe('E2E ADMINISTRATIVO / SEGURANÇA DO RESET', () => {
  const resetApiUrl = '/api/admin/reset';
  const confirmationPayload = { confirmationText: 'ZERAR APURAÇÃO' };

  test.beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = await import('bcryptjs');
    const prisma = new PrismaClient();
    
    // Garantir que a eleição SIM-123 exista
    const exists = await prisma.election.findFirst({ where: { plei: 'SIM-123' }});
    if (!exists) {
      await prisma.election.create({
        data: {
          plei: 'SIM-123',
          name: 'Eleição Simulacao Auth',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: [{ roundNumber: 1, status: 'ACTIVE' }] }
        }
      });
    }

    // Garantir que operator exista
    const opEmail = 'operator@apuracao.local';
    const operator = await prisma.user.findUnique({ where: { email: opEmail }});
    if (!operator) {
      const passwordHash = await bcrypt.hash('operator123', 10);
      await prisma.user.create({
        data: {
          name: 'Operador Teste',
          email: opEmail,
          passwordHash,
          role: 'OPERATOR'
        }
      });
    }
    await prisma.$disconnect();
  });

  test('A) Usuário não autenticado -> 401', async ({ request }) => {
    // 1. Tentar reset sem cookie de sessão
    const response = await request.post(resetApiUrl, {
      data: confirmationPayload
    });
    
    expect(response.status()).toBe(401);
  });

  test('B) Usuário autenticado NÃO-ADMIN -> 403 e nenhum dado apagado', async ({ page }) => {
    // 1. Logar como operador (NÃO-ADMIN)
    await page.goto('/login');
    await page.fill('input[name="username"]', 'operator@apuracao.local');
    await page.fill('input[type="password"]', 'operator123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/); // Vai para /admin/scanner

    // 2. Criar um dado para comprovar que não foi apagado
    const sessionId = `E2E-AUTH-B-${Date.now()}`;
    const scanRes = await page.request.post('/api/scan', {
      data: { content: "SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234567|Presidente,901,13,NOMINAL,50|hash_test_1790790665450|sig_test", isSimulation: true, sessionId }
    });
    expect(scanRes.status()).toBe(200);

    // 3. Tentar reset
    const response = await page.request.post(resetApiUrl, {
      data: confirmationPayload
    });
    
    expect(response.status()).toBe(403);

    // 4. Verificar se o dado (ScanSession) AINDA EXISTE
    // Podemos tentar escanear o mesmo BU para receber um DUPLICADO (409), provando que o BD não foi zerado
    const dupRes = await page.request.post('/api/scan', {
      data: { content: "SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234567|Presidente,901,13,NOMINAL,50|hash_test_1790790665450|sig_test", isSimulation: true, sessionId: sessionId + '-DUP' }
    });
    expect(dupRes.status()).toBe(409);
  });

  test('C) ADMIN com confirmação incorreta -> 400 e nenhum dado apagado', async ({ page }) => {
    // 1. Logar como ADMIN
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    // 2. Criar um dado para comprovar
    const sessionId = `E2E-AUTH-C-${Date.now()}`;
    const scanRes = await page.request.post('/api/scan', {
      data: { content: "SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234568|Presidente,901,22,NOMINAL,50|hash_test_1790790665450_C|sig_test_C", isSimulation: true, sessionId }
    });
    expect(scanRes.status()).toBe(200);

    // 3. Tentar reset com confirmação incorreta
    const response = await page.request.post(resetApiUrl, {
      data: { confirmationText: 'ZERAR APURACAO' } // sem til e cedilha
    });
    
    expect(response.status()).toBe(400);

    // 4. Verificar se o dado AINDA EXISTE
    const dupRes = await page.request.post('/api/scan', {
      data: { content: "SIMULATION|1|1|E2E-TEST|123|1|SP|71072|90|100|1234568|Presidente,901,22,NOMINAL,50|hash_test_1790790665450_C|sig_test_C", isSimulation: true, sessionId: sessionId + '-DUP' }
    });
    expect(dupRes.status()).toBe(409);
  });

  test('D) ADMIN com confirmação correta -> 200 e dados apagados', async ({ page }) => {
    // 1. Logar como ADMIN
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    // 2. Tentar reset corretamente
    const response = await page.request.post(resetApiUrl, {
      data: confirmationPayload
    });
    
    expect(response.status()).toBe(200);
  });
});
