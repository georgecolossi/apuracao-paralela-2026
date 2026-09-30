import { test, expect } from '@playwright/test';

test.describe('E2E ADMINISTRATIVO / RESET DA APURAÇÃO', () => {
  let sessionId = `E2E-RESET-${Date.now()}`;
  
  test.beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    // Garantir que a eleição de simulação exista
    const exists = await prisma.election.findFirst({ where: { plei: 'SIM-123' }});
    if (!exists) {
      await prisma.election.create({
        data: {
          plei: 'SIM-123',
          name: 'Eleição Simulacao Reset',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: [{ roundNumber: 1, status: 'ACTIVE' }] }
        }
      });
    }
  });

  test('Deve zerar a apuração e permitir novo fluxo', async ({ page, request }) => {
    const initialPayload = "SIMULATION|1|1|E2E-TEST|123|1|SC|80879|90|100|1234567|Presidente,901,13,NOMINAL,50;Presidente,902,22,NOMINAL,40|hash_test|sig_test";
    
    // Login
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    // Post to API directly
    const scanRes = await page.request.post('/api/scan', {
      data: { content: initialPayload, isSimulation: true, sessionId: sessionId + '-A' }
    });
    
    // Executar Preparação (Reset)
    await page.goto('/admin/preparar');
    await expect(page.locator('text=Atenção: Operação Irreversível')).toBeVisible();
    
    // Tentativa incorreta
    await page.fill('input[placeholder="ZERAR APURAÇÃO"]', 'ZERAR');
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    
    // Tentativa correta
    await page.fill('input[placeholder="ZERAR APURAÇÃO"]', 'ZERAR APURAÇÃO');
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    await page.click('button[type="submit"]');
    
    // Redirects to apuracao and shows empty state
    await expect(page).toHaveURL('/apuracao', { timeout: 10000 });
    await expect(page.locator('text=A apuração ainda não iniciou')).toBeVisible();

    // 3. Processar o BU novamente (Deve funcionar porque o BD foi zerado)
    const newScanRes = await page.request.post('/api/scan', {
      data: { content: initialPayload, isSimulation: true, sessionId: sessionId + '-B' }
    });
    expect(newScanRes.status()).toBe(200);
    const newScanData = await newScanRes.json();
    const newReportId = newScanData.reportId;
    
    // Confirma
    const confRes = await page.request.post(`/api/reports/${newReportId}/confirm`);
    expect(confRes.status()).toBe(200);
    
    // Total atualizado
    await page.goto('/apuracao');
    

    // 4. Testar Duplicidade (O mecanismo continua funcionando no novo ciclo)
    const dupScanRes = await page.request.post('/api/scan', {
      data: { content: initialPayload, isSimulation: true, sessionId: sessionId + '-C' }
    });
    expect(dupScanRes.status()).toBe(409);
    const dupScanData = await dupScanRes.json();
    expect(dupScanData.status).toBe('DUPLICADO');
  });
});
