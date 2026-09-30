import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('TSE 2026 SYNTHETIC FIXTURE E2E', () => {
  test.beforeAll(async () => {
    // Limpa o BU caso já exista de execuções anteriores, pois a identidade é determinística e a fixture é constante
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.ballotReport.deleteMany({
      where: { deterministicId: '123-1-SP-71072-0001-0001-1234567' }
    });
    await prisma.$disconnect();
  });

  test('Fluxo completo usando payload SINTÉTICO (ZIP oficial bloqueado)', async ({ request, page }) => {
    // Carrega a fixture derivada (sintética)
    const p1Path = path.join(__dirname, '../tests/fixtures/tse-2026/derived-invalid/bu-example-part1.txt');
    const p2Path = path.join(__dirname, '../tests/fixtures/tse-2026/derived-invalid/bu-example-part2.txt');
    
    // Na vida real o scanner lerá o código puro, mas já passaremos os conteudos puros (sem quebra de linha extra)
    const p1 = fs.readFileSync(p1Path, 'utf8').trim();
    const p2 = fs.readFileSync(p2Path, 'utf8').trim();

    // 0. Verifica Segurança da API
    const unauthorizedScan = await request.post('/api/scan', {
      data: { content: 'TEST', isSimulation: true }
    });
    expect(unauthorizedScan.status()).toBe(401);

    // 1. Login
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    const sessionId = `E2E-OFFICIAL-${Date.now()}`;

    // 2. Scan Parte 1
    const scanPart1 = await page.request.post('/api/scan', {
      data: {
        content: p1,
        isSimulation: false, // OBRIGATÓRIO SER FALSE PRA FLUXO REAL
        sessionId
      }
    });
    expect(scanPart1.status()).toBe(200);
    const res1 = await scanPart1.json();
    expect(res1.status).toBe('PARCIAL');

    // 3. Scan Parte 2
    const scanPart2 = await page.request.post('/api/scan', {
      data: {
        content: p2,
        isSimulation: false,
        sessionId
      }
    });
    const res2 = await scanPart2.json();
    if (scanPart2.status() !== 200) console.log(res2);
    expect(scanPart2.status()).toBe(200);
    expect(res2.status).toBe('COMPLETO');
    const reportId = res2.reportId;

    // 4. Conferência
    await page.goto(`/admin/conferir/${reportId}`);
    // Deve mostrar o MUNI 71072 do exemplo
    await expect(page.locator('text=71072').first()).toBeVisible();
    
    // 5. Confirma Processamento
    await page.click('button:has-text("Confirmar Processamento")');
    await expect(page).toHaveURL('/admin/scanner');

    // 6. Confirma que apareceu no Painel
    await page.goto('/apuracao');
    // Como é real, deve somar! Voto cargo 11 = 100, cargo 1 = 100
    await expect(page.locator('body')).toContainText('100');
  });
});
