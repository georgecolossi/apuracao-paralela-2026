# Guia de Deploy e Banco de Dados (PostgreSQL)

O sistema foi estruturado com Prisma ORM, o que significa que transitar de SQLite para PostgreSQL requer apenas mudança nas variáveis de ambiente e um comando de schema generation.

## 1. Variáveis de Ambiente (.env)

Em produção, altere as credenciais no `.env` do servidor:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/apuracao2026?schema=public"
JWT_SECRET="chave_segura_de_256_bits"
```

## 2. Preparando o Banco
Rode os comandos do Prisma para aplicar as _constraints_, chaves primárias e transações robustas do Postgres:
```bash
npx prisma generate
npx prisma db push
```

## 3. Concorrência Segura
A aplicação trata contenção via captura atômica do erro `P2002` do Prisma. Em PostgreSQL, dois operadores processando o mesmo QR Code ativarão a trava `UNIQUE` do campo `deterministicId`, resultando em um 409 limpo e preservando a integridade.

## 4. Build de Produção
```bash
npm run build
npm start
```
É mandatório o uso de HTTPS via Reverse Proxy (ex: Nginx, Traefik) ou Vercel para garantir a segurança dos cookies HTTP-Only de autenticação.
