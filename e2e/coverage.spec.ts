import { test, expect } from '@playwright/test';
import { OFFICIAL_PHASE_O_PRES_T2_PAYLOAD, createE2EPrismaClient } from './helpers/e2eSupport';

test.describe('E2E ADMINISTRATIVO / COBERTURA GEOGRÁFICA', () => {
  const sessionId = `E2E-COV-${Date.now()}`;
  const officialPayload = OFFICIAL_PHASE_O_PRES_T2_PAYLOAD;

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
    await prisma.pollingSection.deleteMany({});
    await prisma.pollingZone.deleteMany({});

    const stateAC = await prisma.state.upsert({
      where: { abbreviation: 'AC' },
      update: {},
      create: { abbreviation: 'AC', name: 'ACRE' }
    });
    const muniAC = await prisma.municipality.upsert({
      where: { officialCode: '01392' },
      update: { isCoverage: false },
      create: { officialCode: '01392', name: 'RIO BRANCO', stateId: stateAC.id, isCoverage: false }
    });

    await prisma.election.create({
      data: {
        plei: '2202',
        name: 'Eleição Cobertura AC',
        year: 2026,
        type: 'GENERAL',
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: 2, plei: '2202', status: 'ACTIVE' }] },
        scopes: {
          create: {
            scopeType: 'MUNICIPAL',
            scopeKey: 'MUNICIPAL:AC:01392',
            stateId: stateAC.id,
            municipalityId: muniAC.id,
            isCoverageArea: true
          }
        },
        offices: {
          create: [{ code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 }]
        }
      }
    });
    await prisma.$disconnect();
  });

  test('A) Rejeitar BU fora da cobertura (PollingZone ausente -> 403)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const scanRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: officialPayload, isSimulation: false, sessionId: sessionId + '-OUT' }
    });

    expect(scanRes.status()).toBe(403);
    const data = await scanRes.json();
    expect(data.error).toBe('OUT_OF_COVERAGE');

    const prisma = await createE2EPrismaClient();

    const reportCount = await prisma.ballotReport.count({
      where: { cityCode: '01392' }
    });
    expect(reportCount).toBe(0);

    const log = await prisma.auditLog.findFirst({
      where: { action: 'SCAN_OUT_OF_COVERAGE' }
    });
    expect(log).not.toBeNull();

    await prisma.$disconnect();
  });

  test('B) Aceitar BU dentro da cobertura (PollingZone cadastrada -> 200)', async ({ page }) => {
    const prisma = await createE2EPrismaClient();
    const muniAC = await prisma.municipality.findUniqueOrThrow({ where: { officialCode: '01392' } });
    await prisma.municipality.update({ where: { id: muniAC.id }, data: { isCoverage: true } });
    await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniAC.id, zoneNumber: '0009' } },
      update: {},
      create: { municipalityId: muniAC.id, zoneNumber: '0009' }
    });
    await prisma.$disconnect();

    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const scanRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: officialPayload, isSimulation: false, sessionId: sessionId + '-IN' }
    });

    expect(scanRes.status()).toBe(200);
    const json = await scanRes.json();
    expect(json.status).toBe('COMPLETO');
  });
});
