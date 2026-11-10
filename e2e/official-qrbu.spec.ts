import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';
import { BallotReportData } from '../src/lib/parser';
import { buildSyntheticPhaseOPartsWithValidHash, createE2EPrismaClient } from './helpers/e2eSupport';

test.describe('E2E FIXTURE ESTRUTURA TSE 2026', () => {
  const examplesDir = path.join(__dirname, '../tests/fixtures/tse-2026/official/examples');

  test('Rejeita FASE:S original e conclui fluxo usando variante sintética FASE:O com SHA-512 válido', async ({ page }) => {
    let examples: string[] = [];
    if (fs.existsSync(examplesDir)) {
      examples = fs.readdirSync(examplesDir).filter(dir =>
        fs.statSync(path.join(examplesDir, dir)).isDirectory()
      );
    }

    expect(examples.length).toBeGreaterThan(0);

    const firstExample = examples[0];
    const decodedDir = path.join(examplesDir, firstExample, 'decoded');
    const files = fs.readdirSync(decodedDir)
      .filter(f => /^qrbu-\d+-of-\d+\.txt$/.test(f))
      .sort();

    // Fixture pública original FASE:S preservada intacta em disco (testada para rejeição).
    const simulatedFixtureParts = files.map(file => {
      return fs.readFileSync(path.join(decodedDir, file), 'utf8').trim();
    });
    // Variante sintética de teste em formato QRBU FASE:O com SHA-512 válido (não é BU oficial nem comprova assinatura digital).
    const partsPayloads = buildSyntheticPhaseOPartsWithValidHash(simulatedFixtureParts);

    const setupParser = new Tse2026BallotReportParser();
    const full = setupParser.reconstruct(partsPayloads) as string;
    const parsed = setupParser.parseReport(full, partsPayloads) as BallotReportData;
    expect(parsed.electionId).toBeDefined();
    expect(parsed.fase).toBe('O');
    expect(parsed.hashStatus).toBe('VERIFIED');

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

    const stateObj = await prisma.state.upsert({
      where: { abbreviation: parsed.stateCode },
      update: {},
      create: { abbreviation: parsed.stateCode, name: parsed.stateCode }
    });
    const paddedCity = parsed.cityCode.padStart(5, '0');
    const muniObj = await prisma.municipality.upsert({
      where: { officialCode: paddedCity },
      update: { isCoverage: true },
      create: { officialCode: paddedCity, name: `Município ${paddedCity}`, stateId: stateObj.id, isCoverage: true }
    });
    await prisma.pollingZone.upsert({
      where: {
        municipalityId_zoneNumber: {
          municipalityId: muniObj.id,
          zoneNumber: parsed.zoneCode.padStart(4, '0')
        }
      },
      update: {},
      create: {
        municipalityId: muniObj.id,
        zoneNumber: parsed.zoneCode.padStart(4, '0')
      }
    });

    await prisma.election.create({
      data: {
        plei: parsed.electionId,
        name: `Eleição Teste Formato TSE ${parsed.electionId}`,
        year: 2026,
        type: 'GENERAL',
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: parsed.roundNumber, plei: parsed.electionId, status: 'ACTIVE' }] },
        scopes: {
          create: {
            scopeType: 'MUNICIPAL',
            scopeKey: `MUNICIPAL:${parsed.stateCode}:${paddedCity}`,
            stateId: stateObj.id,
            municipalityId: muniObj.id,
            isCoverageArea: true
          }
        },
        offices: {
          create: [
            { code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 },
            { code: '3', name: 'Governador', type: 'MAJORITARIO', orderNumber: 2 },
            { code: '5', name: 'Senador', type: 'MAJORITARIO', orderNumber: 3 },
            { code: '6', name: 'Deputado Federal', type: 'PROPORCIONAL', orderNumber: 4 },
            { code: '7', name: 'Deputado Estadual', type: 'PROPORCIONAL', orderNumber: 5 },
            { code: '11', name: 'Prefeito', type: 'MAJORITARIO', orderNumber: 6 },
            { code: '13', name: 'Vereador', type: 'PROPORCIONAL', orderNumber: 7 }
          ]
        }
      }
    });

    // 3. Login
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    // 3.1 Garante que o exemplo público com FASE:S NÃO é aceito como oficial com flag desabilitada
    const rejectedSimulatedRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        content: simulatedFixtureParts[0],
        isSimulation: false,
        sessionId: `E2E-FASE-S-REJECT-${Date.now()}`
      }
    });
    expect(rejectedSimulatedRes.status()).toBe(400);
    expect((await rejectedSimulatedRes.json()).error).toBe('SIMULATED_QRBU_REJECTED');

    const sessionId = `E2E-PHASEO-${Date.now()}`;

    // 4. Scan Parts
    let reportId = '';
    for (let i = 0; i < partsPayloads.length; i++) {
      const scanPart = await page.request.post('/api/scan', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          content: partsPayloads[i],
          isSimulation: false,
          sessionId
        }
      });
      const res = await scanPart.json();
      expect(scanPart.status()).toBe(200);

      if (i === partsPayloads.length - 1) {
        expect(res.status).toBe('COMPLETO');
        reportId = res.reportId;
      } else {
        expect(res.status).toBe('PARCIAL');
      }
    }

    // 5. Conferência
    await page.goto(`/admin/conferir/${reportId}`);
    await expect(page.locator(`text=${parsed.cityCode}`).first()).toBeVisible();

    // 6. Confirma Processamento
    await page.click('button:has-text("Confirmar e Totalizar")');
    await expect(page).toHaveURL('/admin/scanner');

    // 7. Confirma que apareceu no Painel Público Dinâmico
    await page.goto(`/apuracao?round=${parsed.roundNumber}`);
    await expect(page.locator('body')).toContainText(`Eleição Teste Formato TSE ${parsed.electionId}`);
    await expect(page.locator('body')).toContainText('Presidente');

    // 7.1 Verificar agregação comparando com parsed.votes
    const totalsResponse = await page.request.get(`/api/totals?round=${parsed.roundNumber}`);
    expect(totalsResponse.status()).toBe(200);
    const totalsBody = await totalsResponse.json();

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

    for (const [key, expectedQuantity] of Object.entries(expectedAgg)) {
      const [oName, cNumStr, pNumStr, vType] = key.split('|');
      const expectedCNum = cNumStr === 'null' ? null : cNumStr;
      const expectedPNum = pNumStr === 'null' ? null : pNumStr;

      const found = totalsBody.totals.find((t: TotalRow) =>
        t.officeName === oName &&
        (t.candidateNumber ?? null) === expectedCNum &&
        (t.partyNumber ?? null) === expectedPNum &&
        t.voteType === vType
      );

      expect(found, `Expected to find total for ${key}`).toBeDefined();
      expect(found.quantity, `Quantity mismatch for ${key}`).toBe(expectedQuantity);
    }

    // 8. Tentar duplicar em nova sessão deve rejeitar (409 DUPLICADO)
    const sessionIdDup = sessionId + '-DUP';
    for (let i = 0; i < partsPayloads.length; i++) {
      const scanPart = await page.request.post('/api/scan', {
        headers: { 'x-csrf-token': csrfToken },
        data: {
          content: partsPayloads[i],
          isSimulation: false,
          sessionId: sessionIdDup
        }
      });
      if (i === partsPayloads.length - 1) {
        expect(scanPart.status()).toBe(409);
        const resDup = await scanPart.json();
        expect(resDup.status).toBe('DUPLICADO');
      }
    }

    await prisma.$disconnect();
  });
});
