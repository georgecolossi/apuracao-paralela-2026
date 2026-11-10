import { test, expect } from '@playwright/test';
import { createE2EPrismaClient } from './helpers/e2eSupport';

test.describe('APPLICATION E2E / SIMULATION', () => {
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
    const zone123 = await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniSP.id, zoneNumber: '0123' } },
      update: {},
      create: { municipalityId: muniSP.id, zoneNumber: '0123' }
    });
    const sec456 = await prisma.pollingSection.upsert({
      where: { pollingZoneId_sectionNumber: { pollingZoneId: zone123.id, sectionNumber: '0456' } },
      update: { expectedBUs: 1 },
      create: { pollingZoneId: zone123.id, sectionNumber: '0456', expectedBUs: 1 }
    });

    const simEle = await prisma.election.create({
      data: {
        plei: 'SIM-123',
        name: 'Eleição Simulacao 123',
        year: 2026,
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: 1, plei: 'SIM-123', status: 'ACTIVE' }] },
        offices: {
          create: [
            { code: '11', name: 'Prefeito', type: 'MAJORITARIO', orderNumber: 1 },
            { code: '13', name: 'Vereador', type: 'PROPORCIONAL', orderNumber: 2 }
          ]
        }
      },
      include: { rounds: true }
    });
    await prisma.roundCoverage.create({
      data: {
        electionRoundId: simEle.rounds[0].id,
        pollingSectionId: sec456.id,
        expectedBUs: 1
      }
    });
    await prisma.$disconnect();
  });

  test('Fluxo completo: Login -> Scan -> Confirmação -> Publicação', async ({ page }) => {
    // 1. Login
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    // 2. Cria fluxo multipart via request isolada (Simulando API call do scanner)
    const sessionId = `E2E-SEQ-${Date.now()}`;
    const urnCode = `URN${Date.now()}`;

    // Parte 1/2
    const scanPart1 = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        content: `SIMULATION|1|2|${sessionId}|123|1|SP|71072|123|456|${urnCode}|Prefeito,10,10,nominal,50;Vereador,12345,12,nominal,30|hash123|sig123`,
        isSimulation: true,
        sessionId
      }
    });
    expect(scanPart1.status()).toBe(200);
    const res1 = await scanPart1.json();
    expect(res1.status).toBe('PARCIAL');

    // Parte 2/2
    const scanPart2 = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        content: `SIMULATION|2|2|${sessionId}|`,
        isSimulation: true,
        sessionId
      }
    });
    const res2 = await scanPart2.json();
    expect(scanPart2.status()).toBe(200);
    expect(res2.status).toBe('COMPLETO');
    const reportId = res2.reportId;

    // 3. Conferência e Confirmação
    await page.goto(`/admin/conferir/${reportId}`);
    await expect(page.locator('text=71072').first()).toBeVisible();
    await expect(page.locator('text=SIMULAÇÃO').first()).toBeVisible();

    // Confirma
    await page.click('button:has-text("Confirmar e Totalizar")');
    await expect(page).toHaveURL('/admin/scanner', { timeout: 15000 });

    // 4. Checa Apuração Pública e Sala de Imprensa: simulação NÃO deve vazar para APIs públicas
    const totalsRes = await page.request.get('/api/totals');
    const totalsData = await totalsRes.json();
    expect(totalsData.totals).toHaveLength(0);

    const urnasRes = await page.request.get('/api/urnas');
    expect(urnasRes.status()).toBe(200);
    const urnasData = await urnasRes.json();
    expect(urnasData.items).toHaveLength(0);

    await page.goto('/apuracao');
    await expect(page.locator('body')).not.toContainText('CANDIDATO 10');

    // 5. Confirma registro na conferência administrativa
    await page.goto('/admin/conferencia');
    await expect(page.locator('text=71072').first()).toBeVisible();
    await expect(page.locator('text=PROCESSADO').first()).toBeVisible();
  });
});
