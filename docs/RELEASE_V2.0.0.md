# Notas da Release e Homologação — Apuração Paralela v2.0.0

Este documento consolida a preparação da versão **`v2.0.0`** do **Apuração Paralela 2026** (ciclo **PR 0–PR 9** integrado à branch `feature/v2-universal` em 10/11/2026 por meio do **PR #20**, commit de merge `ea1f679d1f9c651ae2f3c53814a9f54667656bb8`), incluindo instruções reprodutíveis de validação, resultado completo de `npm audit`, ressalvas conhecidas e checklist de publicação manual.

> [!IMPORTANT]
> **Estado de Publicação e Integração:**
> - **Branch consolidada (`feature/v2-universal`):** PR 0–PR 9 integrados (PR #20 integrado com commit de merge `ea1f679d1f9c651ae2f3c53814a9f54667656bb8`).
> - **Ainda pendente de autorização e execução manual:** arquivo `LICENSE` ainda não definido, tag Git `v2.0.0` ainda não criada, GitHub Release `v2.0.0` ainda não publicada, integração em `main` e deploy em produção ainda não realizados.

---

## 1. Resumo das Entregas do Ciclo 2.0

| Marco | Pull Request / Branch | Estado Atual | Descrição |
| :--- | :--- | :--- | :--- |
| **PR 0** | Commits base em `feature/v2-universal` | **Integrado** | Fundação arquitetural v2.0, normalização textual, auditoria UTF-8 (`npm run check:encoding`) e governança de cobertura |
| **PR 1** | PR `#12` | **Integrado** em `feature/v2-universal` | Modelo de dados universal multi-eleição (`Election`, `ElectionRound`, `ElectionScope`, `RoundCoverage`, `Office`, `TseSyncConfig`) e setup inicial seguro |
| **PR 2** | PR `#13` | **Integrado** em `feature/v2-universal` | Gestão de usuários e RBAC (`/admin/usuarios`: `ADMIN`, `OPERATOR`, `VIEWER`), `sessionVersion`, proteção do último admin ativo e CSRF fail-closed |
| **PR 3** | PR `#14` | **Integrado** em `feature/v2-universal` | Setup Wizard Universal (`/admin/wizard`, `/api/admin/wizard*`) para eleição, cargos, abrangências, turnos e fontes TSE |
| **PR 4** | PR `#15` | **Integrado** em `feature/v2-universal` | Adaptador Universal Versionado QRBU (`UniversalQrBuParser`: VRQR 4.0, 5.0 e 6.0), reconstrução multipartes e validação SHA-512 |
| **PR 5** | PR `#16` | **Integrado** em `feature/v2-universal` | Redesign do Scanner Mobile (`/admin/scanner`), foco condicional, multipartes fora de ordem e contingência via arquivo/texto manual |
| **PR 6** | PR `#17` | **Integrado** em `feature/v2-universal` | Painel Público Universal (`/apuracao`), agnóstico a cargo/pleito, cobertura provisória vs homologada e projeção linear provisória |
| **PR 7** | PR `#18` | **Integrado** em `feature/v2-universal` | Últimas Urnas Apuradas — Imprensa e Rádio (`/imprensa`, `/api/urnas`, `/api/urnas/[id]`), modal detalhado, roteiro de locução e Teleprompter |
| **PR 8** | PR `#19` | **Integrado** em `feature/v2-universal` | Adaptador Dinâmico de Integração TSE (`/api/tse-results`), anti-proxy, anti-SSRF multi-camada (CIDR + DNS pinning + anti-3xx) e cache contextual (15s) |
| **PR 9** | PR `#20` (`feature/v2-pr9-release`) | **Integrado** em `feature/v2-universal` (`ea1f679`) | Homologação E2E com `ALLOW_SIMULATED_FASE="false"` e payloads sintéticos `FASE:O` com SHA-512 válido (`e2e/v2-homologation.spec.ts`), isolamento obrigatório de `file:./e2e.db`, integridade de `ScanSession` (`SCAN_SESSION_*_MISMATCH`), correção de `hashStatus`/`sigStatus` (`PAG-40`), remediação de dependências (`next@16.4.6`, `eslint-config-next@16.4.6`, `zod@4.6.7`, `source-map-js@1.2.2`), saneamento documental e preparação da release |

---

## 2. Reprodução de Instalação e Validação Local

```bash
# 1. Instalar dependências
npm install

# 2. Configurar ambiente local (ajuste JWT_SECRET >= 32 caracteres)
cp .env.example .env

# 3. Validar schema e aplicar banco local de desenvolvimento (se desejado subir o servidor dev)
npx prisma validate
npx prisma db push
node scripts/create-initial-admin.mjs "admin@local.test" "SenhaForteLocal123" "Admin Local"

# 4. Executar bateria completa de homologação (bancos isolados test.db e e2e.db)
npm run check:encoding
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

---

## 3. Evidências de Auditoria e Qualidade Observadas no PR 9

### Suítes de Teste e Build
- **Encoding UTF-8 (`npm run check:encoding`):** aprovado sem ocorrências de `U+FFFD`, mojibake ou *null bytes* nos arquivos de código-fonte e documentação saneada (`docs/ARCHITECTURE.md` tinha 297 *null bytes*, corrigidos no PR 9). O arquivo histórico `prisma/migrations/0_init_postgres.sql` permanece inalterado por ser artefato legado não utilizado no runtime SQLite (`prisma db push`).
- **Schema Prisma (`npx prisma validate`) e TypeScript (`npm run typecheck`):** aprovados com código de saída `0`.
- **Vitest (`npm run test` -> `node scripts/run-tests.mjs --no-file-parallelism`):** `62` arquivos aprovados (`62 passed`), com **`758` testes aprovados** e **`1` caso pré-existente marcado com `.skip`** (`759` totais) em `tests/polling-sections-import.test.ts:101` (`it.skip('P) sem ALLOW_PRODUCTION_POLLING_SECTION_IMPORT apply falha', ...)`), mantendo a guarda equivalente coberta em `tests/polling-sections-guard.test.ts`. Inclui o novo conjunto `tests/scan-session-integrity.test.ts` (5 testes de regressão para integridade de `ScanSession`) e `PAG-40` em `tests/pr7-urnas-feed.test.ts`.
- **Playwright E2E (`npm run test:e2e` -> `node scripts/run-e2e.mjs`):** **`14/14` testes E2E aprovados** (`0` falhas), executando com `ALLOW_SIMULATED_FASE="false"` em [`playwright.config.ts`](../playwright.config.ts) e isolamento explícito `DATABASE_URL="file:./e2e.db"` via [`createE2EPrismaClient`](../e2e/helpers/e2eSupport.ts):
  - Fluxo principal em `e2e/v2-homologation.spec.ts`, `e2e/official-qrbu.spec.ts`, `e2e/coverage.spec.ts` e `e2e/reset.spec.ts` utiliza **payload sintético de teste em formato QRBU `FASE:O`, com SHA-512 válido** ([`SYNTHETIC_PHASE_O_PRES_T2_PAYLOAD`](../e2e/helpers/e2eSupport.ts)), que **não corresponde a um BU genuinamente emitido pelo TSE e não representa uma assinatura digital oficial** (valida exclusivamente integridade de conteúdo por SHA-512 e persistência).
  - Preserva os fixtures originais `FASE:S` do TSE intactos em disco e valida explicitamente sua **rejeição (`HTTP 400 SIMULATED_QRBU_REJECTED`)** quando enviados como oficiais (`isSimulation: false`).
  - Mantém os cenários de simulação separados (`e2e/simulation.spec.ts`, `e2e/reset-auth.spec.ts` e teste dedicado em `e2e/v2-homologation.spec.ts`), comprovando ausência de vazamento de boletins `isSimulation: true` para `/api/totals` e `/api/urnas`.
- **ESLint (`npm run lint`):** todos os arquivos criados ou alterados pelo PR 9 em `src/lib/scanner/sessionValidator.ts`, `src/app/api/scan/route.ts`, `tests/scan-session-integrity.test.ts`, `src/lib/presentation/pressDto.ts`, `e2e/*.ts`, `e2e/helpers/*.ts`, `playwright.config.ts` e `seed-test-coverage.ts` reportam **`0` erros e `0` avisos**. O repositório completo reporta **`604` problemas pré-existentes** (`485` erros e `119` avisos, reduzidos de 617 antes do PR 9), concentrados em arquivos legados fora do escopo do PR 9.
- **Build de Produção (`npm run build`):** compilação Next.js 16.4.6 (Turbopack), TypeScript e geração das rotas aprovadas com saída `0`.

### Remediação e Auditoria de Dependências (`npm audit`)
- **Versões Finais Auditadas (`npm ls next eslint-config-next zod source-map-js sharp`):**
  - `next`: **`16.4.6`** (atualizada de `16.3.7` — elimina todos os 10 advisories críticos/altos/moderados de Next.js).
  - `eslint-config-next`: **`16.4.6`** (atualizada de `16.3.7`).
  - `zod`: **`4.6.7`** (atualizada de `4.6.5` — elimina `GHSA-mrhx-c7xc-m3w5`).
  - `source-map-js`: **`1.2.2`** (atualizada transitivamente de `1.2.1` via `npm update source-map-js` sem adição como dependência direta — elimina `GHSA-68fv-2mgg-jv7q`).
  - `sharp`: **`0.35.5`** (dependência de `next@16.4.6`).
- **Auditoria de Produção (`npm audit --omit=dev`):** **`found 0 vulnerabilities`** (zero vulnerabilidades em dependências de runtime/produção).
- **Auditoria Completa (`npm audit` / `npm audit --json`):** **`14` vulnerabilidades remanescentes (`11` moderadas, `1` alta, `2` críticas)**, **100% restritas a `devDependencies`** (sem uso de `--force` e sem upgrade major disruptivo de `vitest` ou downgrade inválido de `eslint-config-next`):

| Pacote | Severidade | Vínculo | Advisories Principais | Condição de Exploração | Exposição Real & Mitigação Verificável |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **`vitest`** (`<=4.1.10`, instalado `2.1.9`) | **Crítica** | Direta (`devDependencies`) | `GHSA-5xrq-8626-4rwp`, `GHSA-82fw-gwwq-j7x9` | Execução do servidor **Vitest UI (`--ui`)** em rede exposta ou registro remoto em `@vitest/mocker`. | **Zero exposição em produção** (`npm audit --omit=dev` = 0; ausente em `src/`, `prisma/` e `next.config.ts`). Em [`vitest.config.ts`](../vitest.config.ts) e [`scripts/run-tests.mjs`](../scripts/run-tests.mjs), executa apenas via CLI headless local (`npx vitest run ...`). |
| **`tinypool`** (`<=2.1.1`) | **Crítica** | Transitiva via `vitest` | `GHSA-5gmw-xhrv-c9v3`, `GHSA-85c8-ppgw-ccpr` | *Prototype pollution* via opções arbitrárias passadas ao pool de workers. | Restrito à execução local do Vitest CLI em ambiente de testes sem entrada externa não confiável e ausente de `dependencies` de runtime. |
| **`vite`** (`<=6.4.3`) / **`vite-node`** | **Alta** / Mod. | Transitiva via `vitest` | `GHSA-4w7w-66w2-5vf9`, `GHSA-v6wh-96g9-6wx3`, `GHSA-698v-4r3x-3vcv`, `GHSA-r825-w8mm-5pxw`, `GHSA-587h-7wmj-h5pm`, `GHSA-9jrq-w75r-8gcw`, `GHSA-rq7h-c2jc-7f22`, `GHSA-fx2h-pf6j-xcff` | Servidor HTTP dev do Vite exposto à rede ou `launch-editor` em dev server. | Projeto usa **Next.js (`next dev`/`next start`)**, não Vite server; `vite`/`vite-node` atuam apenas internamente no Vitest offline (`scripts/run-tests.mjs`). |
| **`@vitest/mocker`** (`<=4.1.11`) | Moderada | Transitiva via `vitest` | `GHSA-82fw-gwwq-j7x9`, `GHSA-qxg6-89mg-rqv8` | Ambiente Vitest browser/UI HTTP mocker exposto. | Não exposto em rede nem presente no bundle Next.js. |
| **`esbuild`** (`<=0.24.2`) | Moderada | Transitiva via `vite` | `GHSA-67mh-4wv8-2f99` | Site malicioso consultar dev server local do esbuild/Vite aberto. | Não há servidor esbuild persistente exposto; utilizado somente por Vitest durante execução pontual de testes. |
| **`minimatch`** (`7.0.0–11.0.0`) e cadeia **`@typescript-eslint/*`** / **`typescript-eslint`** / **`eslint-config-next`** | Moderada | Transitiva via `eslint-config-next` (`devDependencies`) | `GHSA-g3hv-75wg-m249` (ReDoS em *globparts*) | Processamento de padrões *glob* controlados por atacante no ESLint CLI. | Executado exclusivamente em análise estática local (`npm run lint`) sobre `eslint.config.mjs` estático; correção sugerida pelo npm seria downgrade major inválido para `eslint-config-next@15.5.29` (incompatível com Next 16). |

- **Varredura de Segredos:** zero chaves privadas, tokens JWT reais ou credenciais de produção versionados em arquivos rastreados pelo Git.

---

## 4. Ressalvas e Limitações Conhecidas

1. **Verificação Criptográfica do BU:** O sistema valida integralmente a integridade estrutural e o hash **SHA-512** entre o conteúdo lido do QR Code e o código de verificação impresso. **Não realiza** validação assimétrica PKI/ICP-Brasil (`sigStatus` permanece `'UNCHECKED'` até eventual integração futura com chaves públicas oficiais do TSE).
2. **Hardware de Câmera em Testes E2E:** Os testes Playwright validam a UI do scanner via contingência de texto manual e as regras de hardware/câmera por testes unitários e de componente em `tests/mobile-scanner-*`.
3. **Cache do Adaptador TSE em Memória:** O cache contextual de 15 segundos de `/api/tse-results` (`src/lib/tse/tseResultsCache.ts`) reside na memória do processo Node.js (em implantações multi-réplica sem *sticky sessions*, cada instância mantém ciclo independente de até 15s, mitigado pelo cabeçalho `Cache-Control: public, max-age=15`).
4. **Licenciamento Pendente:** Não existe arquivo `LICENSE` definido no repositório; nenhuma licença foi assumida ou escolhida neste PR, cabendo a decisão formal exclusivamente ao mantenedor.

---

## 5. Checklist Final de Publicação

### Concluído na Branch Consolidada (`feature/v2-universal`)
- [x] Concluir auditoria independente, aprovar e integrar o **PR #20** (`feature/v2-pr9-release` → `feature/v2-universal`, commit de merge `ea1f679d1f9c651ae2f3c53814a9f54667656bb8`).

### Pendente de Autorização / Execução Manual
- [ ] Definir os termos de licenciamento e adicionar o arquivo `LICENSE` após decisão do mantenedor.
- [ ] Realizar o merge autorizado de `feature/v2-universal` em `main` e atualizar a versão em `package.json` caso desejado (`"2.0.0"`).
- [ ] Garantir em produção: `JWT_SECRET` forte, `DISABLE_HTTP_SETUP="true"`, `ALLOW_OPERATIONAL_RESET="false"`, `ALLOW_SIMULATED_FASE="false"`, `APP_URL`/`NEXT_PUBLIC_APP_URL` HTTPS e backup prévio de `/data/prod.db`.
- [ ] Criar e enviar a tag `v2.0.0` e publicar a GitHub Release `v2.0.0` após aprovação expressa.
