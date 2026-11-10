# Estratégia e Execução de Testes — Apuração Paralela 2.0

A suíte automatizada valida integridade criptográfica de Boletins de Urna (QRBU), isolamento de eleições e turnos, controle de acesso RBAC, proteção CSRF, adaptador dinâmico do TSE (anti-SSRF e cache contextual), sala de imprensa e fluxo ponta a ponta no navegador.

---

## 1. Isolamento de Bancos de Teste

Os testes **nunca** utilizam o banco de desenvolvimento (`prisma/dev.db`) nem bancos de produção:

- **Vitest (`npm run test`):** executado por [`scripts/run-tests.mjs`](../scripts/run-tests.mjs), que limpa e recria `prisma/test.db` com `prisma db push`, popula o contexto de teste via `prisma/seeds/test-seed.ts`, roda o Vitest sequencialmente (`--no-file-parallelism --exclude e2e`) e remove `test.db` ao finalizar.
- **Playwright E2E (`npm run test:e2e`):** executado por [`scripts/run-e2e.mjs`](../scripts/run-e2e.mjs), que cria `prisma/e2e.db`, aplica o schema, executa `seed-test-coverage.ts`, sobe o servidor de testes configurado em `playwright.config.ts` e remove `e2e.db` após concluir. Todos os workers e chamadas a `PrismaClient` no diretório `e2e/` utilizam [`createE2EPrismaClient`](../e2e/helpers/e2eSupport.ts) com verificação fail-closed de `DATABASE_URL="file:./e2e.db"`.

> [!NOTE]
> A suíte E2E executa com `ALLOW_SIMULATED_FASE="false"` em [`playwright.config.ts`](../playwright.config.ts), reproduzindo fielmente o comportamento de produção. Os fluxos principais utilizam **payloads sintéticos de teste em formato QRBU `FASE:O`, com SHA-512 válido** ([`SYNTHETIC_PHASE_O_PRES_T2_PAYLOAD`](../e2e/helpers/e2eSupport.ts)), os quais **não correspondem a um BU genuinamente emitido pelo TSE e não representam assinatura digital oficial** — eles validam exclusivamente o parsing estrutural, a integridade de conteúdo por SHA-512 e o fluxo de persistência. Os fixtures originais `FASE:S` do TSE (`tests/fixtures/tse-2026/official/...`) permanecem preservados em disco e são testados em E2E para comprovar rejeição estrita (`HTTP 400 SIMULATED_QRBU_REJECTED`) quando enviados como oficiais (`isSimulation: false`). Testes explícitos de simulação (`isSimulation: true`) permanecem isolados e validam ausência de vazamento para `/api/totals` e `/api/urnas`. Todos os workers e chamadas a `PrismaClient` no diretório `e2e/` utilizam [`createE2EPrismaClient`](../e2e/helpers/e2eSupport.ts) com verificação fail-closed de `DATABASE_URL="file:./e2e.db"`.

---

## 2. Comandos de Verificação

```bash
# 1. Auditoria de encoding UTF-8 (sem null bytes ou caracteres corrompidos)
npm run check:encoding

# 2. Validação do schema Prisma
npx prisma validate

# 3. Verificação estática de tipos TypeScript
npm run typecheck

# 4. Suíte unitária e de integração (Vitest)
npm run test

# 5. Suíte Ponta a Ponta (Playwright)
npm run test:e2e

# 6. Análise estática ESLint
npm run lint

# 7. Build de produção Next.js
npm run build
```

---

## 3. Cobertura das Suítes

### Testes Unitários e de Integração (`tests/`)
- **Adaptador Universal e Parsing QRBU:** `universal-qrbu-adapter.test.ts`, `tse2026-parser.test.ts`, `tse-turno2-fixtures.test.ts`, `official-fixture-integrity.test.ts`, `official-fixture.integration.test.ts`, `bu-dat-mapper.test.ts`, `bu-dat-dryrun.test.ts`.
- **Integridade, Idempotência e Auditoria:** `integration.test.ts`, `apply-transaction.test.ts`, `apply-payload.test.ts`, `scan-idempotency.integration.test.ts`, `scan-session-integrity.test.ts`, `scansession.test.ts`, `t2-scanner-validation.test.ts`, `pre-election-audit.test.ts`, `migration-integrity.test.ts`.
- **Segurança, Autenticação, RBAC e CSRF:** `auth.test.ts`, `api-login.test.ts`, `apply-security.test.ts`, `apply-production-auth.test.ts`, `pr1-secure-setup.test.ts`, `pr2-user-management.test.ts`, `scan-auth.integration.test.ts`, `admin-reset.test.ts`.
- **Contexto Universal, Turnos, Wizard e Cobertura:** `pr1-data-model.test.ts`, `pr1-coverage-integrity.test.ts`, `pr1-final-adjustments.test.ts`, `pr3-wizard.test.ts`, `admin.turnos.integration.test.ts`, `cobertura.integration.test.ts`, `election-context.test.ts`, `round-isolation.test.ts`, `simulation-isolation.test.ts`, `totals.round.integration.test.ts`, `polling-sections-guard.test.ts`, `polling-sections-import.test.ts`.
- **Painel Público, Imprensa e Scanner Mobile:** `aggregation.test.ts`, `apuracao-helper.test.ts`, `apuracao-separacao.integration.test.ts`, `pr6-public-dashboard.test.ts`, `public-dashboard-component.test.tsx`, `pr7-urnas-feed.test.ts`, `pr7-radio-script.test.ts`, `pr7-press-component.test.tsx`, `mobile-scanner-*.test.*`, `scanner-deduplicator.test.ts`, `scansession.test.ts`, `scanner-and-tse-sync-hotfix.test.ts`.
- **Adaptador Dinâmico TSE (EA20, Anti-SSRF, Cache 15s):** `pr8-dynamic-tse.test.ts`, `tse-adapter.test.ts`, `vote-enricher.test.ts`, `metadata.integration.test.ts`, `normalization.test.ts`, `api-export.test.ts`, `encoding-audit.test.ts`.

### Testes Ponta a Ponta (`e2e/`)
- `e2e/v2-homologation.spec.ts`: fluxo completo v2.0 (Setup -> Auth/RBAC -> Wizard multi-eleição e isolamento de rascunho/histórico -> Scanner UI manual + rejeições -> Conferência -> `/apuracao` -> `/imprensa` com modal/rádio/teleprompter -> `/api/tse-results` dinâmico + anti-proxy/anti-SSRF -> `/admin/usuarios` + proteção CSRF fail-closed e segregação de simulação).
- `e2e/auth-logout.spec.ts`, `e2e/admin-navigation.spec.ts`, `e2e/coverage.spec.ts`, `e2e/official-qrbu.spec.ts`, `e2e/synthetic-fixture.spec.ts`, `e2e/simulation.spec.ts`, `e2e/reset.spec.ts`, `e2e/reset-auth.spec.ts`.

---

## 4. Limitações de Testes Conhecidas

- **Hardware de Câmera Física em Headless Browser:** O navegador Chromium headless em ambiente E2E não possui câmera física com QR Code impresso; o fluxo completo de scanner é validado combinando entrada manual de texto oficial/corrompido na interface (`/admin/scanner`) e testes unitários/de componente dos módulos em `src/lib/scanner/` e `tests/mobile-scanner-*`.
- **Disponibilidade Externa da API do TSE:** Consultas HTTP reais contra `resultados.tse.jus.br` dependem da publicação ativa de cada pleito pelo TSE; na suíte automatizada, o serviço é validado com mocks controlados em Vitest e validação real de ausência/anti-proxy/anti-SSRF em Playwright.
