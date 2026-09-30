# Fase 5.3 — Prontidão Operacional e Apuração Paralela (Relatório)

A fase de prontidão operacional resolveu todos os blockers arquiteturais que inviabilizavam uma totalização paralela real e segura.

## 1. Ajuste do Fallback de Scan Session
**Problema:** O backend utilizava `"QRBU"` como `sequenceId` global sempre que o frontend não provesse um ID único de sessão, agrupando de forma corrompida scans concorrentes.
**Solução:** O endpoint `/api/scan` agora rejeita sumariamente a requisição com código `SCAN_SESSION_REQUIRED` caso `sessionId` seja omitido. Além disso, implementamos checagem de conflitos no nível do banco para rejeitar pedaços de payload caso sejam detectadas discrepâncias sob a mesma parte e sessão (`CONFLICTING_PART`).

## 2. Refatoração da Agregação de Totalização
**Problema:** O relatório final agregava votos usando as colunas relacionais `candidateId` e `partyId`, que são propositalmente mapeadas como opcionais para desacoplar a ingestão da eleição do banco de metadados de candidatos.
**Solução:** Todas as queries de agregação (`/api/totals` e `AggregationService`) foram refatoradas para agrupar nativamente pelos identificadores absolutos presentes no parser (`candidateNumber`, `partyNumber`, `officeId`, `voteType`).

## 3. Identidade Determinística e Duplicidade Concorrente
**Problema:** A `deterministicId` dos BUs não continha escopo de Pleito e Turno, gerando conflito potencial e falhando ao processar eleições simuladas e reais em conjunto. O controle de concorrência era vulnerável.
**Solução:** O `buildBallotReportIdentity` foi atualizado para combinar: `PLEI`, `TURN`, `UNFE`, `MUNI`, `ZONA`, `SECA`, `IDUE`. Uma transação do Prisma com verificação de condição de corrida (`P2002` exact-time duplicate constraint) foi implementada em `/api/scan`. Retorna explicitamente o código `DUPLICADO` se um operador processar um BU já existente no banco.

## 4. Isolamento Completo da Simulação
**Problema:** Votos da simulação do front-end poderiam misturar-se com votos reais caso os endpoints de totalização não fizessem a filtragem rígida de `isSimulation`.
**Solução:** Foi aplicado o filtro `isSimulation: false` em todas as queries públicas (`api/totals`, `AggregationService`). Implementamos um teste E2E nativo (`tests/simulation-isolation.test.ts`) que cria 900 votos falsos contra 100 verdadeiros e assegura matematicamente que apenas 100 chegam nas rotas.

## 5. Migração de Banco de Dados Documentada
**Problema:** Prisma schema misturava SQLite com instruções para produção PostgreSQL.
**Solução:** SQLite foi mantido no `schema.prisma` para DEV, enquanto o `schema.postgresql.prisma` foi atualizado para apontar com prioridade à variável `env("DATABASE_URL")`. Instruções objetivas foram inseridas no `README.md`.

## 6. Scripts Operacionais e Testes Limpos
Todos os testes foram aprovados e os pacotes contam com `test`, `test:unit`, `test:e2e` e `typecheck`.
O sistema está estável, independente, assíncrono para os operadores, determinístico nas identidades de BU e criptograficamente rígido na verificação das assinaturas em Hash. A plataforma não possui mais placeholders para apuração e atua 100% sobre o modelo eleitoral de 2026.
