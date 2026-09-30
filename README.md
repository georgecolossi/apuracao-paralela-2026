> [!IMPORTANT]
> Esta é uma apuração paralela independente e não oficial. O sistema não substitui a totalização oficial da Justiça Eleitoral.

# Apuração Paralela 2026

## Visão geral
O Apuração Paralela 2026 é um sistema independente de apuração paralela. O objetivo é realizar a leitura rápida e confiável de QR Codes de Boletins de Urna (QRBU), processar os votos, prover uma interface administrativa de conferência e totalização, e apresentar o resultado através de um painel público em tempo real.

Este sistema **não é do TSE**, **não possui validade oficial própria** e **não substitui a totalização oficial da Justiça Eleitoral**.

## Escopo atual
Atualmente, o projeto está sendo estruturado para a cobertura regional de **Concórdia e região — Santa Catarina**.

A configuração da lista exata dos municípios da região será definida posteriormente, mas a infraestrutura para restringir o processamento já está funcional utilizando a variável de ambiente `COVERAGE_CITY_CODES`.

## Funcionalidades
- **Leitura QRBU**: Motor de extração e _parsing_ estrutural de dados.
- **Reconstrução Multipart**: Suporte a BUs impressos em vários fragmentos/QR Codes.
- **Parser Semântico**: Classificação dos votos por cargo (nominais, legenda, nulos, brancos).
- **Identidade Determinística**: Identificação rigorosa do BU a partir de suas variáveis espaciais.
- **Deduplicação**: Proteção total contra a dupla contabilização do mesmo BU.
- **Conferência Administrativa**: Painel restrito para inspecionar o BU antes da consolidação.
- **Confirmação e Totalização**: Somatório oficial de votos.
- **Painel Público**: Interface pública para acompanhamento regional consolidado.
- **SSE (Server-Sent Events)**: Atualização do painel em tempo real.
- **Logs de Auditoria**: Registro imutável das principais operações administrativas.
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
7. O sistema executa a **Persistência** isolada no banco de dados.
8. O sistema realiza a **Totalização** atualizada para todos os BUs processados.
9. Os dados atualizados são enviados imediatamente via SSE ao **Painel público**.

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
- **Parsing**: Todo payload é dissecado estruturalmente, e campos vitais ausentes ou corrompidos paralisam o fluxo.
- **Validação de Hash (Integridade)**: A validação implementada nesta versão contempla a verificação de integridade via HASH. O código computa o hash (SHA-512) dos fragmentos textuais reconstruídos e o compara com o hash registrado pelo próprio QRBU.
- **Assinatura Digital**: UNAVAILABLE / NÃO IMPLEMENTADA. O sistema valida apenas integridade de parsing e estrutura (Hash). A verificação da criptografia assimétrica da Justiça Eleitoral não faz parte do atual pipeline de processamento.

## Identificação e deduplicação
A identidade determinística do Boletim de Urna garante proteção contra duplicidade em qualquer cenário.
Um identificador global é gerado utilizando: `PLEI` + `TURN` + `ESTADO` + `MUNI` + `ZONA` + `SEÇÃO` + `CÓDIGO DA URNA`.

Se um QRBU correspondente a este identificador for escaneado em uma tentativa posterior, o sistema acusa o status **DUPLICADO** (HTTP 409) e ignora a operação preservando os dados originais e evitando o retrabalho.

## Cobertura geográfica
Para evitar o registro de urnas distantes da área de foco do portal da apuração, uma variável de controle existe para atuar como _whitelist_ geográfico:
`COVERAGE_CITY_CODES`

- Se a variável estiver vazia, o sistema aceitará o QRBU de qualquer município (útil para desenvolvimento).
- Se possuir valores (lista separada por vírgulas), por exemplo `COVERAGE_CITY_CODES=1392,71072`, qualquer BU fora dessa lista sofrerá bloqueio imediato, retornará `HTTP 403 OUT_OF_COVERAGE` e criará um `AuditLog` apontando a tentativa `SCAN_OUT_OF_COVERAGE`.

**Aviso**: `1392,71072` são apenas exemplos técnicos utilizados pelo ambiente e testes. Eles NÃO representam a configuração final de Concórdia e região.

## Modo de simulação
Com foco em possibilitar testes operacionais durante o dia da eleição antes da abertura das urnas, a arquitetura distingue BUs oficiais de _BUs de simulação_ via a flag `isSimulation`.

Se for acionado o fluxo de simulação, um prefixo virtual `SIM-` será atrelado àquela eleição no registro e no código da urna, isolando os relatórios perfeitamente das totalizações originais baseadas em payloads oficias (pleitos e seções ativas), mas mantendo-os auditáveis no painel administrativo.

## Preparação para a apuração real
Uma operação destrutiva está presente sob a rota administrativa `/admin/preparar` para realizar a higiene final do banco de dados antes da apuração.

- Requer permissão restrita de ADMIN.
- Exige inserção literal do texto `ZERAR APURAÇÃO` para confirmação destrutiva.
- Executa limpeza transacional que exclui resultados, votos, sessões de scan e relatórios (reports).
- Preserva perfeitamente a configuração estrutural conforme implementação (eleições e turnos mantêm seus IDs originais).
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
| `/admin/recalcular` | Ferramenta administrativa para forçar consolidação | ADMIN / OPERATOR |
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
COVERAGE_CITY_CODES=
```

## Instalação para desenvolvimento
1. Realize a clonagem deste repositório.
2. Configure suas variáveis copiando `.env.example` para `.env`.
3. Instale as dependências: `npm install`
4. Sincronize o schema e o banco de dados: `npx prisma db push`
5. Popule pleitos virtuais utilizando: `npx prisma db seed`
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

- **Fixtures OFICIAIS**: Cópias transcritas publicadas pelo Tribunal Superior Eleitoral em manuais de testes que refletem estrutura válida para simulações completas E2E.
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
- Definição exata da lista e inclusão no `COVERAGE_CITY_CODES` para operação da regional Concórdia/SC.
- Setup final e testes operacionais em dispositivos móveis da equipe no dia real do pleito.

## Referências oficiais
A implementação de parsing é dependente dos padrões adotados e abertos pela Justiça Eleitoral para as Eleições 2026.
- Tribunal Superior Eleitoral: https://www.tse.jus.br

## Licença
Consulte o arquivo LICENSE, quando disponibilizado.
