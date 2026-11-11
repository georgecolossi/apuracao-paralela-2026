# Changelog

Todas as mudanças notáveis do projeto **Apuração Paralela 2026** estão documentadas neste arquivo.
O versionamento segue o padrão [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [2.0.0] — Preparação de Release (PR 0–PR 9 integrados em `feature/v2-universal`)

> **Status:** Ciclo **PR 0–PR 9** integrado na branch consolidada `feature/v2-universal` (PR #20 integrado em 10/11/2026 via commit de merge `ea1f679d1f9c651ae2f3c53814a9f54667656bb8`). **Versão ainda não publicada:** arquivo `LICENSE` ainda não definido, tag Git `v2.0.0` ainda não criada, GitHub Release `v2.0.0` ainda não publicada e deploy em produção não autorizado nem executado.

### Adicionado
- **Modelo de Dados Universal (PR 1 / #12):** Entidades `Election`, `ElectionRound`, `ElectionScope`, `RoundCoverage`, `Office` por eleição e `TseSyncConfig`, suportando múltiplas eleições simultâneas/históricas e abrangências `MUNICIPAL`, `ESTADUAL` e `NACIONAL`.
- **Gestão de Usuários e RBAC (PR 2 / #13):** Tela `/admin/usuarios` e endpoints `/api/admin/users*` com perfis `ADMIN`, `OPERATOR` e `VIEWER`, alteração de senha, revogação instantânea via `sessionVersion`, trava contra remoção do último `ADMIN` ativo e política fail-closed em `JWT_SECRET` e `/api/setup`.
- **Setup Wizard Universal (PR 3 / #14):** Fluxo em `/admin/wizard` e `/api/admin/wizard*` para criar, editar em `DRAFT`, configurar cargos, turnos, abrangências e fontes do TSE e ativar eleições sem intervenção no código-fonte.
- **Adaptador Universal QRBU (PR 4 / #15):** `UniversalQrBuParser` com suporte versionado a leiautes `VRQR` 4.0, 5.0 e 6.0, reconstrução de boletins multipartes, validação SHA-512 estrita e checagem de invariantes de votação.
- **Scanner Mobile Redesign (PR 5 / #16):** Nova UI em `/admin/scanner` com visor otimizado 4:3, deduplicador, rastreamento multipartes e contingência offline por upload de imagem ou texto manual.
- **Painel Público Universal (PR 6 / #17):** `/apuracao` agnóstico a cargo e pleito, seleção por `?election=` e `?round=`, distinção entre cobertura provisória e homologada e projeção linear com garantia de não regressão e ocultação automática aos 100%.
- **Imprensa & Rádio (PR 7 / #18):** Módulo `/imprensa` (**Últimas Urnas Apuradas**) com APIs paginadas por cursor (`/api/urnas` e `/api/urnas/[id]`), filtros por Zona/Seção, modal de integridade SHA-512, gerador automático de roteiro para locução em rádio e modo Teleprompter.
- **Adaptador Dinâmico TSE (PR 8 / #19):** `GET /api/tse-results` inteiramente dirigido por `TseSyncConfig` e Setup Wizard, com cache contextual de 15 segundos (`tseResultsCache`), bloqueio anti-proxy e validação anti-SSRF multi-camada (bloqueio CIDR IPv4/IPv6 privados, DNS multi-registro com socket pinning e bloqueio de redirecionamentos `3xx`).
- **Homologação E2E, Documentação e Auditoria Final (PR 9 / #20):**
  - Nova suíte E2E ponta a ponta (`e2e/v2-homologation.spec.ts`) validando autenticação, RBAC, Setup Wizard, isolamento de rascunho/histórico/simulação, proteção CSRF fail-closed, scanner UI, conferência, `/apuracao`, `/imprensa` e `/api/tse-results`.
  - Criação de `CHANGELOG.md` e [`docs/RELEASE_V2.0.0.md`](docs/RELEASE_V2.0.0.md) com checklist de publicação e análise de segurança/dependências.

### Corrigido e Aprimorado
- **Persistência e Exposição de `hashStatus` / `sigStatus` (PR 9):** `POST /api/scan` passou a persistir explicitamente as colunas `hashStatus` e `sigStatus` em `BallotReport` via `toCryptographicStatus`, e as APIs `/api/urnas` e `/api/urnas/[id]` passaram a utilizar `resolveCryptographicStatus` (com fallback seguro para `validationData` em boletins legados), garantindo exibição fiel de **`SHA-512 Verificado`** e no roteiro de locução da sala de imprensa.
- **Compatibilização Completa e Fidelidade de Produção da Suíte E2E (PR 9):** Atualização de `playwright.config.ts` e das suítes Playwright para tokens CSRF (`/api/csrf-token`), schema universal, `RoundCoverage` e uso exclusivo/fail-closed de `file:./e2e.db` via `e2e/helpers/e2eSupport.ts`; execução E2E com `ALLOW_SIMULATED_FASE="false"`, uso de payloads sintéticos de teste em formato QRBU `FASE:O` com SHA-512 válido (não correspondentes a BUs genuínos emitidos pelo TSE nem a assinaturas digitais oficiais), preservação intacta dos fixtures `FASE:S` originais com validação explícita de rejeição (`SIMULATED_QRBU_REJECTED`) em modo oficial e isolamento de `isSimulation: true` em `/api/totals` e `/api/urnas`.
- **Saneamento Integral de Documentação e Encoding (PR 9):** Remoção de 297 *null bytes* e mojibake em `docs/ARCHITECTURE.md` e `docs/TESTING.md`; remoção de variáveis inexistentes em `.env.example` (`COVERAGE_CITY_CODES`, `ADMIN_INITIAL_PASSWORD`) e de script inexistente em `docs/OPERACAO.md` (`pre-election-readiness.mjs`); separação explícita entre Desenvolvimento Local, Homologação e Produção em `docs/OPERACAO.md`; alinhamento de `README.md`, `docs/BACKUP.md` e `docs/DEPLOY.md` ao runtime SQLite + Prisma 2.0, com distinção explícita entre integridade por SHA-512, ausência de validação offline de assinatura digital (`sigStatus`) e origem autêntica de BU oficial.

### Segurança
- **Integridade de `ScanSession` em `POST /api/scan` (PR 9):** Validação prévia obrigatória (`validateScanSessionCompatibility`) antes de persistir partes ou trocar parser em sessões existentes, bloqueando alternância entre modo real e simulação (`SCAN_SESSION_MODE_MISMATCH`), divergência de `expectedParts` (`SCAN_SESSION_PARTS_MISMATCH`) e reutilização por outro operador (`SCAN_SESSION_OPERATOR_MISMATCH`), coberta por `tests/scan-session-integrity.test.ts`.
- Endurecimento anti-SSRF e anti-DNS-rebinding em `validateTseSourceUrl` / `executePinnedHttpGetJson` (`src/lib/validation/electionContext.ts` e `src/lib/tse/tseResultsService.ts`).
- Política CSRF fail-closed em rotas mutáveis autenticadas (`src/lib/security/csrf.ts`).
- Atualização de dependências de runtime e segurança sem breaking changes: `next` (`16.3.7` → `16.4.6`), `eslint-config-next` (`16.3.7` → `16.4.6`), `zod` (`4.6.5` → `4.6.7`, corrigindo `GHSA-mrhx-c7xc-m3w5`) e `source-map-js` (`1.2.1` → `1.2.2`, corrigindo `GHSA-68fv-2mgg-jv7q`), resultando em **0 vulnerabilidades de produção (`npm audit --omit=dev`)**; 14 vulnerabilidades transitivas/devDependencies remanescentes em ferramentas de teste/lint documentadas em [`docs/RELEASE_V2.0.0.md`](docs/RELEASE_V2.0.0.md).

---

## [1.0.0] — Operação Piloto Concórdia/SC 2026 (`main`)

### Resumo Histórico
- Implementação inicial do coletor QRBU, conferência administrativa, banco SQLite persistente em volume e painel público dedicados à eleição de Concórdia/SC (`80837`), contabilizando **193 de 193 urnas** (18.837 votos) no 1º Turno e preparando o adaptador e cobertura provisória do 2º Turno.
