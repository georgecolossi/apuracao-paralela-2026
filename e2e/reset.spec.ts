import { test, expect } from '@playwright/test';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';
import { SYNTHETIC_PHASE_O_PRES_T2_PAYLOAD, createE2EPrismaClient } from './helpers/e2eSupport';

test.describe('E2E ADMINISTRATIVO / RESET DA APURAÇÃO', () => {
  const sessionId = `E2E-RESET-${Date.now()}`;
  // Payload sintético de teste em formato QRBU FASE:O, com SHA-512 válido (não é BU oficial do TSE).
  const syntheticPhaseOPayload = SYNTHETIC_PHASE_O_PRES_T2_PAYLOAD;

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

    const stateAC = await prisma.state.upsert({
      where: { abbreviation: 'AC' },
      update: {},
      create: { abbreviation: 'AC', name: 'ACRE' }
    });
    const muniAC = await prisma.municipality.upsert({
      where: { officialCode: '01392' },
      update: { isCoverage: true },
      create: { officialCode: '01392', name: 'RIO BRANCO', stateId: stateAC.id, isCoverage: true }
    });
    await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniAC.id, zoneNumber: '0009' } },
      update: {},
      create: { municipalityId: muniAC.id, zoneNumber: '0009' }
    });

    await prisma.election.create({
      data: {
        plei: '2202',
        name: 'Eleição Reset 2202',
        year: 2026,
        type: 'GENERAL',
        status: 'ACTIVE',
        rounds: {
          create: [
            { roundNumber: 1, plei: '2201', status: 'FINISHED' },
            { roundNumber: 2, plei: '2202', status: 'ACTIVE' }
          ]
        },
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

  test('Deve zerar a apuração e permitir novo fluxo (Oficial)', async ({ page }) => {
    // 1. Logar
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*admin.*/);

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    // 2. Enviar payload sintético FASE:O de Turno 2
    const initialScanRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: syntheticPhaseOPayload, isSimulation: false, sessionId: sessionId + '-A' }
    });
    expect([200, 409]).toContain(initialScanRes.status());

    // 3. Executar Preparação (Reset) do Turno 2
    await page.goto('/admin/preparar');
    await expect(page.locator('text=Atenção: Operação Irreversível')).toBeVisible();

    const confirmInput = page.locator('input[placeholder="ZERAR SEGUNDO TURNO"]');
    await expect(confirmInput).toBeVisible();
    await confirmInput.fill('ZERAR SEGUNDO TURNO');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL('/apuracao', { timeout: 10000 });

    // Prova de que Totais do Turno 2 foram zerados
    const totalsCheckRes = await page.request.get('/api/totals?round=2');
    const totalsCheck = await totalsCheckRes.json();
    expect(totalsCheck.totals.length).toBe(0);

    // 5. Processar o mesmo BU novamente (Deve funcionar porque o BD foi zerado)
    const newScanRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: syntheticPhaseOPayload, isSimulation: false, sessionId: sessionId + '-B' }
    });
    const newScanData = await newScanRes.json();
    expect(newScanRes.status()).toBe(200);
    const newReportId = newScanData.reportId;

    // Confirma
    const confRes = await page.request.post(`/api/reports/${newReportId}/confirm`, {
      headers: { 'x-csrf-token': csrfToken }
    });
    expect(confRes.status()).toBe(200);

    // Validar Totais gerados contra o parser oficial
    const finalTotalsRes = await page.request.get('/api/totals?round=2');
    const finalTotals = await finalTotalsRes.json();
    
    const parser = new Tse2026BallotReportParser();
    const parsed = parser.parseReport(syntheticPhaseOPayload, [syntheticPhaseOPayload]);
    if ('code' in parsed) throw new Error('Failed to parse synthetic FASE:O payload');
    const expectedAgg: Record<string, number> = {};
    for (const v of parsed.votes) {
      const key = `${v.officeName}|${v.candidateNumber || null}|${v.partyNumber || null}|${v.type}`;
      expectedAgg[key] = (expectedAgg[key] || 0) + v.quantity;
    }

    interface TotalRow {
      officeName: string;
      candidateNumber: string | null;
      partyNumber: string | null;
      voteType: string;
      quantity: number;
    }

    for (const [key, expectedQty] of Object.entries(expectedAgg)) {
      const [oName, cNum, pNum, vType] = key.split('|');
      const expectedC = cNum === 'null' ? null : cNum;
      const expectedP = pNum === 'null' ? null : pNum;
      const found = finalTotals.totals.find((t: TotalRow) => 
        t.officeName === oName &&
        (t.candidateNumber ?? null) === expectedC &&
        (t.partyNumber ?? null) === expectedP &&
        t.voteType === vType
      );
      expect(found).toBeDefined();
      expect(found.quantity).toBe(expectedQty);
    }

    // Painel reflete
    await page.goto('/apuracao');
    await expect(page.locator('text=Urnas Apuradas')).toBeVisible({ timeout: 10000 });
    // Esperar renderizar a lista de cargos
    await expect(page.getByText('Presidente', { exact: false }).first()).toBeVisible({ timeout: 10000 });
    const textContext = await page.locator('body').innerText();
    expect(textContext.toUpperCase().includes('PRESIDENTE')).toBeTruthy();

    // 6. Testar Duplicidade
    const dupScanRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: { content: syntheticPhaseOPayload, isSimulation: false, sessionId: sessionId + '-C' }
    });
    expect(dupScanRes.status()).toBe(409);
    const dupScanData = await dupScanRes.json();
    expect(dupScanData.status).toBe('DUPLICADO');
  });
});
