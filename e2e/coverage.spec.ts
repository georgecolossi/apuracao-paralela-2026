import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('E2E ADMINISTRATIVO / COBERTURA GEOGRÁFICA', () => {
  const sessionId = `E2E-COV-${Date.now()}`;

  test.beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const exists = await prisma.election.findFirst({ where: { plei: '2202' }});
    if (!exists) {
      await prisma.election.create({
        data: {
          plei: '2202',
          name: 'Eleição Acrelandia',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: [{ roundNumber: 1, status: 'ACTIVE' }, { roundNumber: 2, status: 'ACTIVE' }] }
        }
      });
    }
    await prisma.$disconnect();
  });
  
  test('A) Rejeitar BU fora da cobertura', async ({ page }) => {
    // 1. Logar
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    // MUNI 99999 será bloqueado (a config aceita 1392, SAO PAULO, 80879)
    const outOfCoveragePayload = "SIMULATION|1|1|E2E-TEST|123|1|SC|99999|90|100|1234567|Presidente,901,13,NOMINAL,50|hash_test|sig_test";
    
    const scanRes = await page.request.post('/api/scan', {
      data: { content: outOfCoveragePayload, isSimulation: true, sessionId: sessionId + '-OUT' }
    });
    
    // Na configuração que injetaremos no webServer (ou simulando),
    // 80879 não deve estar lá, então é 403.
    expect(scanRes.status()).toBe(403);
    const data = await scanRes.json();
    expect(data.error).toBe('OUT_OF_COVERAGE');
  });

  test('B) Aceitar BU dentro da cobertura (oficial TSE AC)', async ({ page }) => {
    // 1. Logar
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    // 2. Ler o BU oficial (MUNI: 1392)
    const examplesDir = path.join(__dirname, '../tests/fixtures/tse-2026/official/examples');
    const qrbuContent = fs.readFileSync(path.join(examplesDir, 'Pres-T2_s02202ac0139200090013-imgbu', 'decoded', 'qrbu-01-of-01.txt'), 'utf-8');
    
    const scanRes = await page.request.post('/api/scan', {
      data: { content: qrbuContent, isSimulation: false, sessionId: sessionId + '-IN' }
    });
    
    // 1392 está no COVERAGE_CITY_CODES, então passa
    expect([200, 400, 409]).toContain(scanRes.status());
  });
});
