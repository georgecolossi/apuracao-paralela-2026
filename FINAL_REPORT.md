# Relatório Final - Sistema de Apuração Paralela 2026

## 1. Implementado
O sistema completo foi desenvolvido e estruturado conforme os requisitos:
- **Painel Administrativo:** Fluxo completo, login simulado (admin/admin), middleware de proteção.
- **Scanner Web:** Tela responsiva usando a câmera para leitura de QR Code multipartes.
- **Parser TSE 2026:** Abstração estruturada que processa blocos multipartes com ID de sequência, faz validação estrutural básica (Hash placeholder).
- **Tratamento de Duplicidade:** Banco garante integridade, identificando duplicidade com chave unificada (`deterministicId`).
- **Agregação em Tempo Real:** Painel público conectado via Server-Sent Events (SSE) para refletir a confirmação do operador imediatamente.
- **Transações Seguras:** SQLite/Prisma operando contabilização de BUs e registro de Auditoria (Logs) atomicamente.

## 2. Testado
- Testes unitários do `BallotReportParser` (validação de headers, sequenciamento e payload binário para JSON simulado) rodando via Vitest.
- Build Next.js (TypeScript strict mode, ESLint linting).

## 3. Documentação TSE utilizada
- [TSE - Eleições 2026](https://www.tse.jus.br/eleicoes/eleicoes-2026)
- Assumido modelo base 2020/2022 do "Manual para criação de aplicativos de leitura". A lacuna de chaves públicas oficiais foi registrada no arquivo `docs/TSE-2026.md`.

## 4. Limitações
- Devido à falta de Docker na máquina para execução local imediata, e seguindo a regra fundamental de que o software entregue **deve rodar**, foi escolhido o `SQLite` em vez do `PostgreSQL` no Prisma Schema para demonstração. O schema é perfeitamente compatível, bastando mudar 2 linhas no Prisma para migrar para produção em AWS/GCP.
- A validação criptográfica (ECC / Assinatura Digital) está modelada na tabela e no parser, mas implementa um mock transparente, conforme especificado na regra de documentar lacunas, aguardando o pacote binário definitivo do TSE para importar as chaves públicas oficiais.

## 5. Decisões Técnicas
- **Next.js (App Router):** Escolhido por permitir SSR do Painel, rotas API backend sem precisar levantar Express separado, facilitando o deploy num único Vercel ou contêiner Docker.
- **Idempotência (deterministicId):** Para proteção transacional contra cliques duplos, o ID foi construído mesclando campos base do TSE antes da inserção.
- **Realtime (SSE):** Mais leve que WebSockets para o caso de uso. O painel apenas recebe os dados do back-end, nunca manda, o que combina com o modelo HTTP Server-Sent Events nativo sem usar socket.io pesado.

## 6. Como executar (Localmente)
```bash
cd C:\Users\Smart\.gemini\antigravity\scratch\apuracao-paralela-2026
npm install
npx prisma db push
npx tsx prisma/seed.ts
npm run dev
```

- **Acesse o Scanner:** `http://localhost:3000/admin/scanner` (Login: admin / admin)
- **Acesse o Painel:** `http://localhost:3000/apuracao`

## 7. Como fazer deploy
- Utilizar `Vercel` para front-end e edge functions com integração nativa ao repo.
- Provisionar banco em provedor (ex: Supabase, Neon).
- Atualizar `.env` com `DATABASE_URL`.
- Modificar `prisma/schema.prisma` definindo `provider = "postgresql"`.
- Rodar `npx prisma migrate deploy` no build e iniciar o server de prod.

## 8. Variáveis de ambiente
- `DATABASE_URL` (obrigatória para prod, ausente no dev-sqlite).

## 9. Segurança
- Rotas REST e Páginas restritas por Middleware de verificação de cookie.
- Proteção nativa CSRF do Next.js e sanitização de query parameters.
- Hashes nas senhas e trilhas obrigatórias na tabela `AuditLog` para ações de alteração de estado do BU.

## 10. Próximos passos
- Conectar chaves ED25519 ou RSA reais do TSE.
- Inserir biblioteca de decodificação ASN.1 DER específica para processar a string real ao invés do Mock com Pipes (que cumpre a demonstração funcional).
