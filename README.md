# Apuração Paralela — Concórdia

Este é o repositório de suporte ao projeto de validação em tempo real e consolidação paralela, com objetivo de ser um sistema de retaguarda de processamento de apuração das eleições.

O projeto permite a leitura, via câmera ou input direto, dos dados dos Boletins de Urna (BUs) extraídos no formato QRBU do Tribunal Superior Eleitoral (TSE). Estes QR Codes condensam a ata impressa fisicamente. Com o uso deste sistema, qualquer pessoa com permissões operacionais pode enviar as partes do QR para um banco de dados, que fará as conferências estritas de formato e integridade.

Atualmente, o projeto está sendo estruturado para a cobertura exclusiva da cidade de **Concórdia - Santa Catarina (Código TSE 80837)**. No entanto, o catálogo nacional de municípios continua habilitado para suporte a fixtures de testes de outras UFs.

## Funcionalidades principais
- **Decodificador QRBU V2026**: Extração dos dados baseada no manual de especificação técnica para as eleições.
- **Deduplicação Inteligente**: Não permite registrar o mesmo Boletim de Urna duas vezes, assegurando exatidão na somatória matemática.
- **Painel em Tempo Real (SSE)**: Permite visualização pública que auto-atualiza a cada nova urna submetida.
- **Auditoria de Operações**: Trilha de ações que armazena qual usuário validou, reverteu ou confirmou relatórios.

## Estrutura do projeto
```text
prisma/      # Arquivos do banco de dados relacional e seeds (SQLite)
src/app/     # Páginas Web e APIs em NextJS 15+
src/lib/     # Regras de negócios, parsers em Typescript, criptografia
tests/       # Suítes de testes puramente unitários e de integração
e2e/         # Rotinas E2E rigorosas utilizando Playwright em Chromium
external-fixtures/ # Arquivos brutos de payloads oficiais do TSE (testes)
```

## Rotas principais
| Rota | Finalidade | Acesso |
| --- | --- | --- |
| `/` | Home ou roteador inicial | Público |
| `/apuracao` | Painel de visualização pública com totalizações | Público |
| `/login` | Acesso aos portais administrativos | Público |
| `/admin` | Dashboard interno / listagem de sessões escaneadas | ADMIN / OPERATOR |
| `/admin/scanner` | Interface para acionar a câmera e escanear o QRBU | ADMIN / OPERATOR |
| `/admin/conferir/[id]` | Formulário para revisão final do resultado lido | ADMIN / OPERATOR |
| `/admin/conferencia` | Listagem global para auditoria visual de resultados | ADMIN / OPERATOR |
| `/admin/audit` | Timeline centralizada de acessos, erros e atividades | ADMIN / OPERATOR |
| `/admin/recalcular` | Página informativa sobre a integridade da totalização | ADMIN / OPERATOR |
| `/admin/preparar` | Interface destrutiva para resetar sistema | ADMIN |
| `/metodologia` | Página contendo contexto explicativo | Público |

## Configuração
O arquivo `.env.example` acompanha o repositório contendo exemplos técnicos estruturais seguros. Copie-o para `.env`:

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="secret_for_local_dev"
ADMIN_INITIAL_PASSWORD="admin_password"
```

## Instalação para desenvolvimento
1. Realize a clonagem deste repositório.
2. Configure suas variáveis copiando `.env.example` para `.env`.
3. Instale as dependências: `npm install`
4. Prepare o banco de dados (SQLite local): `npm run db:setup`
   > **Atenção**: O arquivo `prisma/dev.db` é estritamente local e **não é versionado**. A fonte de verdade estrutural é o arquivo `prisma/schema.prisma`. O comando de setup sincroniza o schema, importa municípios, candidatos e cria o usuário de desenvolvimento `admin@apuracao.local`.
5. **Configuração de Cobertura**: O bootstrap NÃO impõe uma cobertura geográfica automaticamente. Acesse `/admin/cobertura` com o usuário admin e selecione explicitamente "Concórdia/SC (80837)". Sem cobertura válida, o sistema opera de modo *fail-closed* e recusa BUs.
6. Inicie o Server de desenvolvimento: `npm run dev`

## Testes
A suite foi construída baseando-se em testes exaustivos e isolados com Playwright e Vitest.

- Validação estática de Tipos: `npm run typecheck`
- Lint de código: `npm run lint`
- Testes Unit/Integration: `npm test`
- Testes E2E (Playwright): `npm run test:e2e`
- Build do NextJS: `npm run build`

## Fixtures TSE 2026
Os diretórios de testes (`tests/` e `external-fixtures/`) hospedam exemplos baseados nas normativas.

- **Fixtures OFICIAIS**: Exemplos/fixtures provenientes do pacote oficial do TSE (manuais de testes). Elas costumam utilizar candidatos fictícios.
- **Fixtures SINTÉTICAS**: Utilizadas para forçar testes lógicos e simulações focando primariamente no motor semântico.

## Segurança
- Autenticação JWT estrita limitando acesso à API e às rotas admin.
- Regra de Role `ADMIN` protegendo ações sensíveis.
- A deduplicação é feita do lado do servidor (Server-Side), limitando qualquer chance de conflito via requisições simultâneas.
- Registros de Eventos mantidos via a tabela `AuditLog`.

*(Reforço: Este projeto não deve ser descrito, sob nenhuma circunstância, como sistema eleitoral oficial ou infraestrutura oficial da Justiça Eleitoral).*

## Arquitetura de Testes e Bancos de Dados

O projeto obedece ao princípio de **isolamento total de banco de dados** para as suítes automatizadas, garantindo que o desenvolvimento local e os testes em CI não colidam:

*   **`prisma/dev.db`**: Banco de dados exclusivo do ambiente de **desenvolvimento local**. Nunca é apagado, sobrescrito ou modificado pelas suítes automatizadas. Os testes automatizados possuem uma trava `fail-closed` que impede sua execução caso apontem para este arquivo.
*   **`prisma/test.db`**: Banco de dados efêmero usado pelas suítes unitárias e de integração (`vitest`). É recriado, configurado com seeds de testes determinísticos e excluído automaticamente no ciclo de vida de `npm run test`.
*   **`prisma/e2e.db`**: Banco de dados exclusivo para os testes End-to-End do **Playwright** (`npm run test:e2e`).

## Resolução de Metadados de Candidatos e Comportamento de Apuração

O processamento e persistência dos votos é baseado estritamente no código do BU (QRBU), que se mantém como a fonte primária e irrefutável da verdade. A base local de `CandidateMetadata` atua única e exclusivamente como **enriquecimento visual de apresentação** para as interfaces gráficas.

*   A resolução ocorre classificando os candidatos em `FOUND`, `NOT_FOUND` ou `AMBIGUOUS`.
*   A ausência ou ambiguidade de metadados para um candidato (e.g. nomes fictícios de fixtures de teste TSE ou candidatos não catalogados) **nunca bloqueia o fluxo**, não altera o registro original e não impede o processamento do BU.
*   Nomes de candidatos ou legendas partidárias não são forjados, deduzidos ou inseridos como fallbacks — na indisponibilidade, apenas a identificação numérica original de urna é exposta ("Nome não identificado").
*   Votos com `quantity = 0` emitidos pelo QRBU original continuam preservados fisicamente no banco de dados para plena capacidade de auditoria, porém, não são listados no painel público de apuração.
*   **Limitação Conhecida / Escopo Concórdia**: O painel operacional é oficialmente **Concórdia (80837)**. Devido a limitações de agregação do Prisma (`groupBy` vs tabelas relacionais), a rota de totalização atual adota SC e BR como base rígida de contexto espacial. Outros municípios (e UFs) de fixtures ainda podem ser lidos/persistidos, mas a visualização do painel se aterá à estrutura definida.

## Referências oficiais
A implementação de parsing é dependente dos padrões adotados e abertos pela Justiça Eleitoral para as Eleições 2026.
- Tribunal Superior Eleitoral: https://www.tse.jus.br

## Licença
Consulte o arquivo LICENSE, quando disponibilizado.
