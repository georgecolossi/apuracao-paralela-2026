# Notas da Release e Homologação — Apuração Paralela v2.0.0

Este documento consolida a preparação da release **`v2.0.0`** do **Apuração Paralela 2026** (ciclo **PR 0–PR 9** integrado à branch `feature/v2-universal`), incluindo instruções reprodutíveis de validação, resultado da auditoria de segurança/dependências, ressalvas conhecidas e checklist de publicação manual.

> [!IMPORTANT]
> **Estado de Publicação:** A tag Git `v2.0.0` e a GitHub Release **ainda não foram criadas**. Este PR prepara e homologa o código e a documentação para revisão final e decisão expressa do mantenedor sobre merge para `main`, definição da licença open source e publicação da release.

---

## 1. Resumo das Entregas do Ciclo 2.0 (PR 0–PR 9)

| Marco | Pull Request | Descrição |
| :--- | :--- | :--- |
| **PR 0** | Commits base em `feature/v2-universal` | Fundação arquitetural v2.0, normalização textual, auditoria UTF-8 (`npm run check:encoding`) e governança de cobertura |
| **PR 1** | PR `#12` | Modelo de dados universal multi-eleição (`Election`, `ElectionRound`, `ElectionScope`, `RoundCoverage`, `Office`, `TseSyncConfig`) e setup inicial seguro |
| **PR 2** | PR `#13` | Gestão de usuários e RBAC (`/admin/usuarios`: `ADMIN`, `OPERATOR`, `VIEWER`), `sessionVersion`, proteção do último admin ativo e CSRF fail-closed |
| **PR 3** | PR `#14` | Setup Wizard Universal (`/admin/wizard`, `/api/admin/wizard*`) para eleição, cargos, abrangências, turnos e fontes TSE |
| **PR 4** | PR `#15` | Adaptador Universal Versionado QRBU (`UniversalQrBuParser`: VRQR 4.0, 5.0 e 6.0), reconstrução multipartes e validação SHA-512 |
| **PR 5** | PR `#16` | Redesign do Scanner Mobile (`/admin/scanner`), foco condicional, multipartes fora de ordem e contingência via arquivo/texto manual |
| **PR 6** | PR `#17` | Painel Público Universal (`/apuracao`), agnóstico a cargo/pleito, cobertura provisória vs homologada e projeção linear provisória |
| **PR 7** | PR `#18` | Últimas Urnas Apuradas — Imprensa e Rádio (`/imprensa`, `/api/urnas`, `/api/urnas/[id]`), modal detalhado, roteiro de locução e Teleprompter |
| **PR 8** | PR `#19` | Adaptador Dinâmico de Integração TSE (`/api/tse-results`), anti-proxy, anti-SSRF multi-camada (CIDR + DNS pinning + anti-3xx) e cache contextual (15s) |
| **PR 9** | PR de Homologação (em revisão) | Homologação E2E completa (`e2e/v2-homologation.spec.ts`), correção de persistência/exposição de `hashStatus`/`sigStatus` no fluxo Scanner → Imprensa (`PAG-40`), saneamento documental (remoção de *null bytes* e referências obsoletas) e preparação da release |

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
- **Encoding UTF-8 (`npm run check:encoding`):** aprovado sem ocorrências de `U+FFFD`, mojibake ou *null bytes* nos arquivos de código-fonte e documentação saneada (`docs/ARCHITECTURE.md` tinha 297 *null bytes*, corrigidos em PR 9). O arquivo histórico `prisma/migrations/0_init_postgres.sql` permanece inalterado por ser artefato legado não utilizado no runtime SQLite (`prisma db push`).
- **Schema Prisma (`npx prisma validate`) e TypeScript (`tsc --noEmit`):** aprovados com código de saída `0`.
- **Vitest (`npm run test`):** `61` arquivos aprovados (`61 passed`), com **`753` testes aprovados** e **`1` caso pré-existente marcado com `.skip`** (`754` totais) em `tests/polling-sections-import.test.ts:101` (`it.skip('P) sem ALLOW_PRODUCTION_POLLING_SECTION_IMPORT apply falha', ...)`), mantendo a guarda equivalente coberta em `tests/polling-sections-guard.test.ts`. Inclui o novo teste de regressão `PAG-40` em `tests/pr7-urnas-feed.test.ts`.
- **Playwright E2E (`node scripts/run-e2e.mjs` / `npm run test:e2e`):** **`14/14` testes E2E aprovados** (`0` falhas), cobrindo o novo fluxo completo `e2e/v2-homologation.spec.ts` e as 8 suítes existentes atualizadas para v2.0 (CSRF, schema universal e `RoundCoverage`).
- **ESLint (`npm run lint`):** os arquivos criados ou alterados pelo PR 9 em `e2e/*.ts`, `playwright.config.ts` e `src/lib/presentation/pressDto.ts` possuem **`0` erros e `0` avisos**. O projeto completo reporta **`605` problemas pré-existentes** (`485` erros e `120` avisos, reduzidos de 617 antes do PR 9), concentrados em `@typescript-eslint/no-explicit-any` e variáveis não usadas em scripts/testes/componentes legados — não refatorados amplamente neste PR para manter o escopo focado em homologação.

### Auditoria de Segurança e `npm audit`
- **Varredura de Segredos:** zero chaves privadas, tokens JWT reais ou credenciais de produção versionados em arquivos rastreados pelo Git. `.env` e backups permanecem excluídos via `.gitignore`.
- **`npm audit` (17 vulnerabilidades: 11 moderadas, 3 altas, 3 críticas):**
  - `next@16.3.7` (advisories moderados/altos/críticos relacionados a `'use cache'`, *Image Optimization* com SVG, *Server Actions* DoS e MCP dev server): a aplicação **não utiliza** `'use cache'` nem *Image Optimization* com SVG e o servidor dev não é exposto em produção; recomenda-se avaliar atualização planejada para `next >= 16.4.6` em ciclo futuro pós-homologação com reteste integral.
  - `zod < 4.6.6` (alta — GHSA-mrhx-c7xc-m3w5) e `source-map-js <= 1.2.1` (alta): recomenda-se atualização minor controlada após validação.
  - `vitest <= 4.1.10`, `tinypool <= 2.1.1`, `esbuild <= 0.24.2`, `@vitest/mocker`, `vite` e `@typescript-eslint/*` via `eslint-config-next`: dependências estritamente de desenvolvimento/teste/linting local (requerem upgrades major de toolchain para resolução pelo `npm audit fix --force`).
  - Nenhuma dependência foi alterada no PR 9 para preservar a compatibilidade binária e de comportamento do ciclo PR 8 homologado.

---

## 4. Ressalvas e Limitações Conhecidas da v2.0.0

1. **Verificação Criptográfica do BU:** O sistema valida integralmente a integridade estrutural e o hash **SHA-512** entre o conteúdo lido do QR Code e o código de verificação impresso. **Não realiza** validação assimétrica PKI/ICP-Brasil (`sigStatus` permanece `'UNCHECKED'` até eventual integração futura com chaves públicas oficiais do TSE).
2. **Hardware de Câmera em Testes E2E:** Os testes Playwright validam a UI do scanner via contingência de texto manual e as regras de hardware/câmera por testes unitários e de componente em `tests/mobile-scanner-*`.
3. **Execução E2E com Fixtures `FASE:S`:** Os exemplos públicos oficiais disponibilizados pelo TSE carregam `FASE:S` (Simulado). Por isso, `playwright.config.ts` define `ALLOW_SIMULATED_FASE="true"` **exclusivamente** no runner E2E isolado; a rejeição fail-closed de `FASE !== 'O'` quando a variável não está habilitada é garantida em `tests/t2-scanner-validation.test.ts` e `tests/pre-election-audit.test.ts`, e em produção a flag **deve** permanecer `"false"`.
4. **Cache do Adaptador TSE em Memória:** O cache contextual de 15 segundos de `/api/tse-results` (`src/lib/tse/tseResultsCache.ts`) reside na memória do processo Node.js (em implantações multi-réplica sem *sticky sessions*, cada instância mantém ciclo independente de até 15s, mitigado pelo cabeçalho `Cache-Control: public, max-age=15`).
5. **Licença Open Source Pendente:** Não existe arquivo `LICENSE` definido no repositório; a escolha formal da licença deve ser feita pelo mantenedor antes do lançamento público final.

---

## 5. Checklist Final de Publicação (Ações Manuais Pós-Aprovação)

- [ ] Revisar e aprovar o **PR 9** (`feature/v2-pr9-release` → `feature/v2-universal`).
- [ ] Definir e adicionar arquivo `LICENSE` open source após decisão do mantenedor.
- [ ] Realizar o merge autorizado de `feature/v2-universal` em `main` e atualizar a versão em `package.json` se desejado (`"2.0.0"`).
- [ ] Garantir em produção: `JWT_SECRET` forte, `DISABLE_HTTP_SETUP="true"`, `ALLOW_OPERATIONAL_RESET="false"`, `ALLOW_SIMULATED_FASE="false"`, `APP_URL`/`NEXT_PUBLIC_APP_URL` HTTPS e backup prévio de `/data/prod.db`.
- [ ] Criar e enviar a tag `v2.0.0` (`git tag -a v2.0.0 ... && git push origin v2.0.0`) e publicar a GitHub Release correspondente.
