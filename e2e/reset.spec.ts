import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';

test.describe('E2E ADMINISTRATIVO / RESET DA APURAÇÃO', () => {
  const sessionId = `E2E-RESET-${Date.now()}`;
  let officialPayload = "";

  test.beforeAll(async () => {
    const examplesDir = path.join(__dirname, '../tests/fixtures/tse-2026/official/examples');
    officialPayload = fs.readFileSync(path.join(examplesDir, 'Pres-T2_s02202ac0139200090013-imgbu', 'decoded', 'qrbu-01-of-01.txt'), 'utf-8');

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});

    await prisma.election.create({
        data: {
          plei: '2202',
          name: 'Eleição Acrelandia',
          year: 2026,
          status: 'ACTIVE',
          rounds: { create: [{ roundNumber: 1, status: 'ACTIVE' }, { roundNumber: 2, status: 'ACTIVE' }] }
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

    // 2. Post to API directly
    const scanRes = await page.request.post('/api/scan', {
      data: { content: officialPayload, isSimulation: false, sessionId: sessionId + '-A' }
    });
    // Aceita 200 ou 409
    
    // 3. Executar Preparação (Reset)
    await page.goto('/admin/preparar');
    await expect(page.locator('text=Atenção: Operação Irreversível')).toBeVisible();
    
    // 4. Resetar
    await page.fill('input[placeholder="ZERAR APURAÇÃO"]', 'ZERAR APURAÇÃO');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL('/apuracao', { timeout: 10000 });
    
    // Prova de que Totais foram zerados
    const totalsCheckRes = await page.request.get('/api/totals');
    const totalsCheck = await totalsCheckRes.json();
    expect(totalsCheck.totals.length).toBe(0); // Nenhum voto real

    // 5. Processar o mesmo BU novamente (Deve funcionar porque o BD foi zerado)
    const newScanRes = await page.request.post('/api/scan', {
      data: { content: officialPayload, isSimulation: false, sessionId: sessionId + '-B' }
    });
    const newScanData = await newScanRes.json();
    expect(newScanRes.status()).toBe(200);
    const newReportId = newScanData.reportId;
    
    // Confirma
    const confRes = await page.request.post(`/api/reports/${newReportId}/confirm`);
    expect(confRes.status()).toBe(200);
    
    // Validar Totais gerados contra o parser oficial
    const finalTotalsRes = await page.request.get('/api/totals');
    const finalTotals = await finalTotalsRes.json();
    
    const parser = new Tse2026BallotReportParser();
    const parsed = parser.parseReport(officialPayload, [officialPayload]);
    if ('code' in parsed) throw new Error('Failed to parse official payload');
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
        String(t.candidateNumber) === String(expectedC) &&
        String(t.partyNumber) === String(expectedP) &&
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
      data: { content: officialPayload, isSimulation: false, sessionId: sessionId + '-C' }
    });
    expect(dupScanRes.status()).toBe(409);
    const dupScanData = await dupScanRes.json();
    expect(dupScanData.status).toBe('DUPLICADO');
  });
});
