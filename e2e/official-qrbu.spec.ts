import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { Tse2026BallotReportParser } from '../src/lib/parser/Tse2026BallotReportParser';

test.describe('E2E OFFICIAL FIXTURE', () => {
  const examplesDir = path.join(__dirname, '../tests/fixtures/tse-2026/official/examples');

  test('Fluxo completo usando payload OFICIAL TSE 2026', async ({ request, page }) => {
    let examples: string[] = [];
    if (fs.existsSync(examplesDir)) {
      examples = fs.readdirSync(examplesDir).filter(dir => 
        fs.statSync(path.join(examplesDir, dir)).isDirectory()
      );
    }
    
    // Fail se não existir fixture oficial
    expect(examples.length).toBeGreaterThan(0);

    const firstExample = examples[0];
    const decodedDir = path.join(examplesDir, firstExample, 'decoded');
    const files = fs.readdirSync(decodedDir)
      .filter(f => /^qrbu-\d+-of-\d+\.txt$/.test(f))
      .sort();

    const partsPayloads = files.map(file => {
      return fs.readFileSync(path.join(decodedDir, file), 'utf8').trim();
    });

    // 1. Precisamos criar a eleição que dê match no PLEI/TURN desse BU
    // Vamos ler manualmente pra setup:
    const setupParser = new Tse2026BallotReportParser();
    const full = setupParser.reconstruct(partsPayloads) as string;
    const parsed = setupParser.parseReport(full, partsPayloads) as any;
    expect(parsed.electionId).toBeDefined();

    // 2. Setup Election DB context
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    // Limpar o banco de dados inteiro para E2E
    await prisma.ballotVote.deleteMany({});
    await prisma.ballotReportPart.deleteMany({});
    await prisma.ballotReport.deleteMany({});
    await prisma.scanSession.deleteMany({});
    await prisma.electionRound.deleteMany({});
    await prisma.election.deleteMany({});

    await prisma.election.create({
      data: {
        plei: parsed.electionId,
        name: `Eleição Oficial Teste ${parsed.electionId}`,
        year: 2026,
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: parsed.roundNumber, status: 'ACTIVE' }] }
      }
    });

    // 3. Login
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    const sessionId = `E2E-OFFICIAL-${Date.now()}`;

    // 4. Scan Parts
    let reportId = '';
    for (let i = 0; i < partsPayloads.length; i++) {
      const scanPart = await page.request.post('/api/scan', {
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
    await page.click('button:has-text("Confirmar Processamento")');
    await expect(page).toHaveURL('/admin/scanner');

    // 7. Confirma que apareceu no Painel
    await page.goto('/apuracao');
    // Deve mostrar o cargo respectivo ou quantidade (só precisamos verificar se carregou algo sem erro)
    await expect(page.locator('text=Apuração Paralela 2026')).toBeVisible();

    // 8. Tentar duplicar deve rejeitar
    const duplicateScan = await page.request.post('/api/scan', {
        data: {
          content: partsPayloads[partsPayloads.length - 1], // manda a última parte numa nova sessao
          isSimulation: false,
          sessionId: sessionId + '-DUP'
        }
    });
    // Se mandar só a última, não fecha o BU, entao manda todas de novo numa nova sessao
    const sessionIdDup = sessionId + '-DUP';
    for (let i = 0; i < partsPayloads.length; i++) {
      const scanPart = await page.request.post('/api/scan', {
        data: {
          content: partsPayloads[i],
          isSimulation: false,
          sessionId: sessionIdDup
        }
      });
      if (i === partsPayloads.length - 1) {
        expect(scanPart.status()).toBe(409); // CONFLICT / DUPLICATE
        const resDup = await scanPart.json();
        expect(resDup.status).toBe('DUPLICADO');
      }
    }

    await prisma.$disconnect();
  });
});
