# Apuração Paralela — Concórdia

Este é o repositório de suporte ao projeto de validação em tempo real e consolidação paralela, com objetivo de ser um sistema de retaguarda de processamento de apuração das eleições.

O projeto permite a leitura, via câmera ou input direto, dos dados dos Boletins de Urna (BUs) extraídos no formato QRBU do Tribunal Superior Eleitoral (TSE). Estes QR Codes condensam a ata impressa fisicamente. Com o uso deste sistema, qualquer pessoa com permissões operacionais pode enviar as partes do QR para um banco de dados, que fará as conferências estritas de formato e integridade.

Atualmente, o projeto está configurado para a cobertura estrita e operacional exclusiva da cidade de **Concórdia - Santa Catarina (Código TSE 80837)**. O catálogo nacional de municípios continua habilitado unicamente para suporte a fixtures de testes de outras UFs, não ampliando o escopo operacional.

O fluxo de funcionamento sistêmico é definido pela seguinte ordem:
QRBU → reconstrução → parser → validação → conferência → confirmação → totalização → painel.

## Funcionalidades principais
- **Decodificador QRBU V2026**: Extração dos dados baseada no manual de especificação técnica para as eleições.
- **Identidade Determinística e Deduplicação Inteligente**: Não permite registrar o mesmo Boletim de Urna duas vezes, assegurando exatidão na somatória matemática. Identidade é garantida pelos metadados únicos da urna na seção.
- **Modo de Simulação**: Capacidade de diferenciar fluxos de testes de eleições e BUs reais.
- **Painel em Tempo Real (SSE)**: Permite visualização pública que auto-atualiza a cada nova urna submetida.
- **Auditoria de Operações**: Trilha de ações (`AuditLog`) que armazena qual usuário validou, reverteu ou confirmou relatórios.
- **Cobertura Geográfica Fail-Closed**: Rejeita BUs de cidades fora da área de abrangência autorizada, evitando contaminação.
- **Reset e Preparação**: Modos de preparo para iniciar a apuração real de forma limpa.

## Estrutura do projeto
```text
prisma/      # Arquivos do banco de dados relacional e seeds (SQLite)
src/app/     # Páginas Web e APIs em NextJS 15+
src/lib/     # Regras de negócios, parsers em Typescript, criptografia
tests/       # Testes unitários e testes de integração com banco
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

## APIs principais
| Método | Endpoint | Finalidade |
| --- | --- | --- |
| POST | `/api/login` | Emissão do token JWT (Público) |
| POST | `/api/scan` | Recebe payloads, particionamentos e faz parser/validação do BU (Autenticado) |
| POST | `/api/reports/[id]/confirm` | Processa os resultados de um scan pendente, salvando no DB (Autenticado) |
| POST | `/api/reports/[id]/cancel` | Cancela/Aborta uma sessão pendente que falhou (Autenticado) |
| GET | `/api/totals` | Disponibiliza a agregação final para exibição pública e SSE (Público) |
| GET | `/api/realtime` | SSE - Tópico de eventos para re-renderização nativa (Público) |
| POST | `/api/admin/reset` | Deleta as tabelas e preserva eleições/rounds (ADMIN) |
| GET | `/api/export` | Exportação estruturada das totalizações atuais (Autenticado) |

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
5. **Configuração de Cobertura**: O bootstrap NÃO impõe uma cobertura geográfica automaticamente. Acesse `/admin/cobertura` com o usuário admin e selecione explicitamente "Concórdia/SC (80837)". Para testar fixtures de UFs diferentes, você pode alterar temporariamente. Sem cobertura válida, o sistema opera de modo *fail-closed* e recusa BUs.
6. Inicie o Server de desenvolvimento: `npm run dev`

## Testes
A suite foi construída baseando-se em testes exaustivos e isolados com Playwright e Vitest. A suíte deve concluir com exit code `0`.

- Validação estática de Tipos: `npm run typecheck`
- Lint de código: `npm run lint`
- Testes Unit/Integration: `npm run test`
- Testes E2E (Playwright): `npm run test:e2e`
- Build do NextJS: `npm run build`

## Fixtures TSE 2026
Os diretórios de testes (`tests/` e `external-fixtures/`) hospedam exemplos baseados nas normativas.

- **Fixtures OFICIAIS**: Exemplos/fixtures provenientes do pacote oficial do TSE (manuais de testes) que refletem estrutura válida para simulações completas E2E. Elas podem utilizar candidatos fictícios na origem.
- **Fixtures SINTÉTICAS**: Utilizadas para forçar testes lógicos e simulações focando primariamente no motor semântico em vez de integridade algorítmica real.

## Segurança
- Autenticação JWT estrita limitando acesso à API e às rotas admin.
- Regra de Role `ADMIN` protegendo ações sensíveis (como `/api/admin/reset`).
- A deduplicação é feita do lado do servidor (Server-Side), limitando qualquer chance de conflito via requisições simultâneas.
- Registros de Eventos mantidos via a tabela `AuditLog`.
- Variáveis de ambiente garantindo que credenciais cruciais ou tokens nunca entrem no controle de versão.

*(Reforço: Este projeto não deve ser descrito, sob nenhuma circunstância, como sistema eleitoral oficial ou infraestrutura oficial da Justiça Eleitoral).*

## Limitações conhecidas
- A validação de assinatura digital das urnas eletrônicas permanece indisponível. O sistema faz apenas validação estrutural de integridade (Hash).
- O uso de testes de interface Playwright em câmera simulada não dispensa testes de campo (Field Tests) com smartphones em condições físicas adversas (iluminação, foco, densidade óptica).
- Todo resultado obtido pelo processamento é não-oficial.

## Próximas etapas
- Setup final e testes operacionais em dispositivos móveis da equipe no dia real do pleito.

## Contexto Eleitoral Operacional 2026

A operação real desta apuração paralela está enquadrada nos seguintes identificadores oficiais do TSE:

| Campo | Valor |
| --- | --- |
| Data | 04/10/2026 |
| Turno | 1º Turno |
| **PLEITO (PLEI)** | **3220** |
| Eleição Geral Federal | 6257 |
| Eleição Geral Estadual SC | 6259 |
| Município | Concórdia — SC |
| Código TSE | 80837 |

**IMPORTANTE:** O campo `PLEI` extraído diretamente do QRBU é a chave de validação do sistema. Um BU real de 04/10/2026 terá `PLEI=3220`. O sistema rejeita com `ELECTION_CONTEXT_MISMATCH` qualquer BU cujo PLEI não corresponda a uma `Election` com `status=ACTIVE` no banco.

Os códigos `6257` e `6259` **não são armazenados no modelo de dados atual** — eles aparecem no corpo do QRBU como `CD_ELEICAO`, mas o campo `Election.plei` corresponde ao campo `PLEI` do BU. Não há necessidade de modelar `6257`/`6259` separadamente para a validação de ingresso do BU.

### Separação PLEI 2110 (teste) vs. PLEI 3220 (operação)

| Contexto | PLEI | Banco | Como preparar |
| --- | --- | --- | --- |
| Fixtures / E2E | 2110 | `e2e.db` (efêmero, isolado) | `npm run test:e2e` (automático) |
| Desenvolvimento | 2110 | `dev.db` (local, persistente) | `npm run db:setup` |
| **Operação Real** | **3220** | `prod.db` (novo, limpo) | Ver procedimento abaixo |

O `npm run db:setup` (que usa `prisma/seed.ts`) cria PLEI 2110 e é apropriado apenas para desenvolvimento/teste. **Nunca usar `dev.db` como banco operacional real.**

### Procedimento de Preparação Operacional (Banco Limpo — Dia da Eleição)

Execute em ordem no notebook da operação (PowerShell):

```powershell
# 1. Definir credenciais administrativas na sessão (obrigatório, mínimo 10 caracteres)
$env:ADMIN_EMAIL="operador@suaorganizacao.org"
$env:ADMIN_PASSWORD="senha-forte-aqui-minimo-10-chars"

# 2. Criar banco operacional limpo (prod.db)
# Este script tem fail-closed e falhará se o prod.db já existir
npm run db:setup:operacional

# 3. Iniciar o sistema com o banco operacional
$env:DATABASE_URL="file:./prod.db"
npm run start
```

**Antes de iniciar a operação real:**
- Acessar `/admin/cobertura` e ativar `isCoverage=true` para Concórdia/80837 (passo manual obrigatório).
- Verificar que exatamente 1 `Election` com `status=ACTIVE` e `plei=3220` existe no banco.
- Verificar que exatamente 1 `ElectionRound` com `roundNumber=1` e `status=ACTIVE` está vinculado.

### Atualização de Candidatos (CandidateMetadata)

Trata-se de um snapshot local atualizado em **02/10/2026 às 12:30:46**.
Quantidade total BR importável: 14.
Quantidade total SC importável (cargos 3, 5, 6, 7): 666.

O importador usa `upsert` por `candidateSequence` — não altera `BallotVote`, `BallotReport` nem quantidades de votos.


## Resolução de Metadados de Candidatos e Apresentação

O processamento e persistência dos votos é baseado estritamente no código do BU (QRBU), que se mantém como a fonte primária e irrefutável da verdade. A base local de `CandidateMetadata`, importada da base oficial, atua única e exclusivamente como **enriquecimento visual de apresentação** para as interfaces gráficas.

*   A resolução visual de candidatos classifica os registros em três estados: `FOUND`, `NOT_FOUND` ou `AMBIGUOUS`.
*   A ausência ou ambiguidade de metadados para um candidato (e.g. nomes fictícios de fixtures de teste ou ausência de atualização do banco) **nunca bloqueia o fluxo**, não altera o registro original e não impede o processamento do BU.
*   Nomes de candidatos, legendas partidárias ou números não são forjados, deduzidos ou inseridos como fallbacks — na indisponibilidade confirmada do dado referencial oficial, o fallback genérico `"Nome não identificado"` é exibido com a identificação original de urna.
*   Existe uma ausência deliberada de fotografias de candidatos (não faz parte do escopo).
*   **Votos com quantity = 0**: Votos processados e declarados no BU com quantidade zero são inteiramente preservados no banco de dados, compondo a trilha íntegra de auditoria. Contudo, eles são ocultados no painel público (`/apuracao`) para melhorar a legibilidade e focar nos resultados ativos.
*   **Limitação técnica de totalização (Fase 7)**: A rota `/api/totals` atualmente utiliza um fallback fixo contextual (Presidente -> BR, Demais Cargos -> SC) durante a agregação de dados devido à impossibilidade de aplicar o `groupBy` do Prisma sobre campos de estado associados a outra relação. O escopo operacional oficial é focado estritamente em Concórdia/SC, minimizando qualquer impacto. O catálogo nacional de municípios continua disponível como apoio/testes.

## Arquitetura de Testes e Bancos de Dados

O projeto obedece ao princípio de **isolamento total de banco de dados** para as suítes automatizadas, garantindo que o desenvolvimento local e os testes em CI não colidam nem sobrescrevam bases em uso:

*   **`prisma/dev.db`**: Banco de dados exclusivo do ambiente de **desenvolvimento local**. Nunca é apagado, sobrescrito ou modificado pelas suítes automatizadas. Os testes automatizados possuem uma trava `fail-closed` que impede sua execução caso apontem para este arquivo ou tentem compartilhar uma instância rodando nesta base via porta 3000.
*   **`prisma/test.db`**: Banco de dados efêmero usado pelas suítes unitárias e de integração (`vitest`). É recriado automaticamente no ciclo de vida de `npm run test` com seus respectivos Seeds.
*   **`prisma/e2e.db`**: Banco de dados exclusivo para os testes End-to-End do **Playwright** (`npm run test:e2e`).
*   **`prisma/prod.db`**: Banco de dados operacional real. Criado manualmente conforme procedimento acima. **Não versionado.**

## Referências oficiais
A implementação de parsing é dependente dos padrões adotados e abertos pela Justiça Eleitoral para as Eleições 2026.
- Tribunal Superior Eleitoral: https://www.tse.jus.br
- Candidatos TSE 2026: https://dadosabertos.tse.jus.br/pt_BR/dataset/candidatos-2026
- Informações técnicas divulgação de resultados: https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados

## Licença
Consulte o arquivo LICENSE, quando disponibilizado.

