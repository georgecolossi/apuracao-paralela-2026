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
    const simExists = await prisma.election.findFirst({ where: { plei: 'SIM-2202' }});
    if (!simExists) {
      await prisma.election.create({
        data: {
          plei: 'SIM-2202',
          name: 'Simulação Acrelandia',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: [{ roundNumber: 1, status: 'ACTIVE' }] }
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

    // Verificar banco de dados
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    // Provar que o relatório não foi criado
    const reportCount = await prisma.ballotReport.count({
      where: { hash: 'hash_test' }
    });
    expect(reportCount).toBe(0);

    // Provar que nenhum voto foi registrado
    const voteCount = await prisma.ballotVote.count({
      where: { report: { hash: 'hash_test' } }
    });
    expect(voteCount).toBe(0);

    // Provar que o AuditLog foi registrado
    const log = await prisma.auditLog.findFirst({
      where: { action: 'SCAN_OUT_OF_COVERAGE' }
    });
    expect(log).not.toBeNull();
    
    await prisma.$disconnect();
  });

  test('B) Aceitar BU dentro da cobertura (MUNI permitido)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    // MUNI 71072 (São Paulo, capital simulado) está configurado no COVERAGE_CITY_CODES
    const uniqueHash = 'hash_cov_' + Date.now();
    const inCoveragePayload = `SIMULATION|1|1|E2E-TEST|2202|1|SP|71072|90|100|1234567|Presidente,901,13,NOMINAL,50|${uniqueHash}|sig_test`;
    
    const scanRes = await page.request.post('/api/scan', {
      data: { content: inCoveragePayload, isSimulation: true, sessionId: sessionId + '-IN' }
    });
    
    expect(scanRes.status()).toBe(200);
  });
});
