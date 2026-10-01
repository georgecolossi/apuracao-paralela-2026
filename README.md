> [!IMPORTANT]
> Esta é uma apuração paralela independente e não oficial. O sistema não substitui a totalização oficial da Justiça Eleitoral.

# Apuração Paralela 2026

## Visão geral
O Apuração Paralela 2026 é um sistema independente de apuração paralela. O objetivo é realizar a leitura rápida e confiável de QR Codes de Boletins de Urna (QRBU), processar os votos, prover uma interface administrativa de conferência e totalização, e apresentar o resultado através de um painel público em tempo real.

Este sistema **não é do TSE**, **não possui validade oficial própria** e **não substitui a totalização oficial da Justiça Eleitoral**.

## Escopo atual
Atualmente, o projeto está sendo estruturado para a cobertura regional de **Concórdia e região — Santa Catarina**.

A configuração inicial de cobertura é Concórdia/SC. A área de cobertura pode ser ampliada pelo administrador para outros municípios de Santa Catarina sem alteração de código ou novo deploy. O escopo definitivo será definido operacionalmente no dia da apuração.

## Funcionalidades
- **Leitura QRBU**: Motor de extração e _parsing_ estrutural de dados.
- **Reconstrução Multipart**: Suporte a BUs impressos em vários fragmentos/QR Codes.
- **Parser Semântico**: Classificação dos votos por cargo (nominais, legenda, nulos, brancos).
- **Identidade Determinística**: Identificação rigorosa do BU a partir de suas variáveis espaciais.
- **Deduplicação**: Rejeição de BUs já registrados com base na identidade determinística utilizada pelo sistema.
- **Conferência Administrativa**: Painel restrito para inspecionar o BU antes da consolidação.
- **Confirmação e Totalização**: Consolidação dos votos processados pela apuração paralela.
- **Painel Público**: Interface pública para acompanhamento regional consolidado.
- **SSE (Server-Sent Events)**: Atualização do painel em tempo real.
- **Logs de Auditoria**: Registro de eventos e operações administrativas relevantes.
- **Modo de Simulação**: Via QR codes de teste isolados da apuração principal.
- **Cobertura Geográfica**: Bloqueio de BUs de municípios fora da área de interesse.
- **Preparação/Reset**: Ferramenta destrutiva autenticada para zerar o banco antes da apuração real.
- **Autenticação**: Controle de acesso (ADMIN / OPERATOR).

## Fluxo da apuração
O ciclo de vida de um Boletim de Urna no sistema ocorre da seguinte maneira:

1. Ocorre a leitura do **QR do BU** pela câmera do dispositivo no painel Scanner.
2. Ocorre a **Reconstrução multipart** (se o BU possuir mais de 1 QR Code).
3. O payload textual passa pelo **Parser e validação**.
4. Ocorre a **Identificação e deduplicação** para rejeitar BUs já registrados.
5. O operador visualiza o resultado em tela de **Conferência**.
6. Executa-se a **Confirmação** manual dos dados.
7. O sistema executa a **Persistência** no banco de dados.
8. O sistema realiza a **Totalização** atualizada para todos os BUs processados.
9. O **Painel público** utiliza SSE para receber sinalizações de atualização e consultar os totais.

## Boletim de Urna e QRBU
O sistema trabalha estritamente com a especificação QRBU em formato textual, muitas vezes particionados (multipart) devido às restrições de densidade óptica da impressão.

- Os fragmentos de um mesmo relatório são reconstruídos temporariamente em memória na mesma sessão antes de prosseguir com o processamento.
- O parser consome e extrai os campos estruturais disponíveis no QRBU, sem adivinhar ou inferir lógicas não contidas no payload impresso.
- Códigos eleitorais (de municípios, zonas, seções, partidos ou candidatos) não devem ser confundidos com seus nomes amigáveis. Nomes e siglas serão associados posteriormente via base de dados externa.

## Cargos eleitorais
O parser atualmente suporta o seguinte mapeamento de `officeCode` contido no QRBU:

| Código | Cargo |
| --- | --- |
| `1` | Presidente |
| `3` | Governador |
| `5` | Senador |
| `6` | Deputado Federal |
| `7` | Deputado Estadual |
| `11` | Prefeito |
| `13` | Vereador |

Códigos desconhecidos geram fallback explícito para `Cargo não identificado (código X)`.
*(Nota: Votos para Senador são tratados coletivamente sob um único cargo `Senador`, suportando a multiplicidade normal de entradas de voto do QRBU)*.

### Identificação de candidatos
O sistema totaliza utilizando **apenas os identificadores e números (do candidato e do partido)** provenientes do processamento do QRBU.
A resolução `número → nome → partido/sigla` será adicionada posteriormente utilizando uma base oficial do TSE.

**Importante**: Como decisão de produto, o sistema não utilizará e não armazenará fotografias de candidatos. A apresentação futura utilizará apenas nome, número e partido/sigla.

## Integridade e validação
- **Parsing**: Todo payload é dissecado estruturalmente, e campos obrigatórios/reconhecidos necessários ao processamento ausentes ou corrompidos paralisam o fluxo.
- **Validação de Hash (Integridade)**: A validação implementada nesta versão contempla a verificação de integridade via HASH. O código computa o hash (SHA-512) dos fragmentos textuais reconstruídos e o compara com o hash registrado pelo próprio QRBU.
- **Assinatura Digital**: UNAVAILABLE / NÃO IMPLEMENTADA. O sistema valida apenas integridade de parsing e estrutura (Hash). A verificação da criptografia assimétrica da Justiça Eleitoral não faz parte do atual pipeline de processamento.


## Metadados de Candidatos (Eleições 2026)
O sistema integra metadados oficiais de candidaturas para enriquecer a apresentação pública dos resultados da apuração paralela com nome de urna, número e sigla do partido.

**Origem dos dados**: Portal de Dados Abertos do TSE ([Candidatos - 2026](https://dadosabertos.tse.jus.br/pt_BR/dataset/candidatos-2026)).
**Arquivos utilizados**: O dataset já encontra-se armazenado localmente no repositório na pasta `consulta_cand_2026/`, sendo utilizados estritamente os recortes `BR.csv` e `SC.csv`. O sistema não realiza downloads em runtime.


**Características da integração**:
- **Fonte da verdade dos votos**: O QRBU continua sendo a única fonte dos votos contabilizados.
- **Isolamento de quantidades**: O metadata não cria, altera, valida ou remove votos, nem afeta quantidades ou altera o resultado da apuração. Trata-se de uma camada estrita de apresentação visual (Nome e Sigla).
- **Cargos importados**: Presidente (1), Governador (3), Senador (5), Deputado Federal (6) e Deputado Estadual (7). Cargos de vice e suplência não são importados como entidades votáveis separadas.
- **Importação (Fail-Closed)**: Realizada via o comando `npm run import:candidates`. O script é estritamente *fail-closed* e aborta a importação caso arquivos obrigatórios (`BR.csv` e `SC.csv`) ou colunas necessárias faltem, além de rejeitar linhas com dados estruturais vitais ausentes ou inválidos. O processo é completamente idempotente (utiliza upsert com a chave oficial `SQ_CANDIDATO`), impedindo duplicação de dados.
- **Resolução Contextual e Ambiguidade**: A apresentação opera com três estados de resolução:
  - `FOUND`: Candidato inequivocamente identificado no contexto exato.
  - `NOT_FOUND`: Número não encontrado no dataset para o contexto específico.
  - `AMBIGUOUS`: Múltiplos candidatos com a mesma chave cargo+número *dentro do mesmo contexto*.
  O resolver utiliza o contexto eleitoral estrito (`electionYear`, `state`, `officeCode` e `candidateNumber`) extraído da eleição vigente, evitando falsas ambiguidades entre candidatos com o mesmo número em estados diferentes.
- **Fallback Visual**: Casos não resolvidos (`NOT_FOUND` e `AMBIGUOUS`) recebem o fallback visual "Nome não identificado", preservando integralmente o voto computado do QRBU.
- **Limitações**: Ausência deliberada de fotografias, dados pessoais ou biográficos. O sistema não faz requisições externas para baixar ativos visuais e se mantém restrito a metadados textuais vitais (Nome/Número/Sigla).

## Identificação e deduplicação
A identidade determinística do Boletim de Urna permite que o sistema rejeite tentativas de múltiplos registros.
Um identificador global é gerado utilizando: `PLEI` + `TURN` + `ESTADO` + `MUNI` + `ZONA` + `SEÇÃO` + `CÓDIGO DA URNA`.

Se um QRBU correspondente a este identificador for escaneado em uma tentativa posterior, o sistema acusa o status **DUPLICADO** (HTTP 409) e ignora a operação preservando os dados originais e evitando o retrabalho.

## Cobertura Geográfica
O sistema possui proteção _fail-closed_ para a área de cobertura: BUs reais lidos de municípios não autorizados são imediatamente rejeitados com `HTTP 403 OUT_OF_COVERAGE`, gerando um `AuditLog`.

- A **única** fonte operacional para a cobertura geográfica é o **Banco de Dados**.
- Se a cobertura estiver **vazia**, **nenhum BU real será aceito** (fail-closed). O sistema **não** aceita BUs automaticamente.
- A seleção de cobertura pode ser alterada apenas por usuários com a role **ADMIN** através do painel de administração da interface (`/admin/cobertura`).
- O **catálogo de municípios é nacional**, importado do dataset oficial, porém não equivale à cobertura operacional. Importação não ativa cobertura.
- Qualquer município do catálogo (de qualquer UF) pode ser explicitamente selecionado pelo administrador na interface.
- Usuários com role **OPERATOR** não possuem acesso ou autorização para modificar essa configuração.
- O reset ("Zerar Apuração") ou reimportações de catálogo não sobrescrevem as seleções efetuadas previamente pelo administrador.
- Como mecanismo de integridade, municípios que já possuam dados de BUs reais processados não podem ser removidos da cobertura silenciosamente (rejeitado com HTTP 409).

**Nota Operacional**: O banco é criado vazio. A apuração final e em produção será realizada **somente para Concórdia/SC, código TSE 80837**. Essa cobertura deverá ser ativada manualmente pelo administrador no ambiente (`/admin/cobertura`) antes do início oficial. Durante o desenvolvimento, o administrador pode habilitar temporariamente a cobertura do município que consta no fixture oficial a ser testado.

## Modo de simulação
Com foco em possibilitar testes operacionais durante o dia da eleição antes da abertura das urnas, a arquitetura distingue BUs oficiais de _BUs de simulação_ via a flag `isSimulation`.

Se for acionado o fluxo de simulação, um prefixo virtual `SIM-` será atrelado àquela eleição no registro e no código da urna, os dados de simulação são excluídos da totalização pública, mas continuam disponíveis para os fluxos administrativos pertinentes.

## Preparação para a apuração real
Uma operação destrutiva está presente sob a rota administrativa `/admin/preparar` para realizar a higiene final do banco de dados antes da apuração.

- Requer permissão restrita de ADMIN.
- Exige inserção literal do texto `ZERAR APURAÇÃO` para confirmação destrutiva.
- Executa limpeza transacional que exclui resultados, votos, sessões de scan e relatórios (reports).
- Preserva as configurações estruturais de eleições e turnos definidas no banco de dados.
- Após o processo, uma entrada `SYSTEM_RESET` é incluída na tabela `AuditLog`.

## Arquitetura
Este projeto foi desenvolvido utilizando a seguinte Stack:
- **Next.js (16.3.7)**: Server-rendered React framewok para as rotas da Web, Server Components e API routes.
- **React (19.2.8)**.
- **TypeScript (5)**.
- **Prisma (5.22.0)**: ORM utilizado para gerenciar as persistências de dados. O provider configurado localmente/em desenvolvimento é o `sqlite`.
- **TailwindCSS (4)**.
- **Playwright (1.63.0)**: Suite oficial do projeto para testes End-To-End (E2E).
- **Vitest (2.1.9)**: Motor ultrarrápido para testes unitários e de integração.
- **html5-qrcode**: Biblioteca subjacente utilizada para acionar o uso do dispositivo óptico nos painéis administrativos.

## Estrutura do projeto
Resumo direcional do repositório:
```text
src/
  app/       # Páginas web, Server Components e rotas Next.js App Router
  lib/       # Lógica central e abstrações compartilhadas
    parser/  # Motor especializado para extração e validação de QRBU
prisma/      # Schema descritivo do ORM e seed data
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
5. **Configuração de Cobertura**: O bootstrap NÃO impõe uma cobertura geográfica automaticamente. Para a rádio, acesse `/admin/cobertura` com o usuário admin e selecione explicitamente "Concórdia/SC (80837)". Para testar fixtures, você pode alterar temporariamente. Sem cobertura válida, o sistema opera de modo *fail-closed* e recusa BUs.
6. Inicie o Server de desenvolvimento: `npm run dev`

## Testes
A suite foi construída baseando-se em testes exaustivos e isolados com Playwright e Vitest. A suíte deve concluir com exit code `0`.

- Validação estática de Tipos: `npm run typecheck`
- Lint de código: `npm run lint`
- Testes Unit/Integration: `npm test`
- Testes E2E (Playwright): `npm run test:e2e`
- Build do NextJS: `npm run build`

## Fixtures TSE 2026
Os diretórios de testes (`tests/` e `external-fixtures/`) hospedam exemplos baseados nas normativas.

- **Fixtures OFICIAIS**: Exemplos/fixtures provenientes do pacote oficial do TSE (manuais de testes) que refletem estrutura válida para simulações completas E2E.
- **Fixtures SINTÉTICAS**: Utilizadas para forçar testes lógicos e simulações focando primariamente no motor semântico em vez de integridade algorítmica real.

## Segurança
- Autenticação JWT estrita limitando acesso à API e às rotas admin.
- Regra de Role `ADMIN` protegendo ações sensíveis (como `/api/admin/reset`).
- A deduplicação é feita do lado do servidor (Server-Side), limitando qualquer chance de conflito via requisições simultâneas.
- Registros de Eventos mantidos via a tabela `AuditLog`.
- Variáveis de ambiente garantindo que credenciais cruciais ou tokens nunca entrem no controle de versão.

*(Reforço: Este projeto não deve ser descrito, sob nenhuma circunstância, como sistema eleitoral oficial ou infraestrutura oficial da Justiça Eleitoral).*

## Limitações conhecidas
- A validação de assinatura digital das urnas eletrônicas permanece indisponível. O sistema faz apenas validação estrutural hash.
- Identificação de candidatos/partidos por nomes amigáveis ainda não integrada.
- Cobertura final de Concórdia e região aguardando definição oficial.
- O uso de testes de interface Playwright em câmera simulada não dispensa testes de campo (Field Tests) com smartphones em condições físicas adversas (iluminação, foco, densidade óptica).
- Todo resultado obtido pelo processamento é não-oficial.

## Próximas etapas
- Integrar a base oficial de candidatos (traduzindo `número → nome → partido/sigla`). Fotografias **não** fazem parte do escopo planejado.
- Definição exata da lista operacional de cobertura no dia da eleição.
- Setup final e testes operacionais em dispositivos móveis da equipe no dia real do pleito.

## Referências oficiais
A implementação de parsing é dependente dos padrões adotados e abertos pela Justiça Eleitoral para as Eleições 2026.
- Tribunal Superior Eleitoral: https://www.tse.jus.br

## Licença
Consulte o arquivo LICENSE, quando disponibilizado.

## Resolução de Metadados de Candidatos

O processamento e persistência dos votos é baseado estritamente no código do BU (QRBU), que se mantém como a fonte primária e irrefutável da verdade. A base local de `CandidateMetadata` atua única e exclusivamente como **enriquecimento visual de apresentação** para as interfaces gráficas.

*   A ausência ou ambiguidade de metadados para um candidato (e.g. nomes fictícios de fixtures de teste ou ausência de atualização do banco do TSE) **nunca bloqueia o fluxo**, não altera o registro original e não impede o processamento do BU.
*   Nomes de candidatos ou legendas partidárias não são forjados, deduzidos ou inseridos como fallbacks — na indisponibilidade confirmada do dado referencial oficial, apenas a identificação original de urna é exposta.
*   Limitação técnica (Fase 7.7.3): A rota `/api/totals` atualmente utiliza um fallback fixo (Presidente -> BR, Demais Cargos -> SC) durante a agregação de dados no banco local devido à impossibilidade de aplicar o `groupBy` do Prisma sobre campos associados de outra relação sem introduzir alto acoplamento na modelagem da base de votos (`stateCode` vive no nível do relatório). O comportamento operacional projetado na Fase 1 é focado em SC, então não há impacto real imediato, mas uma adoção global para abranger múltiplas UFs na agregação demandará refatoração da query.

## Arquitetura de Testes e Bancos de Dados

O projeto obedece ao princípio de **isolamento total de banco de dados** para as suítes automatizadas, garantindo que o desenvolvimento local e os testes em CI não colidam:

*   **`prisma/dev.db`**: Banco de dados exclusivo do ambiente de **desenvolvimento local**. Nunca é apagado, sobrescrito ou modificado pelas suítes automatizadas. Os testes automatizados possuem uma trava `fail-closed` que impede sua execução caso apontem para este arquivo.
*   **`prisma/test.db`**: Banco de dados efêmero usado pelas suítes unitárias e de integração (`vitest`). É recriado e excluído automaticamente no ciclo de vida de `npm run test`.
*   **`prisma/e2e.db`**: Banco de dados exclusivo para os testes End-to-End do **Playwright** (`npm run test:e2e`).
