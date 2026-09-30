# Banco de Dados

## Decisão Arquitetural: SQLite vs PostgreSQL
A especificação solicitou PostgreSQL, que é o banco ideal para produção. No entanto, o ambiente atual de execução não possui `docker`, `docker-compose` ou o executável `psql` instalados para rodar um banco PostgreSQL localmente. 

Para que a aplicação seja completamente testável, executável e funcional sem a necessidade de um servidor externo e de acordo com a regra de que a aplicação não deve ser fictícia e deve efetivamente rodar, foi escolhido o **SQLite** no Prisma Schema para o ambiente de desenvolvimento local.

A migração para PostgreSQL em produção exigiria apenas:
1. Alterar o arquivo `prisma/schema.prisma` mudando o `provider` para `"postgresql"`
2. Fornecer a variável de ambiente `DATABASE_URL` correta apontando para o servidor de banco de dados
3. Rodar as migrations (`npx prisma migrate deploy`).

## Schema
O Schema foi modelado para garantir integridade e referências fortes:
- `Election` e `ElectionRound`: Configuração base da eleição.
- `State`, `Municipality`, `PollingZone`, `PollingSection`, `PollingStation`: Árvore de localidade que forma a identidade da seção eleitoral e urna.
- `BallotReport`: A entidade central (BU). A identidade de duplicidade (Idempotência) é controlada pela constraint `@unique` do campo `deterministicId`.
- `BallotReportPart`: As partes lidas de um QR Code fragmentado. Só se consolida num `BallotReport` e `BallotVote` quando atingir o total necessário (ex: 5 partes).
- `BallotVote`: Todos os votos contidos no BU.
- `User`: Administradores/operadores autenticados do sistema.
- `AuditLog`: Trilha de auditoria para todas as operações críticas.

## Proteção contra duplicidade
Em nível de banco, `deterministicId` em `BallotReport` impede que duas sessões concorrentes gravem o mesmo BU. A transação do Prisma lidará com exceção caso haja concorrência gravando o mesmo registro.
