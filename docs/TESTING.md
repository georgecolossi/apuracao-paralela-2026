# Testes

## Tipos de Testes
1. **Unitários:** 
   Foram criados testes para o `BallotReportParser` na pasta `src/lib/parser`.
   Execução: `npx vitest run`

2. **Integração:**
   As APIs e transações do banco (Prisma) estão preparadas para teste integrado via Vitest + supertest. No protótipo atual usamos testes manuais na interface.

3. **Concorrência (Duplicidade):**
   O teste primário de concorrência é garantido pelo banco de dados através da diretiva `@unique` no campo `deterministicId` da tabela `BallotReport`.
   Dois operadores lendo o mesmo BU simultaneamente resultarão no mesmo ID determinístico sendo gerado. A transação do Prisma emitirá erro na segunda inserção paralela, que a aplicação capta e marca como `DUPLICADO`, protegendo os totais.


## Atualizao Fase 5 (Parser Real)
Posteriormente foi localizado o Manual oficial do QR Code no Boletim de Urna das Eleies 2026. A concluso anterior SCHEMA_2026_UNAVAILABLE estava baseada em busca documental incompleta. O parser agora atua com base no mapeamento chave-valor real do QRBU.
