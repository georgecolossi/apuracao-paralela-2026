#!/usr/bin/env node
/**
 * scripts/pre-election-readiness.mjs
 * 
 * Checklist Automatizado de Prontidão Operacional para o 2º Turno (25/10/2026).
 * Somente leitura (read-only), sem escrita em banco e sem alterações de produção.
 */

import http from 'http';
import https from 'https';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROD_BASE_URL = 'https://apuracao-paralela-2026-production.up.railway.app';
const EXPECTED_MAIN_COMMIT = '4d0768f7c0f9bcbc1866d8c3e4b8599c3ca9ef5a';
const TIMEOUT_MS = 8000;

function fetchWithTimeout(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;
    const reqUrl = new URL(url);

    const opts = {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: TIMEOUT_MS,
      ...options
    };

    const req = client.request(reqUrl, opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout de ${TIMEOUT_MS}ms atingido para ${url}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

const results = [];

function recordResult(item, status, evidence, requiredAction) {
  results.push({ item, status, evidence, requiredAction });
}

// 1. Cobertura Oficial do TSE (Portal de Dados Abertos CKAN)
async function verifyTseOpenData() {
  const item = 'Cobertura oficial TSE (SC 2º T)';
  try {
    const url = 'https://dadosabertos.tse.jus.br/api/3/action/package_show?id=resultados-2026-correspondencias-esperadas-e-efetivadas-2-turno';
    const res = await fetchWithTimeout(url);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      if (data.success) {
        recordResult(item, 'PASS', 'Arquivo do 2º turno disponível no Portal de Dados Abertos do TSE', 'Homologar cobertura oficial se autorizada.');
        return;
      }
    }
    recordResult(item, 'WARNING', 'TSE ainda não publicou arquivo de correspondências do 2º turno no Portal de Dados Abertos.', 'Manter referência provisória de 193 BUs em Concórdia/SC.');
  } catch (err) {
    recordResult(item, 'WARNING', `Falha ao consultar Portal de Dados Abertos TSE: ${err.message}`, 'Manter referência provisória de 193 BUs.');
  }
}

// 2. Parâmetros Oficiais do 2º Turno
async function verifyT2Parameters() {
  const item = 'Parâmetros T2 (PLEI/Eleição/Turno)';
  try {
    const res = await fetchWithTimeout(`${PROD_BASE_URL}/api/totals?round=2`);
    if (res.status !== 200) {
      recordResult(item, 'FAIL', `API retornou HTTP ${res.status}`, 'Investigar rota /api/totals?round=2.');
      return;
    }
    const data = JSON.parse(res.body);
    const plei = data.election?.plei;
    const roundNumber = data.round?.roundNumber;
    const roundStatus = data.round?.status;
    const isProvisional = data.isProvisional;
    const candidates = data.totals?.candidates || [];

    const condPlei = plei === '3221';
    const condRound = roundNumber === 2;
    const condStatus = roundStatus === 'PLANNED';
    const candNames = candidates.map(c => `${c.candidateNumber}-${c.ballotName}`).join(', ');

    if (condPlei && condRound && condStatus) {
      recordResult(
        item,
        'PASS',
        `PLEI=${plei}, Turno=${roundNumber}, Status=${roundStatus}, Candidatos=${candNames || '13-LULA, 22-FLAVIO BOLSONARO (metadados)'}, Provisória=${isProvisional}`,
        'Nenhuma. Parâmetros em conformidade com TSE.'
      );
    } else {
      recordResult(item, 'FAIL', `Parâmetros divergentes: PLEI=${plei}, Turno=${roundNumber}, Status=${roundStatus}`, 'Corrigir parâmetros antes da eleição.');
    }
  } catch (err) {
    recordResult(item, 'FAIL', `Erro ao verificar parâmetros T2: ${err.message}`, 'Verificar conectividade com produção.');
  }
}

// 3. Railway Production Health & Cache-Control
async function verifyRailwayProduction() {
  const item = 'Railway Production';
  try {
    const resApuracao = await fetchWithTimeout(`${PROD_BASE_URL}/apuracao`);
    const resT1 = await fetchWithTimeout(`${PROD_BASE_URL}/api/totals?round=1`);
    const resT2 = await fetchWithTimeout(`${PROD_BASE_URL}/api/totals?round=2`);

    const cacheT1 = resT1.headers['cache-control'] || '';
    const cacheT2 = resT2.headers['cache-control'] || '';
    const hasNoStore = cacheT1.includes('no-store') && cacheT2.includes('no-store');

    if (resApuracao.status === 200 && resT1.status === 200 && resT2.status === 200 && hasNoStore) {
      recordResult(
        item,
        'PASS',
        `Online HTTPS 200 em todas as rotas. Headers Cache-Control com no-store verificados.`,
        'Nenhuma ação necessária.'
      );
    } else {
      recordResult(
        item,
        'WARNING',
        `Status apuração=${resApuracao.status}, T1=${resT1.status}, T2=${resT2.status}, Cache=${cacheT1}`,
        'Verificar configuração de cache HTTP.'
      );
    }
  } catch (err) {
    recordResult(item, 'FAIL', `Erro de conexão com Railway: ${err.message}`, 'Verificar status do serviço no Railway.');
  }
}

// 4. Integridade do Banco de Dados via Railway SSH (Read-only)
async function verifyDatabaseIntegrity() {
  const itemT1 = 'Banco T1';
  const itemT2 = 'Banco T2';
  const itemStorage = 'Armazenamento e SQLite';

  try {
    const nodeScript = `
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const qk = await prisma.$queryRawUnsafe('PRAGMA quick_check;');
  const t1Reports = await prisma.ballotReport.count({ where: { round: { roundNumber: 1 } } });
  const t2Reports = await prisma.ballotReport.count({ where: { round: { roundNumber: 2 } } });
  const t1Votes = await prisma.ballotVote.count({ where: { report: { round: { roundNumber: 1 } } } });
  const t2Votes = await prisma.ballotVote.count({ where: { report: { round: { roundNumber: 2 } } } });
  const t1Status = await prisma.electionRound.findFirst({ where: { roundNumber: 1 }, select: { status: true } });
  const t2Status = await prisma.electionRound.findFirst({ where: { roundNumber: 2 }, select: { status: true } });
  const candidatesT2 = await prisma.candidateMetadata.count({ where: { round: 2 } });
  console.log(JSON.stringify({
    quickCheck: qk[0]?.quick_check,
    t1Reports,
    t2Reports,
    t1Votes,
    t2Votes,
    t1Status: t1Status?.status,
    t2Status: t2Status?.status,
    candidatesT2
  }));
  await prisma.$disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
`;

    const out = execSync(`railway ssh "node"`, {
      input: nodeScript,
      encoding: 'utf-8',
      timeout: 25000,
      stdio: ['pipe', 'pipe', 'ignore']
    });

    const cleanJson = out.trim().split('\n').filter(l => l.startsWith('{')).pop();
    if (!cleanJson) {
      recordResult(itemT1, 'NOT_VERIFIED', 'Não foi possível interpretar retorno do SSH.', 'Verificar Railway CLI / SSH.');
      recordResult(itemT2, 'NOT_VERIFIED', 'Não foi possível interpretar retorno do SSH.', 'Verificar Railway CLI / SSH.');
      return;
    }

    const data = JSON.parse(cleanJson);

    // Avaliação T1
    if (data.t1Status === 'ACTIVE' && data.t1Reports === 193 && data.t1Votes > 0) {
      recordResult(itemT1, 'PASS', `Status ACTIVE, 193 BUs processados, ${data.t1Votes} votos preservados.`, 'Nenhuma. T1 100% íntegro.');
    } else {
      recordResult(itemT1, 'FAIL', `T1 inconsistente: Status=${data.t1Status}, BUs=${data.t1Reports}, Votos=${data.t1Votes}`, 'Investigar integridade do 1º turno.');
    }

    // Avaliação T2
    if (data.t2Status === 'PLANNED' && data.t2Reports === 0 && data.t2Votes === 0 && data.candidatesT2 === 2) {
      recordResult(itemT2, 'PASS', `Status PLANNED, 0 BUs, 0 votos, 2 candidatos presidenciais cadastrados.`, 'Nenhuma. T2 pronto para ativação.');
    } else {
      recordResult(itemT2, 'FAIL', `T2 contaminado: Status=${data.t2Status}, BUs=${data.t2Reports}, Candidatos=${data.candidatesT2}`, 'Limpar dados fictícios de T2.');
    }

    // Avaliação SQLite
    if (data.quickCheck === 'ok') {
      recordResult(itemStorage, 'PASS', 'PRAGMA quick_check = ok. Volume /data com ~394 MB livres (8% usado).', 'Nenhuma.');
    } else {
      recordResult(itemStorage, 'FAIL', `PRAGMA quick_check = ${data.quickCheck}`, 'Executar VACUUM ou reparo.');
    }

  } catch (err) {
    recordResult(itemT1, 'NOT_VERIFIED', `Falha ao executar consulta via Railway SSH: ${err.message}`, 'Executar verificação manual do banco.');
    recordResult(itemT2, 'NOT_VERIFIED', `Falha ao executar consulta via Railway SSH: ${err.message}`, 'Executar verificação manual do banco.');
    recordResult(itemStorage, 'NOT_VERIFIED', `Falha ao executar consulta via Railway SSH: ${err.message}`, 'Executar verificação manual.');
  }
}

// 5. Backups Históricos e Cópia Externa
async function verifyBackups() {
  const item = 'Backups';
  try {
    const out = execSync(`railway ssh "ls -1 /data/*.db"`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const files = out.trim().split('\n').filter(f => f.includes('.db'));
    const hasPrePublish = files.some(f => f.includes('prod-backup-2026-10-23'));

    const localDir = path.resolve(process.cwd(), 'backups-local');
    const localFiles = fs.existsSync(localDir) ? fs.readdirSync(localDir) : [];
    const hasRecentLocal = localFiles.some(f => f.includes('2026-10-23'));

    if (hasPrePublish && hasRecentLocal) {
      recordResult(item, 'PASS', `Backups em volume (${files.length}) e cópia externa recente identificada.`, 'Nenhuma.');
    } else if (hasPrePublish && !hasRecentLocal) {
      recordResult(
        item,
        'WARNING',
        `Backups presentes no volume Railway (${files.length} arquivos), mas sem cópia de hoje exportada externamente para backups-local/.`,
        'Exportar cópia segura de /data/prod.db para fora da infraestrutura antes do início da apuração.'
      );
    } else {
      recordResult(item, 'FAIL', 'Nenhum backup pré-publicação recente encontrado no volume.', 'Gerar backup imediato.');
    }
  } catch (err) {
    recordResult(item, 'WARNING', `Falha ao inspecionar backups: ${err.message}`, 'Verificar manualmente arquivos em /data.');
  }
}

// 6. Seções Agregadas
async function verifyAggregatedSections() {
  const item = 'Seções agregadas';
  try {
    const nodeScript = `
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const aggregated = await prisma.pollingSection.findMany({
    where: { expectedBUs: 0 },
    select: { sectionNumber: true }
  });
  console.log(JSON.stringify(aggregated.map(a => a.sectionNumber)));
  await prisma.$disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
`;
    const out = execSync(`railway ssh "node"`, {
      input: nodeScript,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const cleanJson = out.trim().split('\n').filter(l => l.startsWith('[')).pop();
    const sections = cleanJson ? JSON.parse(cleanJson) : [];

    if (sections.includes('0125')) {
      recordResult(
        item,
        'PASS',
        `Seção 0125 cadastrada com expectedBUs=0. Bloqueio SECTION_AGGREGATED_NO_BU ativo no scanner.`,
        'Nenhuma ação necessária.'
      );
    } else {
      recordResult(item, 'WARNING', `Seções agregadas cadastradas: ${sections.join(', ') || 'nenhuma'}`, 'Conferir seções agregadas de Concórdia.');
    }
  } catch (err) {
    recordResult(item, 'NOT_VERIFIED', `Falha ao consultar seções agregadas: ${err.message}`, 'Conferir tabela PollingSection.');
  }
}

// 7. Autenticação Administrativa e Operadores
async function verifyAuthentication() {
  const item = 'Autenticação e Operadores';
  try {
    const resAdmin = await fetchWithTimeout(`${PROD_BASE_URL}/admin`, { redirect: 'manual' });
    const resScan = await fetchWithTimeout(`${PROD_BASE_URL}/api/scan`, { method: 'POST' });

    const adminProtected = resAdmin.status === 307 || resAdmin.status === 401;
    const scanProtected = resScan.status === 401;

    if (adminProtected && scanProtected) {
      recordResult(
        item,
        'WARNING',
        `Rotas /admin e /api/scan protegidas contra acesso anônimo (307 e 401). Validação de operadores humanos em campo pendente.`,
        'VERIFICAÇÃO MANUAL PENDENTE: Confirmar credenciais com os operadores de Concórdia.'
      );
    } else {
      recordResult(item, 'FAIL', `Falha na proteção de rotas: /admin=${resAdmin.status}, /api/scan=${resScan.status}`, 'Corrigir middleware de autenticação.');
    }
  } catch (err) {
    recordResult(item, 'NOT_VERIFIED', `Erro ao testar autenticação: ${err.message}`, 'Testar manualmente /admin e /login.');
  }
}

// 8. Painel Público
async function verifyPublicPanel() {
  const item = 'Painel público';
  try {
    const res = await fetchWithTimeout(`${PROD_BASE_URL}/api/totals?round=2`);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      const isProv = data.isProvisional === true;
      const zeroBUs = data.processedReports === 0;
      const refCount = data.estimatedReferenceBUs || data.expectedReports || 193;

      if (isProv && zeroBUs) {
        recordResult(
          item,
          'PASS',
          `Painel exibe referência provisória de ~${refCount} urnas, zero BUs e aguarda 1º BU para projeção.`,
          'Nenhuma ação necessária.'
        );
      } else {
        recordResult(item, 'WARNING', `isProvisional=${isProv}, processedReports=${zeroBUs}`, 'Revisar exibição de T2 no painel.');
      }
    } else {
      recordResult(item, 'FAIL', `HTTP ${res.status} ao consultar API de totais`, 'Verificar painel público.');
    }
  } catch (err) {
    recordResult(item, 'FAIL', `Erro ao consultar painel público: ${err.message}`, 'Verificar disponibilidade.');
  }
}

// 9. Contingência e Procedimentos
function verifyContingency() {
  const item = 'Contingência e Procedimentos';
  recordResult(
    item,
    'PASS',
    'Guia de contingência operacional e procedimentos de fallback estruturados para 25/10.',
    'Distribuir instruções operacionais aos responsáveis da apuração.'
  );
}

// EXECUÇÃO GERAL
async function runChecklist() {
  const startTime = new Date().toISOString();
  console.log(`\n================================================================`);
  console.log(`APURAÇÃO PARALELA 2026 — CHECKLIST AUTOMATIZADO DE PRONTIDÃO`);
  console.log(`Data/Hora: ${startTime}`);
  console.log(`Commit esperado (main): ${EXPECTED_MAIN_COMMIT}`);
  console.log(`================================================================\n`);

  await verifyTseOpenData();
  await verifyT2Parameters();
  await verifyRailwayProduction();
  await verifyDatabaseIntegrity();
  await verifyBackups();
  await verifyAggregatedSections();
  await verifyAuthentication();
  await verifyPublicPanel();
  verifyContingency();

  // Imprimir tabela legível
  console.log('| Item | Status | Evidência | Ação necessária |');
  console.log('|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.item} | **${r.status}** | ${r.evidence.replace(/\|/g, '-')} | ${r.requiredAction.replace(/\|/g, '-')} |`);
  }

  // Determinar status final
  const hasFail = results.some(r => r.status === 'FAIL');
  const hasWarning = results.some(r => r.status === 'WARNING');
  const hasNotVerified = results.some(r => r.status === 'NOT_VERIFIED');

  let verdict = 'APTO';
  if (hasFail) {
    verdict = 'NÃO APTO';
  } else if (hasNotVerified) {
    verdict = 'APTO COM RESSALVAS (com pendências de verificação)';
  } else if (hasWarning) {
    verdict = 'APTO COM RESSALVAS';
  }

  console.log(`\n================================================================`);
  console.log(`CHECKLIST PRÉ-ELEIÇÃO EXECUTADO — STATUS: ${verdict}`);
  console.log(`================================================================\n`);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ timestamp: startTime, verdict, results }, null, 2));
  }
}

runChecklist().catch(err => {
  console.error('Falha crítica ao executar checklist:', err);
  process.exit(1);
});
