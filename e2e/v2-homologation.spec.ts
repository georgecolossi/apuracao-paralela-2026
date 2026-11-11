import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { SYNTHETIC_PHASE_O_PRES_T2_PAYLOAD, createE2EPrismaClient } from './helpers/e2eSupport';

test.describe('PR 9 — Homologação E2E Completa v2.0.0', () => {
  const simulatedFixturePath = path.join(
    __dirname,
    '../tests/fixtures/tse-2026/official/examples/Pres-T2_s02202ac0139200090013-imgbu/decoded/qrbu-01-of-01.txt'
  );

  async function resetIsolatedDatabaseForV2() {
    const bcrypt = await import('bcryptjs');
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
    await prisma.auditLog.deleteMany({});

    const adminHash = await bcrypt.hash('admin123', 10);
    const opHash = await bcrypt.hash('operator123', 10);
    const viewerHash = await bcrypt.hash('viewer123', 10);

    await prisma.user.upsert({
      where: { email: 'admin@apuracao.local' },
      update: { passwordHash: adminHash, role: 'ADMIN', isActive: true },
      create: {
        name: 'Administrador E2E',
        email: 'admin@apuracao.local',
        passwordHash: adminHash,
        role: 'ADMIN',
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { email: 'operator-e2e@apuracao.local' },
      update: { passwordHash: opHash, role: 'OPERATOR', isActive: true },
      create: {
        name: 'Operador E2E',
        email: 'operator-e2e@apuracao.local',
        passwordHash: opHash,
        role: 'OPERATOR',
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { email: 'viewer-e2e@apuracao.local' },
      update: { passwordHash: viewerHash, role: 'VIEWER', isActive: true },
      create: {
        name: 'Visualizador E2E',
        email: 'viewer-e2e@apuracao.local',
        passwordHash: viewerHash,
        role: 'VIEWER',
        isActive: true
      }
    });

    const stateAC = await prisma.state.upsert({
      where: { abbreviation: 'AC' },
      update: {},
      create: { abbreviation: 'AC', name: 'Acre' }
    });
    const muniAC = await prisma.municipality.upsert({
      where: { officialCode: '01392' },
      update: { name: 'Rio Branco', isCoverage: true },
      create: { officialCode: '01392', name: 'Rio Branco', stateId: stateAC.id, isCoverage: true }
    });
    await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniAC.id, zoneNumber: '0009' } },
      update: {},
      create: { municipalityId: muniAC.id, zoneNumber: '0009' }
    });

    const stateBA = await prisma.state.upsert({
      where: { abbreviation: 'BA' },
      update: {},
      create: { abbreviation: 'BA', name: 'Bahia' }
    });
    const muniBA = await prisma.municipality.upsert({
      where: { officialCode: '38490' },
      update: { name: 'Salvador', isCoverage: true },
      create: { officialCode: '38490', name: 'Salvador', stateId: stateBA.id, isCoverage: true }
    });

    // Eleição histórica encerrada (FINISHED) para teste de isolamento entre contextos
    await prisma.election.create({
      data: {
        name: 'Eleição Histórica Salvador 2022',
        slug: 'historica-salvador-2022',
        plei: '544',
        year: 2022,
        type: 'GENERAL',
        status: 'FINISHED',
        rounds: { create: [{ roundNumber: 1, plei: '544', status: 'FINISHED' }] },
        scopes: {
          create: {
            scopeType: 'MUNICIPAL',
            scopeKey: 'MUNICIPAL:BA:38490',
            stateId: stateBA.id,
            municipalityId: muniBA.id,
            isCoverageArea: true
          }
        },
        offices: {
          create: [{ code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 }]
        }
      }
    });

    // Eleição em rascunho privado (DRAFT) com BU associado para validar bloqueio público integral
    const draftElection = await prisma.election.create({
      data: {
        name: 'Rascunho Privado 2028',
        slug: 'rascunho-privado-2028',
        plei: '9999',
        year: 2028,
        type: 'MUNICIPAL',
        status: 'DRAFT',
        rounds: { create: [{ roundNumber: 1, plei: '9999', status: 'PLANNED' }] }
      },
      include: { rounds: true }
    });
    await prisma.ballotReport.create({
      data: {
        id: 'e2e-draft-report-id',
        deterministicId: 'E2E-DET-DRAFT-BLOCK',
        electionId: draftElection.id,
        roundId: draftElection.rounds[0].id,
        stateCode: 'AC',
        cityCode: '01392',
        zoneCode: '0009',
        sectionCode: '0091',
        urnCode: '9100001',
        status: 'PROCESSADO',
        confirmedAt: new Date('2028-10-01T18:00:00.000Z')
      }
    });

    // Eleição arquivada (ARCHIVED) com BU associado para validar bloqueio público integral (403)
    const archivedElection = await prisma.election.create({
      data: {
        name: 'Arquivo Legado 2020',
        slug: 'arquivada-legado-2020',
        plei: '404',
        year: 2020,
        type: 'MUNICIPAL',
        status: 'ARCHIVED',
        rounds: { create: [{ roundNumber: 1, plei: '404', status: 'FINISHED' }] }
      },
      include: { rounds: true }
    });
    await prisma.ballotReport.create({
      data: {
        id: 'e2e-archived-report-id',
        deterministicId: 'E2E-DET-ARCHIVED-BLOCK',
        electionId: archivedElection.id,
        roundId: archivedElection.rounds[0].id,
        stateCode: 'AC',
        cityCode: '01392',
        zoneCode: '0009',
        sectionCode: '0092',
        urnCode: '9200001',
        status: 'PROCESSADO',
        confirmedAt: new Date('2020-11-15T18:00:00.000Z')
      }
    });

    await prisma.$disconnect();
  }

  test('Fluxo E2E completo v2.0: Setup/Auth/RBAC -> Wizard/Isolamento -> Scanner UI -> Conferência -> Painel/Imprensa -> TSE Dinâmico', async ({
    page,
    request
  }) => {
    test.setTimeout(90_000);
    await resetIsolatedDatabaseForV2();
    // Payload sintético de teste em formato QRBU FASE:O, com SHA-512 válido.
    // Não corresponde a um BU genuinamente emitido pelo TSE e não representa uma assinatura digital oficial.
    const syntheticPhaseOPayload = SYNTHETIC_PHASE_O_PRES_T2_PAYLOAD;
    const simulatedPhaseSPayload = fs.readFileSync(simulatedFixturePath, 'utf8').trim();

    // 1. Inicialização, rotas públicas e estado fail-closed de /api/setup
    await page.goto('/');
    await expect(page).toHaveURL(/\/apuracao/);

    await page.goto('/metodologia');
    await expect(page.locator('body')).toContainText('Aviso Legal Importante');
    await expect(page.locator('body')).toContainText('Justiça Eleitoral');

    const setupGet = await request.get('/api/setup');
    expect(setupGet.status()).toBe(200);
    const setupState = await setupGet.json();
    expect(setupState.isInitialized).toBe(true);
    expect(setupState.httpSetupEnabled).toBe(false);

    const setupPost = await request.post('/api/setup', {
      data: { name: 'Intruso', email: 'x@example.com', password: 'Password123!' }
    });
    expect(setupPost.status()).toBe(403);

    // 2. Proteção de rotas administrativas e login inválido
    for (const protectedRoute of [
      '/admin',
      '/admin/wizard',
      '/admin/usuarios',
      '/admin/scanner',
      '/admin/cobertura',
      '/admin/preparar'
    ]) {
      await page.goto(protectedRoute);
      await expect(page).toHaveURL(/\/login/);
    }

    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'senha-errada');
    await page.click('button[type="submit"]');
    await expect(page.locator('body')).toContainText('Credenciais inválidas');

    // 2.1 Permissões RBAC: VIEWER e OPERATOR
    await page.fill('input[name="username"]', 'viewer-e2e@apuracao.local');
    await page.fill('input[type="password"]', 'viewer123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/admin/);

    const viewerCsrf = (await (await page.request.get('/api/csrf-token')).json()).csrfToken;
    expect(
      (
        await page.request.post('/api/scan', {
          headers: { 'x-csrf-token': viewerCsrf },
          data: { content: 'TEST', isSimulation: false, sessionId: 'S-VIEWER' }
        })
      ).status()
    ).toBe(403);
    expect(
      (
        await page.request.post('/api/admin/wizard', {
          headers: { 'x-csrf-token': viewerCsrf },
          data: { name: 'Tentativa Viewer', year: 2026, type: 'GENERAL' }
        })
      ).status()
    ).toBe(403);

    await page.goto('/admin');
    await page.click('button[title="Sair"]');
    await expect(page).toHaveURL('/login');

    await page.fill('input[name="username"]', 'operator-e2e@apuracao.local');
    await page.fill('input[type="password"]', 'operator123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    const opCsrf = (await (await page.request.get('/api/csrf-token')).json()).csrfToken;
    expect(
      (
        await page.request.post('/api/admin/wizard', {
          headers: { 'x-csrf-token': opCsrf },
          data: { name: 'Tentativa Operator', year: 2026, type: 'GENERAL' }
        })
      ).status()
    ).toBe(403);
    expect((await page.request.get('/api/admin/users')).status()).toBe(403);

    await page.goto('/admin');
    await page.click('button[title="Sair"]');
    await expect(page).toHaveURL('/login');

    // 3. Login como ADMIN, Setup Wizard (/admin/wizard) e proteção SSRF no Wizard
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    await page.goto('/admin/wizard');
    await expect(page.locator('body')).toContainText('Assistente');

    const adminCsrf = (await (await page.request.get('/api/csrf-token')).json()).csrfToken;

    // 3.1 Rejeição anti-SSRF via Wizard antes de gravar
    const ssrfWizardRes = await page.request.post('/api/admin/wizard', {
      headers: { 'x-csrf-token': adminCsrf },
      data: {
        name: 'Eleição SSRF Bloqueada',
        year: 2026,
        type: 'GENERAL',
        tseConfigs: [
          {
            roundNumber: 2,
            officeCode: '1',
            officialElectionCode: '2202',
            scopeType: 'MUNICIPAL',
            uf: 'AC',
            muniTseCode: '01392',
            sourceUrl: 'http://169.254.169.254/latest/meta-data'
          }
        ]
      }
    });
    expect(ssrfWizardRes.status()).toBe(400);
    expect((await ssrfWizardRes.json()).error).toBe('INVALID_TSE_SOURCE_URL');

    // 3.2 Criação de rascunho válido via Wizard e ativação para o pleito oficial de teste (PLEI 2202, T2)
    const createWizardRes = await page.request.post('/api/admin/wizard', {
      headers: { 'x-csrf-token': adminCsrf },
      data: {
        name: 'Eleição Presidencial E2E 2026',
        year: 2026,
        type: 'GENERAL',
        plei: '2202',
        scopes: [
          {
            scopeType: 'MUNICIPAL',
            stateAbbreviation: 'AC',
            municipalityOfficialCode: '01392',
            municipalityName: 'Rio Branco'
          }
        ],
        rounds: [
          { roundNumber: 1, plei: '2201' },
          { roundNumber: 2, plei: '2202' }
        ],
        offices: [{ code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 }]
      }
    });
    expect(createWizardRes.status()).toBe(200);
    const createdWizard = await createWizardRes.json();
    const activeElectionId = createdWizard.electionId as string;
    expect(activeElectionId).toBeTruthy();

    const activateRes = await page.request.post('/api/admin/wizard/activate', {
      headers: { 'x-csrf-token': adminCsrf },
      data: {
        electionId: activeElectionId,
        confirmationText: 'ATIVAR ELEIÇÃO'
      }
    });
    expect(activateRes.status()).toBe(200);

    // Ativa o 2º Turno para alinhar com o payload sintético de teste FASE:O (TURN:2, PLEI:2202)
    const prisma = await createE2EPrismaClient();
    const rounds = await prisma.electionRound.findMany({
      where: { electionId: activeElectionId },
      orderBy: { roundNumber: 'asc' }
    });
    await prisma.electionRound.update({
      where: { id: rounds[0].id },
      data: { status: 'FINISHED' }
    });
    await prisma.electionRound.update({
      where: { id: rounds[1].id },
      data: { status: 'ACTIVE' }
    });

    // Recarrega /admin/wizard para validar interface com a eleição configurada
    await page.goto(`/admin/wizard?electionId=${activeElectionId}`);
    await expect(page.locator('input').first()).toHaveValue('Eleição Presidencial E2E 2026');

    // 4. Isolamento entre contextos eleitorais (DRAFT/ARCHIVED -> 403; FINISHED histórico e ACTIVE -> 200)
    for (const blockedSlug of ['rascunho-privado-2028', 'arquivada-legado-2020']) {
      for (const blockedUrl of [
        `/api/totals?election=${blockedSlug}&round=1`,
        `/api/urnas?election=${blockedSlug}&round=1`,
        `/api/tse-results?election=${blockedSlug}&round=1`
      ]) {
        const blockedRes = await request.get(blockedUrl);
        expect(blockedRes.status()).toBe(403);
        expect((await blockedRes.json()).error).toBe('CONTEXTO_NAO_AUTORIZADO');
      }
    }
    for (const blockedReportUrl of ['/api/urnas/e2e-draft-report-id', '/api/urnas/e2e-archived-report-id']) {
      const blockedReportRes = await request.get(blockedReportUrl);
      expect(blockedReportRes.status()).toBe(403);
      expect((await blockedReportRes.json()).error).toBe('CONTEXTO_NAO_AUTORIZADO');
    }

    const activeTotalsRes = await request.get(`/api/totals?election=${activeElectionId}&round=2`);
    expect(activeTotalsRes.status()).toBe(200);
    const activeUrnasRes = await request.get(`/api/urnas?election=${activeElectionId}&round=2`);
    expect(activeUrnasRes.status()).toBe(200);

    const histTotalsRes = await request.get('/api/totals?election=historica-salvador-2022&round=1');
    expect(histTotalsRes.status()).toBe(200);
    const histTotals = await histTotalsRes.json();
    expect(histTotals.totals).toHaveLength(0);
    expect((await request.get('/api/urnas?election=historica-salvador-2022&round=1')).status()).toBe(200);
    expect((await request.get('/api/tse-results?election=historica-salvador-2022&round=1')).status()).toBe(200);

    // 5. Ingestão de QRBU via UI de Scanner (/admin/scanner) e rejeições
    await page.goto('/admin/scanner');
    await page.locator('summary:has-text("Entrada Manual de Texto")').click();
    const manualBox = page.locator('textarea[placeholder*="QRBU:"]');
    await expect(manualBox).toBeVisible();

    // 5.1 QRBU inválido / corrompido (hash adulterado)
    const tamperedPayload = syntheticPhaseOPayload.replace(/HASH:[0-9A-F]{4}/, 'HASH:FFFF');
    await manualBox.fill(tamperedPayload);
    await page.click('button:has-text("Processar Texto Manual")');
    await expect(page.locator('body')).toContainText(/integridade|SHA-512|Falha|inválido|CRYPTOGRAPHIC/i);

    // 5.2 QRBU malformado (sintaxe inválida -> 400) e FASE:S rejeitado como oficial (400 SIMULATED_QRBU_REJECTED)
    const invalidFmtRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': adminCsrf },
      data: {
        content: 'INVALID_QRBU_CONTENT',
        isSimulation: false,
        sessionId: `E2E-BAD-${Date.now()}`
      }
    });
    expect(invalidFmtRes.status()).toBe(400);

    const rejectedFaseSRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': adminCsrf },
      data: {
        content: simulatedPhaseSPayload,
        isSimulation: false,
        sessionId: `E2E-FASES-REJECT-${Date.now()}`
      }
    });
    expect(rejectedFaseSRes.status()).toBe(400);
    expect((await rejectedFaseSRes.json()).error).toBe('SIMULATED_QRBU_REJECTED');

    // 5.3 Reinicia sessão do scanner após rejeição e ingere payload sintético FASE:O (SHA-512 válido) pela UI -> abre conferência
    await page.click('button[title="Reiniciar Sessão de Leitura"]');
    await manualBox.fill(syntheticPhaseOPayload);
    await page.click('button:has-text("Processar Texto Manual")');

    await expect(page).toHaveURL(/\/admin\/conferir\//, { timeout: 15000 });
    await expect(page.locator('body')).toContainText('HASH VERIFICADO');
    await expect(page.locator('body')).toContainText('1392');

    // 6. Rejeição de duplicidade ao reenviar o mesmo payload FASE:O
    const dupRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': adminCsrf },
      data: {
        content: syntheticPhaseOPayload,
        isSimulation: false,
        sessionId: `E2E-DUP-${Date.now()}`
      }
    });
    expect(dupRes.status()).toBe(409);
    expect((await dupRes.json()).status).toBe('DUPLICADO');

    // 7. Conferência administrativa -> Confirmar e Totalizar
    await page.click('button:has-text("Confirmar e Totalizar")');
    await expect(page).toHaveURL('/admin/scanner', { timeout: 10000 });

    // 8. Totalização e atualização do painel público (/apuracao)
    await page.goto('/apuracao?round=2');
    await expect(page.locator('body')).toContainText('Eleição Presidencial E2E 2026');
    await expect(page.locator('body')).toContainText('Rio Branco / AC');
    await expect(page.locator('body')).toContainText('Presidente');
    await expect(page.locator('body')).toContainText(/1 urnas apuradas/i);

    const round2Totals = await (await request.get('/api/totals?round=2')).json();
    expect(round2Totals.processedReports).toBe(1);
    expect(round2Totals.totals.length).toBeGreaterThan(0);

    // Eleição histórica de 2022 permanece com 0 urnas mesmo após apuração na eleição ativa
    const histAfter = await (await request.get('/api/totals?election=historica-salvador-2022&round=1')).json();
    expect(histAfter.processedReports).toBe(0);

    // 9. Feed público (/imprensa), filtros, modal com roteiro para rádio e Teleprompter
    await page.goto('/imprensa?round=2');
    await expect(page.locator('body')).toContainText('Últimas Urnas Apuradas');
    await expect(page.locator('body')).toContainText('Zona 9 — Seção 13');

    await page.fill('input[placeholder*="Filtrar por Zona"]', '9');
    await page.fill('input[placeholder*="Filtrar por Seção"]', '13');
    await page.click('button:has-text("Filtrar")');
    await expect(page.locator('body')).toContainText('Zona 9 — Seção 13');

    await page.click('text=Zona 9 — Seção 13');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('SHA-512 Verificado');
    await page.click('button:has-text("Locução para Rádio")');
    await expect(page.getByRole('dialog')).toContainText(/Zona|Seção|0009|0013/i);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.click('button[title*="modo de alta legibilidade"]');
    await expect(page.locator('body')).toContainText('Modo Padrão');

    // 10. Integração TSE dinâmica (ausente -> anti-proxy -> inconsistente/SSRF bloqueado)
    const tseMissing = await request.get('/api/tse-results?round=2');
    expect(tseMissing.status()).toBe(200);
    const tseMissingBody = await tseMissing.json();
    expect(tseMissingBody.status).toBe('NOT_YET_AVAILABLE');
    expect(tseMissingBody.error).toBe('CONFIGURACAO_TSE_AUSENTE');

    const tseTamper = await request.get('/api/tse-results?round=2&uf=sp&url=https://attacker.example/data.json');
    expect(tseTamper.status()).toBe(400);
    expect((await tseTamper.json()).error).toBe('PARAMETRO_NAO_PERMITIDO');

    await prisma.tseSyncConfig.create({
      data: {
        electionId: activeElectionId,
        roundNumber: 2,
        configKey: 'R2:OFFICE-1:MUNICIPAL:AC:01392',
        officeCode: '1',
        officialElectionCode: '2202',
        scopeType: 'MUNICIPAL',
        uf: 'AC',
        muniTseCode: '01392',
        sourceUrl: 'http://127.0.0.1:8080/ea20.json',
        status: 'ACTIVE',
        isActive: true
      }
    });

    const tseSsrfBlocked = await request.get('/api/tse-results?round=2');
    expect(tseSsrfBlocked.status()).toBe(422);
    expect((await tseSsrfBlocked.json()).error).toBe('CONFIGURACAO_TSE_INCONSISTENTE');

    // 11. Gestão administrativa de usuários (/admin/usuarios)
    await page.goto('/admin/usuarios');
    await expect(page.locator('body')).toContainText('admin@apuracao.local');
    await expect(page.locator('body')).toContainText('operator-e2e@apuracao.local');
    await expect(page.locator('body')).toContainText('viewer-e2e@apuracao.local');

    await prisma.$disconnect();
  });

  test('Isolamento de simulação e proteção CSRF fail-closed em mutações autenticadas', async ({ page }) => {
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
      create: { abbreviation: 'AC', name: 'Acre' }
    });
    const muniAC = await prisma.municipality.upsert({
      where: { officialCode: '01392' },
      update: { isCoverage: true },
      create: { officialCode: '01392', name: 'Rio Branco', stateId: stateAC.id, isCoverage: true }
    });
    const zone9 = await prisma.pollingZone.upsert({
      where: { municipalityId_zoneNumber: { municipalityId: muniAC.id, zoneNumber: '0009' } },
      update: {},
      create: { municipalityId: muniAC.id, zoneNumber: '0009' }
    });
    const sec13 = await prisma.pollingSection.upsert({
      where: { pollingZoneId_sectionNumber: { pollingZoneId: zone9.id, sectionNumber: '0013' } },
      update: { expectedBUs: 1 },
      create: { pollingZoneId: zone9.id, sectionNumber: '0013', expectedBUs: 1 }
    });

    const simEle = await prisma.election.create({
      data: {
        name: 'Eleição Simulação Isolada',
        slug: 'simulacao-isolada-v2',
        plei: 'SIM-2202',
        year: 2026,
        type: 'GENERAL',
        status: 'ACTIVE',
        rounds: { create: [{ roundNumber: 1, plei: 'SIM-2202', status: 'ACTIVE' }] },
        offices: { create: [{ code: '1', name: 'Presidente', type: 'MAJORITARIO', orderNumber: 1 }] }
      },
      include: { rounds: true }
    });
    await prisma.roundCoverage.create({
      data: {
        electionRoundId: simEle.rounds[0].id,
        pollingSectionId: sec13.id,
        expectedBUs: 1
      }
    });
    await prisma.$disconnect();

    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');

    // Requisição sem Origin/Referer/x-csrf-token deve ser bloqueada pela política fail-closed (403)
    const noCsrfRes = await page.request.post('/api/scan', {
      data: {
        content: 'SIMULATION|1|1|E2E-NOCSRF|2202|1|AC|01392|9|13|9999999|Presidente,13,13,NOMINAL,77|hash_no_csrf|sig_no_csrf',
        isSimulation: true,
        sessionId: `E2E-NOCSRF-${Date.now()}`
      }
    });
    expect(noCsrfRes.status()).toBe(403);

    // Com CSRF válido, simulação é aceita mas permanece isolada de /api/totals e /api/urnas
    const csrfRes = await page.request.get('/api/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const simRes = await page.request.post('/api/scan', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        content: 'SIMULATION|1|1|E2E-SIM-ISO|2202|1|AC|01392|9|13|9999999|Presidente,13,13,NOMINAL,77|hash_sim_iso|sig_sim_iso',
        isSimulation: true,
        sessionId: `E2E-SIM-ISO-${Date.now()}`
      }
    });
    expect(simRes.status()).toBe(200);
    const simJson = await simRes.json();
    expect(simJson.status).toBe('COMPLETO');

    const confRes = await page.request.post(`/api/reports/${simJson.reportId}/confirm`, {
      headers: { 'x-csrf-token': csrfToken }
    });
    expect(confRes.status()).toBe(200);

    const totalsRes = await page.request.get('/api/totals?round=1');
    expect(totalsRes.status()).toBe(200);
    expect((await totalsRes.json()).totals).toHaveLength(0);

    const urnasRes = await page.request.get('/api/urnas?round=1');
    expect(urnasRes.status()).toBe(200);
    expect((await urnasRes.json()).items).toHaveLength(0);
  });

  test('Segurança do endpoint POST /api/login: payload inválido (400), rate limit por par (429 + UI) e isolamento entre contas', async ({
    page,
    request
  }) => {
    await page.goto('/login');

    // 1. JSON malformado enviado literalmente via browser fetch retorna 400 controlado (INVALID_PAYLOAD)
    const malformedPayloadRes = await page.evaluate(async () => {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid-json'
      });
      return { status: res.status, body: await res.json() };
    });
    expect(malformedPayloadRes.status).toBe(400);
    expect(malformedPayloadRes.body.code).toBe('INVALID_PAYLOAD');

    // 2. 5 falhas direcionadas para conta isolada retornam 401 padronizado
    const probeAccount = `rate-limit-probe-${Date.now()}@apuracao.local`;
    for (let i = 0; i < 5; i++) {
      const failRes = await request.post('/api/login', {
        data: { username: probeAccount, password: `wrong-${i}` }
      });
      expect(failRes.status()).toBe(401);
    }

    // 3. 6a tentativa via UI /login é bloqueada com HTTP 429 + Retry-After e feedback claro na interface
    await page.fill('input[name="username"]', probeAccount);
    await page.fill('input[type="password"]', 'qualquer-senha');
    const [rateLimitedResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/login') && res.request().method() === 'POST'),
      page.click('button[type="submit"]')
    ]);
    expect(rateLimitedResponse.status()).toBe(429);
    expect(Number(rateLimitedResponse.headers()['retry-after'])).toBeGreaterThan(0);
    await expect(page.locator('body')).toContainText(/Muitas tentativas de login/i);

    // 4. Outra conta na mesma rede/IP não é bloqueada pelo par bloqueado
    await page.fill('input[name="username"]', 'admin@apuracao.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/admin/scanner');
  });
});
