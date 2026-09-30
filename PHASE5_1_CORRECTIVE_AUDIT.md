# RELATÓRIO DE AUDITORIA CORRETIVA - FASE 5.1

## 1. Fixture Oficial TSE 2026 (Real Oficial Fixtures)
- **Status:** `UNAVAILABLE` (Bloqueio Perimetral / Akamai WAF)
- **Motivo:** A tentativa de download autônomo do ZIP oficial de "Exemplos de Boletins de Urna com QR Code" na URL do TSE resultou em `HTTP 403 Access Denied`.
- **Ação Tomada:** Em rigorosa obediência à regra de que fixtures manipuladas (ex: contendo `ASSI:signaturehere` ou hashes inventados) **NÃO** podem ser classificadas como material oficial original, a antiga pasta `tests/fixtures/tse-2026/official` foi deletada. 
- Foi criada a pasta `tests/fixtures/tse-2026/derived-invalid`, onde o payload sintético reside **unicamente** para validar a máquina de estados estrutural do parser (reconstrução multipart, tokenização e extração).
- A proveniência foi documentada como `UNAVAILABLE` em `docs/TSE-2026-FIXTURE-PROVENANCE.md`.

## 2. Strictness na Validação de Hash
- **Status:** `FIXED`
- **Ação Tomada:** O método que utilizava `.startsWith()` foi substituído por uma comparação criptográfica exata (`===`) no `Tse2026HashValidator.ts`.
- Foi adicionada uma robusta matriz de testes unitários (Casos A-I) incluindo: hashes truncados, modificação do primeiro/último caractere, manipulação de espaço em branco no payload (`TOTC:200 HASH:` vs `TOTC:200  HASH:`), e payloads adulterados. Apenas a correspondência perfeita do hash em SHA-512 integral valida como `VERIFIED`.

## 3. Strictness no Tokenizer
- **Status:** `FIXED`
- **Ação Tomada:** A regex `/([A-Z]{4}):(\S+)/g` foi corrigida para `/([A-Z]+):(\S+)/g`, permitindo parsing resiliente de chaves segundo a especificação oficial, sem limitar compulsoriamente a 4 letras caso o formato do TSE tenha alguma tag diferente.

## 4. Persistência de Votos (`BallotVote`) e DB Placeholders
- **Status:** `FIXED`
- **Ação Tomada:** `candidateNumber` e `partyNumber` foram adicionados como campos diretos (`String?`) no modelo `BallotVote` (Prisma) e agora são injetados diretamente na rota de `scan`. 
- **DB Placeholders Removidos:** O uso de `PLACEHOLDER_HASH` ou `placeholder_signature` na persistência de `BallotReport` e `BallotReportPart` foi substituído pelo salvamento do `hash` e `signature` reais extraídos pelo parser, assim como o `contentHash` real calculado em SHA-256 no backend.

## 5. Identidade Determinística Centralizada
- **Status:** `FIXED`
- **Ação Tomada:** A lógica de interpolação estática foi consolidada em `src/lib/identity.ts` (`buildBallotReportIdentity`).

## 6. Autenticação Restrita de API (Backend Mutative Routes)
- **Status:** `FIXED`
- **Ação Tomada:** Uma API deve se proteger independentemente de Page Middlewares. O helper `requireAuthenticatedUser()` em `src/lib/auth.ts` faz a validação do token JWT do Admin.
- As rotas `/api/scan`, `/api/reports/[id]/confirm` e `/api/reports/[id]/cancel` agora utilizam a validação direta, barrando execuções sem token com HTTP 401. 
- Um teste de E2E explícito na spec certifica que `request.post` desprovido de cookies não autorizado recusa o scan com `401 Unauthorized`.

## 7. PostgreSQL Real - Concorrência e Migrations de Produção
- **Status:** `UNAVAILABLE` (Ambiente sem Docker local), mas a Infraestrutura foi Preparada e Documentada.
- **Ação Tomada:** Seguindo a regra "Se Docker/PostgreSQL não estiver disponível no ambiente: STATUS = UNAVAILABLE", o ambiente atual (Windows PowerShell local) não possui Docker Desktop, impedindo levantar um banco relacional temporário e testar lock por concorrência.
- Entretanto, a "Estratégia Real de Produção PostgreSQL" foi inteiramente entregue:
  1. Criação do `prisma/schema.postgresql.prisma`.
  2. Execução manual da geração do baseline relacional em `prisma/migrations/0_init_postgres.sql`.
  3. Criação de um arquivo `docker-compose.yml` para implantação em produção.
  4. O ambiente de desenvolvimento isolado (`sqlite`) continua operacional e rodou a suíte `vitest` e os testes de lock da aplicação com sucesso, provando o funcionamento lógico das uniqueness constraints.

## 8. Remoção de Lixo e Legacy Parsers
- **Status:** `FIXED`
- **Ação Tomada:** A abstração antiga em `src/lib/parser/index.ts` (`TSE2026Parser`) foi sumariamente deletada e toda a simulação já utiliza `Tse2026SimulationParser.ts` separadamente.

---

### CONCLUSÃO

Todas as descobertas da **FASE 5.1** foram investigadas, resolvidas ou registradas estritamente de acordo com as regras operacionais solicitadas. Não existem mais "atalhos criptográficos", falhas de isolamento do E2E (401 funcionando) ou comprometimento da taxonomia dos payloads (nomeando sintéticos como oficiais). A infraestrutura de Banco Relacional (Postgres) aguarda apenas a disponibilidade de Docker no ambiente alvo para execução das rotinas Playwright contra banco concorrente, com migrations já prontas.
