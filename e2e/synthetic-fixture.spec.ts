import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createE2EPrismaClient } from './helpers/e2eSupport';

test.describe('TSE 2026 SYNTHETIC FIXTURE E2E', () => {
  test.beforeAll(async () => {
    const prisma = await createE2EPrismaClient();
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

    const stateSP = await prisma.state.upsert({
      where: { abbreviation: 'SP' },
      update: {},
      create: { abbreviation: 'SP', name: 'SÃO PAULO' }
    });
    const muniSP = await prisma.municipality.upsert({
      where: { officialCode: '71072' },
      update: { isCoverage: true },
      create: { officialCode: '71072', name: 'SÃO PAULO', stateId: stateSP.id, isCoverage: true }
    });
    await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniSP.id, zoneNumber: '0001' } },
      update: {},
      create: { municipalityId: muniSP.id, zoneNumber: '0001' }
    });

    await prisma.election.create({
      data: {
        plei: '123',
        name: 'Eleição Synthetic 123',
        year: 2026,
        type: 'MUNICIPAL',
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: 1, plei: '123', status: 'ACTIVE' }] },
        scopes: {
          create: {
            scopeType: 'MUNICIPAL',
            scopeKey: 'MUNICIPAL:SP:71072',
            stateId: stateSP.id,
            municipalityId: muniSP.id,
            isCoverageArea: true
          }
        },
        offices: {
          create: [
            { code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 },
            { code: '11', name: 'Prefeito', type: 'MAJORITARIO', orderNumber: 2 }
          ]
        }
      }
    });
    await prisma.$disconnect();
  });

  test('Fluxo completo usando payload SINTÉTICO (ZIP oficial bloqueado)', async ({ request, page }) => {
    const p1Path = path.join(__dirname, '../tests/fixtures/tse-2026/derived-invalid/bu-example-part1.txt');
    const p2Path = path.join(__dirname, '../tests/fixtures/tse-2026/derived-invalid/bu-example-part2.txt');

    const p1 = fs.readFileSync(p1Path, 'utf8').trim();
    const p2 = fs.readFileSync(p2Path, 'utf8').trim();

    // 0. Verifica Segurança da API sem sessão
    const unauthorizedScan = await request.post('/api/scan', {
      data: { content: 'TEST', isSimulation: true }
    });
    expect(unauthorizedScan.status()).toBe(401);

    // 1. Login
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const sessionId = `E2E-SYN-${Date.now()}`;

    // 2. Scan Parte 1
    const scanPart1 = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        content: p1,
        isSimulation: false,
        sessionId
      }
    });
    expect(scanPart1.status()).toBe(200);
    const res1 = await scanPart1.json();
    expect(res1.status).toBe('PARCIAL');

    // 3. Scan Parte 2
    const scanPart2 = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        content: p2,
        isSimulation: false,
        sessionId
      }
    });
    const res2 = await scanPart2.json();
    expect(scanPart2.status()).toBe(200);
    expect(res2.status).toBe('COMPLETO');
    const reportId = res2.reportId;

    // 4. Conferência
    await page.goto(`/admin/conferir/${reportId}`);
    await expect(page.locator('text=71072').first()).toBeVisible();

    // 5. Confirma Processamento
    await page.click('button:has-text("Confirmar e Totalizar")');
    await expect(page).toHaveURL('/admin/scanner');

    // 6. Confirma que apareceu no Painel com os totais reais do adaptador VRQR
    await page.goto('/apuracao');
    await expect(page.locator('body')).toContainText('Eleição Synthetic 123');
    await expect(page.locator('body')).toContainText('1 urnas apuradas');
    await expect(page.locator('body')).toContainText('Comparecimento:');
    await expect(page.locator('body')).toContainText('250');
  });
});
