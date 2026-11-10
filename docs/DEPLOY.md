# Guia de Deploy e Banco de Dados

O runtime padrão do projeto utiliza **Next.js 16 (App Router) + Prisma ORM 5 + SQLite** (`prisma/schema.prisma`), permitindo execução simples com persistência em disco ou volume montado (`/data`). Há também um schema alternativo legado para PostgreSQL em `prisma/schema.postgresql.prisma`.

---

## 1. Implantação Padrão (SQLite + Volume Persistente)

1. Configure um volume persistente montado em `/data` e defina as variáveis obrigatórias:
   ```env
   DATABASE_URL="file:/data/prod.db"
   JWT_SECRET="<chave-aleatoria-segura-com-minimo-32-caracteres>"
   APP_URL="https://seu-dominio.exemplo.org"
   NEXT_PUBLIC_APP_URL="https://seu-dominio.exemplo.org"
   ALLOW_OPERATIONAL_RESET="false"
   ALLOW_SIMULATED_FASE="false"
   DISABLE_HTTP_SETUP="false"
   ```
   Consulte todas as variáveis disponíveis em [`.env.example`](../.env.example).
2. Aplique o schema ao banco persistente:
   ```bash
   npx prisma generate
   npx prisma db push
   ```
3. Crie o primeiro administrador usando `node scripts/create-initial-admin.mjs` ou `POST /api/setup` e, em seguida, altere `DISABLE_HTTP_SETUP="true"` em produção.
4. Execute o build e suba o servidor atrás de proxy HTTPS (obrigatório para cookies `HttpOnly` com flag `Secure` e validação estrita de CSRF):
   ```bash
   npm run build
   npm start
   ```

---

## 2. Opção Alternativa: PostgreSQL (`prisma/schema.postgresql.prisma`)

Para ambientes que optarem por PostgreSQL externo (ou container local de apoio em `docker-compose.yml`):
1. Utilize o arquivo `prisma/schema.postgresql.prisma` como schema ativo ao gerar o Prisma Client.
2. Defina `DATABASE_URL="postgresql://usuario:senha@host:5432/apuracao?schema=public"`.
3. Mantenha o tratamento atômico de concorrência via chave `UNIQUE` em `BallotReport.deterministicId` (código `P2002` retorna HTTP `409`).
