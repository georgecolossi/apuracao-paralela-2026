# AUDITORIA FINAL - Sistema de Apuração Paralela 2026

## 1. Resumo executivo
A auditoria técnica independente foi realizada na base de código atual do projeto "Apuração Paralela 2026". A aplicação estabeleceu com sucesso a fundação arquitetural, o modelo de dados seguro (SQLite/Prisma), e o fluxo principal de decodificação e processamento de QR Codes em múltiplas partes. No entanto, a auditoria identificou lacunas significativas em relação à totalidade dos requisitos originais do documento mestre, especialmente no que tange a telas administrativas secundárias, tratamento robusto de exceções criptográficas e testes fim-a-fim.

## 2. Status geral do projeto
O projeto encontra-se em um estado **NÃO PRONTO** para operação isolada sem intervenções, devendo passar pela Fase 2 de correções para suprir pendências de interface, configuração de ambiente e tratamento estrito de concorrência.

## 3. Matriz de requisitos

| ID | Requisito | Implementação encontrada | Arquivo(s) | Status | Evidência | Problema |
|----|-----------|--------------------------|-------------|--------|-----------|----------|
| REQ-01 | Arquitetura | Next.js, React, Prisma, SQLite | `package.json`, `schema.prisma` | OK | Estrutura coerente. (SQLite documentado como workaround) | Nenhum (exceção validada). |
| REQ-02 | Modelo de Dados | Tabelas completas (Election, BU, Votes) | `schema.prisma` | OK | Relacionamentos e enums em status. | Faltam chaves estrangeiras complexas para candidatos oficiais. |
| REQ-03 | Identidade do BU | Chave `deterministicId` única | `schema.prisma` | OK | `@unique` no DB garantindo deduplicação lógica. | Nenhum. |
| REQ-04 | QR Code Multipartes | Lógica no parser e no endpoint de scanner | `lib/parser/index.ts`, `api/scan/route.ts` | OK | O parser lê e agrupa por `sequenceId`. | Nenhum. |
| REQ-05 | Parser | Separado, sem DB, testável | `lib/parser/index.ts` | OK | Retorna `ParseError` ou payload estruturado. | Usa formato texto customizado devido a falta de biblioteca oficial ASN.1 na spec. |
| REQ-06 | Validação Estrutural | Regras de parse funcionais | `lib/parser/index.ts` | OK | Valida campos e cabeçalhos. | Nenhum. |
| REQ-07 | Validação Hash/Assinatura | Funções existem mas são simuladas | `lib/parser/index.ts` | PARCIAL | Código alerta ausência de implementação criptográfica real. | Utiliza regra flexibilizadora de documentar o gap, mas continua sendo parcial. |
| REQ-08 | Transação de Contabilização | DB Transaction no `confirm` | `api/reports/[id]/confirm/route.ts` | OK | `prisma.$transaction` envolve update de BU e AuditLog. | Nenhum. |
| REQ-09 | Páginas Administrativas | Apenas scanner, login e conferência | `app/admin/*` | NÃO IMPLEMENTADO | Várias páginas faltantes. | Faltam `/admin/dashboard`, `/admin/audit`, `/admin/configuracao`, etc. |
| REQ-10 | Apuração e BUs esperados | BUs processados são mostrados | `app/apuracao/page.tsx` | PARCIAL | Mostra total processado. | Não há cálculo de cobertura baseada em BUs esperados (não configurado). |
| REQ-11 | Realtime | SSE integrado | `api/realtime/route.ts` | OK | Eventos emitidos após commit no BD. | Nenhum. |
| REQ-12 | Página de Metodologia | Explicação técnica | `app/metodologia/page.tsx` | NÃO IMPLEMENTADO | Arquivo não existe. | Página obrigatória ausente. |
| REQ-13 | Testes Completos | Apenas testes unitários de parser | `parser.test.ts` | PARCIAL | Faltam testes E2E, DB e Concorrência. | Suíte de testes muito reduzida. |

## 4. Variáveis e configurações
- **Nomes incorretos/Hardcoded:** No `api/scan/route.ts`, ocorre um lookup estático via mock simples para `office` (ele cria se não existir em vez de validar a configuração estrita do banco).
- **Mocks remanescentes:** A autenticação no `middleware.ts` e `api/login/route.ts` checa credenciais fixas (`admin`/`admin`) e gera um cookie mockado `mock-jwt-token-for-demo`. Isso foi permitido apenas para demonstração do requisito `login funciona`, mas fere o princípio de não gerar código "FAKE".
- **Variáveis não utilizadas:** O endpoint `/api/scan` inicializa metadados com nomes que podem causar conflitos sem documentação estrita de payload (ex: stateCode `'TMP'`).
- **Quantidade de BUs esperados:** Variável nem existe no banco/agregação, quebrando regra explícita de cálculo de cobertura.

## 5. Banco de dados
- **Schema:** Completo.
- **Constraints UNIQUE:** A constraint `deterministicId` em `BallotReport` previne corrupção de votos na raiz de concorrência.
- **Problema:** A aplicação usa o `urnCode` temporário para armazenar o `sequenceId` de multipartes. Isso é um **HACK** e deve ser corrigido para uma tabela auxiliar de multipartes ou armazenamento de cache apropriado para evitar contaminação do ID da Urna com um sequence gerado pelo QR scanner.

## 6. BU & 7. QR Code
- O Parser agrupa corretamente. Se duas partes idênticas forem lidas, o frontend trava a duplicidade pelo estado (`scanResult === decodedText`), e no backend a tabela `BallotReportPart` falha (se houvesse uniqness) ou apenas aceita e sobrepõe, mas na reconstrução (`allPartsCount >= totalParts`) pode haver problemas se um operador mandar a parte 1 três vezes. **Problema Médio**: `partIndex` precisa ter constraint unique atrelado ao `reportId`.

## 8. Parser
- Testável, puro. OK.
- Não implementa os campos adicionais (ex: eleitorado apto, faltosos, encerramento).

## 9. Hash & 10. Assinatura digital
- Assinatura: `return true` (na prática não valida). **PARCIAL**.

## 11. Validação & 12. Deduplicação
- Deduplicação no cenário de concorrência estrita (Cenário B) no `/api/scan`:
  Se duas requisições simultâneas de um BU `COMPLETO` alcançarem a checagem `findUnique({ where: { deterministicId } })` no mesmo milissegundo, ambas passam, e na linha do `update` que altera o ID determinístico para a chave final, o Prisma lançará uma exceção `P2002` (Unique Constraint Failed) para a segunda requisição. A transação falhará e os votos não serão duplicados, mas o operador receberá um erro HTTP 500 genérico em vez do aviso correto de `DUPLICADO`.

## 13. Contabilização & 14. Agregação
- OK. `AggregationService` opera varrendo a tabela `BallotVote` atrelada a relatórios `PROCESSADO`. Não há totais mágicos.

## 15. Percentuais
- NÃO IMPLEMENTADO. Não há denominadores configurados, logo não há percentuais mostrados no front.

## 16. Painel público & 17. Realtime
- Funcionais. SSE conectado e atualizando. 
- Faltam filtros geográficos.

## 18. Auditoria & 19. Segurança
- Auditoria criada no DB, mas não exposta na interface (`/admin/audit` faltando).
- Segurança falha (`admin/admin` hardcoded).

## 20. API & 21. Frontend
- Interfaces mínimas. Telas de gestão ausentes.

## 22. Testes
- **NÃO IMPLEMENTADOS INTEGRALMENTE:** O script E2E, o de concorrência e o teste de recálculo exigidos explícitamente nas regras 34 e 35 não foram elaborados.

## 23. Dependências
- Vitest resolvido com downgrade devido a incompatibilidade com a versão Node declarada.

## 24. Variáveis de ambiente
- O arquivo `.env` nem foi gerado ou documentado explicitamente com o placeholder para produção. O `.env.example` foi ignorado.

## 25. Problemas encontrados
- **Login Fake**: Hardcoded auth na API.
- **Hack de Sequence ID**: Uso de `urnCode` como repositório temporário do `sequenceId`.
- **Race Condition de Status**: O operador 2 toma erro 500 em vez de `DUPLICADO` se ler exatamente no mesmo milissegundo que o operador 1 no disparo da requisição POST de scan.
- **Falta de Validação de BUs Esperados e Percentuais**.

## 26. Riscos
- O "Hack" do `urnCode` temporário significa que leituras incompletas poluem a tabela de BUs com códigos errôneos.
- Ausência de testes de concorrência significa que não temos evidência empírica das contenções além da teoria da base.

## 27. Funcionalidades faltantes
- Múltiplas rotas administrativas `/admin/*`.
- `/metodologia`.
- Componentes percentuais de votos.
- Testes E2E, Integração e Concorrência.
- Documentação e configuração do `.env.example`.

## 28. Correções recomendadas
1. Implementar autenticação via cookies baseados em JWT real.
2. Refatorar a captura de partes de QR em uma estrutura própria temporária (`PendingQR`) antes de alocar um `BallotReport`.
3. Criar os módulos de `ExpectedBUs` e de cálculo percentual.
4. Escrever e rodar testes de integração via `supertest` no próprio workspace simulando concorrência em promises atiradas paralelamente.
5. Criar as rotas estáticas faltantes para satisfazer o requisito.

## 29. Evidências
- Inspeção manual do código fonte e saídas das queries. O teste de build passou, provando integridade de Typescript, e o unitário do parser passou em 5ms. O restante das análises baseia-se no código estático e falta de assets no diretório `app/`.
