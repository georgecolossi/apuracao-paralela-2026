#!/usr/bin/env node
/**
 * scripts/test-concurrent-sessions.mjs
 * 
 * Teste automatizado de login simultâneo e concorrência de envio de QRBUs
 * utilizando Playwright com 3 contextos de navegador independentes (3 dispositivos).
 * Executado exclusivamente em ambiente local descartável com banco isolado.
 */

import { chromium } from '@playwright/test';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const TEST_PORT = 3456;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_PATH = path.resolve(rootDir, 'prisma/test-concurrent.db');
const TEST_DB_URL = 'file:' + TEST_DB_PATH.replace(/\\/g, '/');
const JWT_SECRET = 'test-concurrent-jwt-secret-key-32bytes-min!!';

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'adminPassword123!';

let nextServerProcess = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status === 200 || res.status === 307) {
        return true;
      }
    } catch (e) {
      // aguarda inicialização
    }
    await sleep(500);
  }
  throw new Error(`Servidor não respondeu em ${url} dentro de ${timeoutMs}ms`);
}

async function setupDatabase() {
  console.log('[Setup] Inicializando banco isolado descartável...');
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.ALLOW_SIMULATED_FASE = 'true';

  execSync('npx prisma db push --skip-generate', {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'ignore'
  });

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } }
  });

  // Criar Usuário Admin
  const passwordHash = await bcrypt.hash(ADMIN_PASS, 10);
  const user = await prisma.user.create({
    data: {
      name: 'Administrador Operacional',
      email: ADMIN_USER,
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });

  // Criar Estado, Município e Zona
  const state = await prisma.state.create({
    data: { abbreviation: 'AC', name: 'Acre' }
  });

  const muni = await prisma.municipality.create({
    data: { officialCode: '01392', name: 'Rio Branco', stateId: state.id, isCoverage: true }
  });

  const zone = await prisma.pollingZone.create({
    data: { zoneNumber: '0009', municipalityId: muni.id }
  });

  // Criar seções 0013, 0016 e 0017
  const sec13 = await prisma.pollingSection.create({
    data: { sectionNumber: '0013', pollingZoneId: zone.id, expectedBUs: 1 }
  });
  const sec16 = await prisma.pollingSection.create({
    data: { sectionNumber: '0016', pollingZoneId: zone.id, expectedBUs: 1 }
  });
  const sec17 = await prisma.pollingSection.create({
    data: { sectionNumber: '0017', pollingZoneId: zone.id, expectedBUs: 1 }
  });

  // Criar Eleição e Turno 2 (ACTIVE para testes de scanner)
  const election = await prisma.election.create({
    data: {
      plei: '2202',
      name: 'Eleições 2026 2º Turno Teste',
      year: 2026,
      status: 'ACTIVE'
    }
  });

  const round2 = await prisma.electionRound.create({
    data: {
      roundNumber: 2,
      plei: '2202',
      status: 'ACTIVE',
      electionId: election.id
    }
  });

  // RoundCoverage
  await prisma.roundCoverage.createMany({
    data: [
      { electionRoundId: round2.id, pollingSectionId: sec13.id, expectedBUs: 1 },
      { electionRoundId: round2.id, pollingSectionId: sec16.id, expectedBUs: 1 },
      { electionRoundId: round2.id, pollingSectionId: sec17.id, expectedBUs: 1 }
    ]
  });

  // Metadados Candidatos T2
  await prisma.candidateMetadata.createMany({
    data: [
      {
        electionYear: 2026,
        electionCode: '6258',
        round: 2,
        state: 'BR',
        officeCode: '1',
        officeName: 'PRESIDENTE',
        candidateNumber: '13',
        ballotName: 'LULA',
        partyNumber: '13',
        partyAbbreviation: 'PT',
        partyName: 'PARTIDO DOS TRABALHADORES',
        candidateSequence: '1001'
      },
      {
        electionYear: 2026,
        electionCode: '6258',
        round: 2,
        state: 'BR',
        officeCode: '1',
        officeName: 'PRESIDENTE',
        candidateNumber: '22',
        ballotName: 'FLAVIO BOLSONARO',
        partyNumber: '22',
        partyAbbreviation: 'PL',
        partyName: 'PARTIDO LIBERAL',
        candidateSequence: '1002'
      }
    ]
  });

  console.log('[Setup] Banco isolado configurado com sucesso.');
  await prisma.$disconnect();
  return { userId: user.id };
}

function startNextServer() {
  console.log(`[Server] Iniciando servidor Next.js local na porta ${TEST_PORT}...`);
  const nextBin = path.resolve(rootDir, 'node_modules/next/dist/bin/next');

  nextServerProcess = spawn('node', [nextBin, 'start', '-p', String(TEST_PORT)], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DATABASE_URL: TEST_DB_URL,
      JWT_SECRET: JWT_SECRET,
      ALLOW_SIMULATED_FASE: 'true',
      NODE_ENV: 'production'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  nextServerProcess.stdout.on('data', (d) => {
    // console.log(`[Next.js] ${d}`);
  });
  nextServerProcess.stderr.on('data', (d) => {
    // console.error(`[Next.js Error] ${d}`);
  });
}

function getExtractedQrbu(secNumber) {
  const extractorPath = path.resolve(rootDir, 'scripts/pdf-qr-extractor.py');
  const pdfPath = path.resolve(rootDir, 'tests/fixtures/tse2026/turno2/BU_T2_VOTA_Presidente/Pres-T2_s02202ac0139200090013-imgbu.pdf');
  const out = execSync(`python "${extractorPath}" "${pdfPath}"`, { encoding: 'utf-8' });
  const data = JSON.parse(out);
  const baseQrbu = data.qrbuParts[0].rawText;

  if (secNumber === '0013') {
    return baseQrbu;
  }

  const baseNoHash = baseQrbu.replace('SECA:13', `SECA:${parseInt(secNumber, 10)}`).replace(/ HASH:.*/, '');
  const hashInput = baseNoHash.replace(/^QRBU:\d+:\d+ VRQR:\S+ /, '');
  const newHash = crypto.createHash('sha512').update(hashInput, 'utf8').digest('hex').toUpperCase();
  const assiMatch = baseQrbu.match(/ ASSI:.*/);
  return baseNoHash + ' HASH:' + newHash + (assiMatch ? assiMatch[0] : '');
}

async function run() {
  const report = {
    multipleLoginsSimultaneous: false,
    sessionsTested: 0,
    previousSessionsRemainValid: false,
    scannerAccessibleSimultaneously: false,
    concurrentBUsSubmission: 'REPROVADO',
    problemsFound: []
  };

  try {
    await setupDatabase();
    startNextServer();
    await waitForServer(`${BASE_URL}/login`);
    console.log('[Server] Next.js pronto e respondendo.\n');

    console.log('--- ETAPA 1: Autenticação de 3 dispositivos com a mesma conta ---');
    const browser = await chromium.launch({ headless: true });

    // Dispositivo 1: Celular iPhone
    const context1 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1 (Device-1-iPhone)'
    });
    // Dispositivo 2: Celular Android
    const context2 = await browser.newContext({
      viewport: { width: 412, height: 915 },
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 (Device-2-Android)'
    });
    // Dispositivo 3: Computador Desktop
    const context3 = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 (Device-3-Desktop)'
    });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    report.sessionsTested = 3;

    // Login Dispositivo 1
    console.log('[Dispositivo 1 - iPhone] Executando login...');
    await page1.goto(`${BASE_URL}/login`);
    await page1.fill('input[name="username"]', ADMIN_USER);
    await page1.fill('input[name="password"]', ADMIN_PASS);
    await page1.click('button[type="submit"]');
    await page1.waitForURL(url => url.pathname.includes('/admin'));
    console.log(`[Dispositivo 1] Autenticado com sucesso. URL atual: ${page1.url()}`);

    // Login Dispositivo 2
    console.log('[Dispositivo 2 - Android] Executando login com a mesma conta...');
    await page2.goto(`${BASE_URL}/login`);
    await page2.fill('input[name="username"]', ADMIN_USER);
    await page2.fill('input[name="password"]', ADMIN_PASS);
    await page2.click('button[type="submit"]');
    await page2.waitForURL(url => url.pathname.includes('/admin'));
    console.log(`[Dispositivo 2] Autenticado com sucesso. URL atual: ${page2.url()}`);

    // Login Dispositivo 3
    console.log('[Dispositivo 3 - Desktop] Executando login com a mesma conta...');
    await page3.goto(`${BASE_URL}/login`);
    await page3.fill('input[name="username"]', ADMIN_USER);
    await page3.fill('input[name="password"]', ADMIN_PASS);
    await page3.click('button[type="submit"]');
    await page3.waitForURL(url => url.pathname.includes('/admin'));
    console.log(`[Dispositivo 3] Autenticado com sucesso. URL atual: ${page3.url()}`);

    console.log('\n--- ETAPA 2: Verificação de coexistência e acesso simultâneo ---');
    // Acessar /admin e /admin/scanner simultaneamente em todos
    const [resNav1, resNav2, resNav3] = await Promise.all([
      page1.goto(`${BASE_URL}/admin/scanner`),
      page2.goto(`${BASE_URL}/admin/scanner`),
      page3.goto(`${BASE_URL}/admin/scanner`)
    ]);

    const status1 = resNav1.status();
    const status2 = resNav2.status();
    const status3 = resNav3.status();
    console.log(`Status de acesso a /admin/scanner:`);
    console.log(`- Dispositivo 1: HTTP ${status1} (URL: ${page1.url()})`);
    console.log(`- Dispositivo 2: HTTP ${status2} (URL: ${page2.url()})`);
    console.log(`- Dispositivo 3: HTTP ${status3} (URL: ${page3.url()})`);

    const scannerAccessible = status1 === 200 && status2 === 200 && status3 === 200 &&
      page1.url().includes('/admin/scanner') &&
      page2.url().includes('/admin/scanner') &&
      page3.url().includes('/admin/scanner');

    report.scannerAccessibleSimultaneously = scannerAccessible;

    // Verificar se as sessões 1 e 2 permaneceram válidas após o 3º login
    const cookies1 = await context1.cookies();
    const cookies2 = await context2.cookies();
    const cookies3 = await context3.cookies();

    const token1 = cookies1.find(c => c.name === 'admin_session')?.value;
    const token2 = cookies2.find(c => c.name === 'admin_session')?.value;
    const token3 = cookies3.find(c => c.name === 'admin_session')?.value;

    console.log('\nVerificação de tokens JWT independentes:');
    console.log(`- Token Dispositivo 1 presente: ${Boolean(token1)}`);
    console.log(`- Token Dispositivo 2 presente: ${Boolean(token2)}`);
    console.log(`- Token Dispositivo 3 presente: ${Boolean(token3)}`);

    const sessionsActive = Boolean(token1 && token2 && token3);
    report.previousSessionsRemainValid = sessionsActive && scannerAccessible;
    report.multipleLoginsSimultaneous = sessionsActive && scannerAccessible;

    console.log('\n--- ETAPA 3: Consultas autenticadas independentes simultâneas ---');
    const [apiCheck1, apiCheck2, apiCheck3] = await Promise.all([
      page1.evaluate(async () => {
        const r = await fetch('/api/totals?round=2');
        return { status: r.status, ok: r.ok };
      }),
      page2.evaluate(async () => {
        const r = await fetch('/api/totals?round=2');
        return { status: r.status, ok: r.ok };
      }),
      page3.evaluate(async () => {
        const r = await fetch('/api/totals?round=2');
        return { status: r.status, ok: r.ok };
      })
    ]);

    console.log(`Consultas simultâneas independentes:`);
    console.log(`- Dispositivo 1 API: HTTP ${apiCheck1.status}`);
    console.log(`- Dispositivo 2 API: HTTP ${apiCheck2.status}`);
    console.log(`- Dispositivo 3 API: HTTP ${apiCheck3.status}`);

    console.log('\n--- ETAPA 4: Isolamento de Logout Individual ---');
    console.log('[Dispositivo 1] Executando logout individual...');
    await page1.evaluate(async () => {
      await fetch('/api/logout', { method: 'POST' });
    });
    await page1.goto(`${BASE_URL}/admin`);
    console.log(`[Dispositivo 1 após logout] URL: ${page1.url()} (Redirecionou para login: ${page1.url().includes('/login')})`);

    // Testar se Dispositivos 2 e 3 CONTINUAM AUTENTICADOS
    await page2.goto(`${BASE_URL}/admin`);
    await page3.goto(`${BASE_URL}/admin`);
    const dev2StillAuth = page2.url().includes('/admin') && !page2.url().includes('/login');
    const dev3StillAuth = page3.url().includes('/admin') && !page3.url().includes('/login');

    console.log(`- Dispositivo 2 permanece autenticado: ${dev2StillAuth} (URL: ${page2.url()})`);
    console.log(`- Dispositivo 3 permanece autenticado: ${dev3StillAuth} (URL: ${page3.url()})`);

    if (!dev2StillAuth || !dev3StillAuth) {
      report.problemsFound.push('Logout do Dispositivo 1 afetou indevidamente as demais sessões.');
    }

    // Reautenticar Dispositivo 1 para a etapa de envio concorrente
    await page1.goto(`${BASE_URL}/login`);
    await page1.fill('input[name="username"]', ADMIN_USER);
    await page1.fill('input[name="password"]', ADMIN_PASS);
    await page1.click('button[type="submit"]');
    await page1.waitForURL(url => url.pathname.includes('/admin'));

    console.log('\n--- ETAPA 5: Envio Concorrente de QRBUs de Seções Diferentes ---');
    const bu13 = getExtractedQrbu('0013');
    const bu16 = getExtractedQrbu('0016');
    const bu17 = getExtractedQrbu('0017');

    console.log('Disparando envio simultâneo de 3 BUs de seções diferentes (0013, 0016, 0017)...');
    const [scanRes1, scanRes2, scanRes3] = await Promise.all([
      page1.evaluate(async (content) => {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            sessionId: 'session-dev1-' + Date.now(),
            isSimulation: false
          })
        });
        return { status: res.status, data: await res.json() };
      }, bu13),

      page2.evaluate(async (content) => {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            sessionId: 'session-dev2-' + Date.now(),
            isSimulation: false
          })
        });
        return { status: res.status, data: await res.json() };
      }, bu16),

      page3.evaluate(async (content) => {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            sessionId: 'session-dev3-' + Date.now(),
            isSimulation: false
          })
        });
        return { status: res.status, data: await res.json() };
      }, bu17)
    ]);

    console.log(`- Envio Seção 0013 (Dispositivo 1): HTTP ${scanRes1.status}`, scanRes1.data.status || scanRes1.data.error || '');
    console.log(`- Envio Seção 0016 (Dispositivo 2): HTTP ${scanRes2.status}`, scanRes2.data.status || scanRes2.data.error || '');
    console.log(`- Envio Seção 0017 (Dispositivo 3): HTTP ${scanRes3.status}`, scanRes3.data.status || scanRes3.data.error || '');

    // Verificar se no banco temos exatamente 3 BallotReports e os votos corretos
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } }
    });

    const totalReports = await prisma.ballotReport.count();
    const reportsList = await prisma.ballotReport.findMany({
      select: { sectionCode: true, urnCode: true, status: true }
    });
    console.log(`Total de BUs processados no banco descartável: ${totalReports}`);
    console.log(`BUs gravados:`, JSON.stringify(reportsList));

    const votesCount = await prisma.ballotVote.count();
    console.log(`Total de registros de votos criados: ${votesCount}`);

    // Teste de reenvio concorrente do mesmo BU (Idempotência)
    console.log('\nTestando tentativa de envio duplicado concorrente da seção 0013 pelo Dispositivo 2...');
    const duplicateRes = await page2.evaluate(async (content) => {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          sessionId: 'session-dev2-dup-' + Date.now(),
          isSimulation: false
        })
      });
      return { status: res.status, data: await res.json() };
    }, bu13);
    console.log(`Resposta do reenvio duplicado: HTTP ${duplicateRes.status}`, duplicateRes.data.error || duplicateRes.data.message || duplicateRes.data.status);

    const totalReportsAfterDup = await prisma.ballotReport.count();
    console.log(`Total de BUs após tentativa de duplicata: ${totalReportsAfterDup} (deve permanecer 3)`);

    await prisma.$disconnect();

    const concurrentOk = totalReports === 3 && totalReportsAfterDup === 3 &&
      scanRes1.status === 200 && scanRes2.status === 200 && scanRes3.status === 200;

    if (concurrentOk) {
      report.concurrentBUsSubmission = 'APROVADO';
    } else {
      report.concurrentBUsSubmission = 'REPROVADO';
      report.problemsFound.push(`Total de relatórios inconsistente: inicial=${totalReports}, pós-duplicata=${totalReportsAfterDup}`);
    }

    await browser.close();
  } catch (err) {
    console.error('Erro durante o teste:', err);
    report.problemsFound.push(err.message);
  } finally {
    if (nextServerProcess) {
      console.log('\n[Cleanup] Finalizando processo do servidor Next.js...');
      nextServerProcess.kill('SIGTERM');
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
        console.log('[Cleanup] Banco descartável removido com sucesso.');
      } catch (e) {
        // ignora se ocupado
      }
    }
  }

  console.log('\n================================================================');
  console.log('RELATÓRIO DO TESTE DE LOGIN SIMULTÂNEO E CONCORRÊNCIA');
  console.log('================================================================');
  console.log(`- Múltiplos logins simultâneos: ${report.multipleLoginsSimultaneous ? 'SIM' : 'NÃO'}`);
  console.log(`- Quantidade de sessões testadas: ${report.sessionsTested}`);
  console.log(`- Sessões anteriores permanecem válidas: ${report.previousSessionsRemainValid ? 'SIM' : 'NÃO'}`);
  console.log(`- Scanner acessível simultaneamente: ${report.scannerAccessibleSimultaneously ? 'SIM' : 'NÃO'}`);
  console.log(`- Envio concorrente de BUs: ${report.concurrentBUsSubmission}`);
  console.log(`- Problemas encontrados: ${report.problemsFound.length === 0 ? 'Nenhum' : report.problemsFound.join('; ')}`);
  console.log('================================================================\n');

  if (
    report.multipleLoginsSimultaneous &&
    report.previousSessionsRemainValid &&
    report.scannerAccessibleSimultaneously &&
    report.concurrentBUsSubmission === 'APROVADO' &&
    report.problemsFound.length === 0
  ) {
    console.log('LOGIN COMPARTILHADO HOMOLOGADO — MÚLTIPLOS OPERADORES LIBERADOS.\n');
  }
}

run();
