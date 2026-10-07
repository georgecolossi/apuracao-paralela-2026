# Apuração Paralela 2026 – Manual Técnico e Operacional

Este documento é a referência definitiva para o sistema de **Apuração Paralela 2026**. Ele consolida todos os procedimentos necessários para desenvolvimento, configuração, instalação, deploy e operação do sistema, garantindo dependência zero de contexto não documentado.

---

## Índice
1. [Sobre o Sistema](#1-sobre-o-sistema)
2. [Status Atual da Instalação](#2-status-atual-da-instalação)
3. [Funcionalidades Suportadas](#3-funcionalidades-suportadas)
4. [Arquitetura e Fluxos](#4-arquitetura-e-fluxos)
5. [Projeção Eleitoral](#5-projeção-eleitoral)
6. [Tecnologias e Estrutura](#6-tecnologias-e-estrutura)
7. [Instalação Local e Pré-requisitos](#7-instalação-local-e-pré-requisitos)
8. [Variáveis de Ambiente](#8-variáveis-de-ambiente)
9. [Configuração de Nova Cidade (Identidade vs. Lógica)](#9-configuração-de-nova-cidade-identidade-vs-lógica)
10. [Turnos, PLEI e Cobertura](#10-turnos-plei-e-cobertura)
11. [Painel Administrativo e Scanner](#11-painel-administrativo-e-scanner)
12. [Reset Operacional e Segurança](#12-reset-operacional-e-segurança)
13. [Deploy no Railway e Persistência SQLite](#13-deploy-no-railway-e-persistência-sqlite)
14. [Backup e Restore](#14-backup-e-restore)
15. [Checklists Operacionais](#15-checklists-operacionais)
16. [Troubleshooting e Limitações Conhecidas](#16-troubleshooting-e-limitações-conhecidas)
17. [Testes, Build e Manutenção](#17-testes-build-e-manutenção)
18. [Fixtures e Artefatos de Referência](#18-fixtures-e-artefatos-de-referência)

---

## 1. Sobre o Sistema

O **Apuração Paralela 2026** é um sistema web desenvolvido para oferecer visibilidade em tempo real sobre resultados eleitorais a partir da leitura direta de Boletins de Urna (QRBU). O sistema fornece dois blocos de dados distintos no painel público:

1. **Apuração Paralela (Fonte Própria)**:
   Baseia-se unicamente nos Boletins de Urna (BUs) físicos impressos nas seções eleitorais, lidos por operadores (voluntários) através da câmera do dispositivo. O sistema contabiliza independentemente os votos locais, protegendo contra divergências através de uma arquitetura estrita de deduplicação matemática (hash e número da seção). **Não substitui a totalização oficial e não tem efeito jurídico.**
2. **Resultado TSE (Fonte Oficial)**:
   Alimenta-se via requisição à API oficial do TSE (`resultados.tse.jus.br`). Serve estritamente como fonte de conferência pública exibida lado-a-lado com a Apuração Paralela.

---

## 2. Status Atual da Instalação

Na configuração histórica gravada em produção (Base de exemplo: **Concórdia/SC, 2026**), o sistema encontra-se no seguinte estado:

- **1º Turno (T1)**: Concluído, histórico e validado. Exatamente **193 de 193** Boletins de Urna (`processedReports` / `expectedReports`) processados com sucesso. *(O valor 193 é um registro histórico, não um requisito do sistema).*
- **2º Turno (T2)**: Infraestrutura de software preparada estruturalmente para isolamento de contexto (`RoundContext Isolation`), porém **operacionalmente inerte**. O contexto oficial ainda não está configurado, ou seja, o T2 não possui PLEI associado, candidaturas vinculadas ou cobertura ativa configurada.

---

## 3. Funcionalidades Suportadas

O sistema dispõe de código funcional comprovado para:
- **Painel Público**: Agregação de votos, status de seções processadas, totalização paralela vs TSE, e projeção eleitoral automática.
- **Suporte Multi-Cargo**: Presidente, Governador, Senador, Deputado Federal e Estadual.
- **Isolamento de Turnos (Rounds)**: T1 e T2 operam isoladamente. Cada `ElectionRound` possui seu PLEI (código da eleição) restrito e sua `RoundCoverage` exclusiva (quais urnas/seções são aceitas naquele turno).
- **Leitura QRBU**: Escaneamento otimizado de QR Codes (via câmera web HTML5) ou entrada manual, suportando nativamente payloads *multipart* (QR fragmentado em múltiplos blocos `n/m`).
- **Parser de ASN.1**: Decodificação proprietária local do payload biométrico/criptográfico do BU emitido pelo TSE.
- **Validações Estritas (Guards)**: Rejeição de urnas fora do PLEI ativo, recusa de seções fora da cobertura estabelecida (`RoundCoverage`), e deduplicação absoluta por hash de conteúdo.
- **Integração API TSE**: Adaptador interno (`GET /api/tse-results`) que absorve os arquivos do TSE e normaliza os rótulos de forma canônica (ex: chaves numéricas 1, 3, 5).
- **Ferramentas Admin**: Painel autenticado para ativação de turnos, visualização de cobertura, reset operacional e auditoria (conferência de urnas lote a lote).

---

## 4. Arquitetura e Fluxos

### Arquitetura Simplificada
```text
  [Navegador (Usuários e Operadores)]
           ↓ HTTP/HTTPS
  [Next.js App Router (React + Tailwind)]
           ↓
  [Next.js API Routes (Node.js Backend)]
           ↓
  [TSE Parser / ASN.1 / Regras de Deduplicação]
           ↓
  [Prisma ORM]
           ↓
  [SQLite Local (Persistência em arquivo)]
```

### Fluxo de Ingestão de QRBU
1. O operador logado abre a rota `/admin/scanner` e apresenta o QR Code do BU à câmera.
2. O front-end processa fragmentos *multipart* e monta o payload completo.
3. O payload bruto é enviado via `POST /api/scan`.
4. O servidor valida o **PLEI** (ID do arquivo ASN.1 contra o ID esperado no `ElectionRound` ativo). Se divergir, a urna é rejeitada.
5. O servidor valida a **Cobertura**: a Seção contida no BU deve constar na tabela `RoundCoverage` para o turno ativo.
6. O servidor realiza **Deduplicação**: se a mesma seção ou hash já existir no turno, o recebimento é abortado.
7. O sistema extrai votos, agrega os percentuais e salva em `BallotReport` (Metadados do BU) e `BallotVote` (Votos agregados).

### Fluxo Resultado TSE
O painel público requisita o endpoint local `/api/tse-results?round=X`. O servidor então:
1. Faz request para `ele-c.json` (Ciclo Eleitoral do TSE).
2. Processa os JSONs remotos dos cargos específicos.
3. **Normaliza Cargos**: Para evitar inconsistências de interface provocadas por variações de gênero (`Governadora`, `Senadora`) da chave flexível `nmf` da API TSE, o sistema mapeia canonicamente pelos IDs oficias confirmados (1 = Presidente, 3 = Governador, 5 = Senador, 6 = Deputado Federal, 7 = Deputado Estadual).
4. Retorna JSON unificado ao painel. *Obs: Nenhum voto do TSE é gravado no banco SQLite.*

---

## 5. Projeção Eleitoral

A **Projeção Eleitoral** é uma inferência proporcional estatística exibida no painel público.
**Não é uma previsão probabilística sofisticada nem possui peso oficial.** Apenas extrapola a tendência atual para as urnas não lidas.

**Fórmula Exata Utilizada no Código:**
```javascript
Math.round(currentVotes * (progressTotal / progressProcessed))
```
- `currentVotes`: Quantos votos o candidato tem atualmente.
- `progressTotal`: Quantidade esperada de BUs (urnas) na cobertura do turno.
- `progressProcessed`: Quantidade de BUs (urnas) já computadas.

**Regras de Exibição (Guards):**
- A projeção evita divisão por zero pois exige minimamente `progressProcessed > 0`.
- A projeção apenas é exibida na tela caso `processedReports < expectedReports` (Ou seja, não atingiu 100%).
- Ao atingir 100% (`processedReports == expectedReports`), a exibição da projeção **desaparece automaticamente**, pois sua existência deixa de ter valor matemático.

---

## 6. Tecnologias e Estrutura

- **Engine:** Node.js, `npm`.
- **Framework:** Next.js `16.3.7` (React 19).
- **Banco e ORM:** SQLite processado via Prisma `^5.22.0`.
- **Bibliotecas Relevantes:** `html5-qrcode` (leitura ótica client-side), `asn1js` (parser binário), TailwindCSS 4, Vitest / Playwright (Testes).

### Diretórios Principais
- `src/app/`: UI Pública (`/apuracao`) e Painel Privado (`/admin`).
- `src/app/api/`: Controladores do backend.
- `src/core/`: Motores de parser e decodificação estruturada do TSE.
- `prisma/`: Definições do banco de dados (`schema.prisma`) e migrações.
- `tests/`: Suíte de regressão (testes unitários e integração).
- `scripts/`: Utilitários CLI (ex: `import-candidates.ts`, gerador de QRBUs sintéticos).
- `external-fixtures/tse-2026/`: Repositório oficial (*Read-only*) de documentação técnica do TSE. **Não confunda com dados operacionais.**

---

## 7. Instalação Local e Pré-requisitos

Para ambiente novo:
1. Tenha instalado o **Node.js** (v20+) e o gerenciador nativo **npm**. Instale o **Git**.
2. Clone e instale pacotes:
   ```bash
   git clone <REPO_URL>
   cd apuracao-paralela-2026
   npm install
   ```
3. Prepare as variáveis de ambiente base:
   ```bash
   cp .env.example .env
   ```
4. Gere o client do Prisma e inicialize o banco local de desenvolvimento (executa as migrations para criar as tabelas vazias):
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```
5. *(Opcional, dependente de seeds)* Se for desenvolvedor, pode populacionar simulacros usando `npm run db:setup`.
6. Rode a aplicação de desenvolvimento:
   ```bash
   npm run dev
   ```
   Acesse via navegador em `http://localhost:3000`.

---

## 8. Variáveis de Ambiente

Todas as variáveis devem ser cadastradas em `.env` localmente ou no painel do provedor de deploy.

| Variável | Obrigatoriedade | Local / Produção | Finalidade |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | **SIM** | Ambos | Caminho de conexão para o banco principal. Em produções Railway, mapeie para o volume montado (ex: `file:/data/prod.db`). |
| `JWT_SECRET` | **SIM** | Ambos | Chave simétrica usada para assinar as sessões dos administradores. |
| `ADMIN_INITIAL_PASSWORD` | NÃO | Local (Setup) | Utilizada pelos scripts automatizados de setup em dev para criar o usuário base. |
| `ALLOW_OPERATIONAL_RESET` | NÃO | Ambos | **CRÍTICA**. Se definida como `true`, desbloqueia a perigosa interface visual de apagamento sumário de apuração. *Deve estar ausente em operação normal.* |
| `NEXT_PUBLIC_CITY_NAME` | NÃO | Ambos | Altera o texto estático do nome da cidade na UI pública. Default: *Concórdia*. É uma variável pública (vazada ao browser). |
| `NEXT_PUBLIC_STATE_CODE`| NÃO | Ambos | Altera o texto da sigla do Estado na UI pública. Default: *SC*. Pública. |
| `COVERAGE_CITY_CODES` | NÃO | Ambos | Lista separada por vírgulas restringindo quais códigos de município TSE são tolerados pelo Scanner. Deixe vazio em dev. |

---

## 9. Configuração de Nova Cidade (Identidade vs. Lógica)

**LIMITAÇÃO ATUAL — REQUER ADAPTAÇÃO MANUAL**
Alterar as variáveis `NEXT_PUBLIC_CITY_NAME` e `NEXT_PUBLIC_STATE_CODE` muda **exclusivamente a estética visual** do sistema (cabeçalhos do painel). **Isso não configura a aplicação para processar QRBUs da referida cidade.** O sistema não tem autodescoberta.

Para adaptar a Apuração Paralela para um *Outro Município* diferente do histórico (Concórdia), um Desenvolvedor precisa atuar nas fontes de dados:

1. **Definição Base**: Identifique o Código TSE real do seu município.
2. **Importação Geográfica**: As Zonas (`PollingZone`) e Seções (`PollingSection`) exatas da sua cidade devem ser introduzidas na tabela SQLite correspondente. Hoje o projeto realiza essa ingestão consumindo os CSVs brutos do TSE através dos scripts presentes em `scripts/import-municipalities.ts` e afins. Você precisará baixar os arquivos de Candidatos/Seções oficiais da sua UF e rodar os parsers ajustando os filtros internos.
3. **RoundCoverage**: A tabela fundamental que diz "quais destas seções contam para o turno X". Sem popular a tabela `RoundCoverage`, o `expectedReports` será zero, bloqueando a ativação do turno e rejeitando qualquer leitura ótica sob o erro `URN_NOT_FOUND_IN_COVERAGE`.
4. **Candidatos**: O sistema cruza os votos brutos da urna com as meta-informações locais de candidatos para exibi-los no painel. Atualize os arquivos base em `consulta_cand_2026/` e rode `npm run import:candidates`.

---

## 10. Turnos, PLEI e Cobertura

O motor do sistema trabalha no modelo de *ElectionRound*. Cada eleição detém N turnos (`roundNumber`), podendo estar nos estados `PLANNED`, `ACTIVE` ou `FINISHED`. Somente 1 turno permanece `ACTIVE` por vez.

* **O PLEI é o Parâmetro de Autenticidade Máxima:**
  PLEI (código da eleição) é o hash assinado que o TSE embute em cada QRBU para designar o pleito de origem.
  *Exemplo Histórico: 3220 foi o PLEI simulado recorrente em Concórdia T1. Isso não é uma regra.*
  Se o PLEI gravado em `ElectionRound` divergir do PLEI decodificado do QRBU no dia D, a urna é rejeitada.

* **Preparação do 2º Turno (T2): LIMITAÇÃO IMPORTANTE**
  Nunca reaproveite o PLEI do T1 para o T2 automaticamente. Tão pouco adote suposições como o prefixo genérico `cdt2`. A configuração do T2 deve ocorrer estritamente após a Justiça Eleitoral divulgar os contextos oficiais (Tabelas e PLEIs definitivos do segundo turno). Enquanto isso, o T2 permanece no sistema como `PLANNED` sem dados acoplados.

---

## 11. Painel Administrativo e Scanner

**Segurança e Autenticação (KNOWN SECURITY LIMITATION):** O painel administrativo é protegido unicamente por senhas fixas que geram tokens JWT em cookies HttpOnly (`/api/login`). Não há suporte atual a granularidade de permissões (`Roles` ou hierarquias independentes de fiscais). O acesso confere controle absoluto da plataforma local.

*Rotas Documentadas:*
*   `/admin`: Dashboard principal.
*   `/admin/scanner`: Interface do operador. Requer HTTPS/localhost para habilitar uso ótico (`html5-qrcode`). Exige câmera com foco regulável (o excesso de iluminação ofusca o celular). Se o BU for longo (múltiplos QRs), siga as diretrizes da tela inserindo os fragmentos na ordem estrita solicitada pelo sistema.
*   `/admin/turnos`: Permite transitar a máquina de estados (`ACTIVE` -> `FINISHED`). Proibido transitar turnos sem a matriz `RoundCoverage` definida (zero BUs esperados impede a ativação).
*   `/admin/conferencia` e `/admin/audit`: Permite aos gestores checarem individualmente as parciais criptográficas enviadas ao banco. Útil para auditoria contra as fitas impressas na parede.
*   `/admin/cobertura` e `/admin/recalcular`: Ferramentas auxiliares para exibir seções pendentes e reprocessar matrizes estatísticas em caso de crash.
*   `/admin/preparar`: Painel restrito de *Reset Operacional*.

---

## 12. Reset Operacional e Segurança

**⚠️ PROCEDIMENTO ALTAMENTE DESTRUTIVO.**

A tela `/admin/preparar` executa o apagamento físico de todos os Boletins (`BallotReport`) e seus respectivos Votos computados (`BallotVote`) vinculados ao turno em andamento. Foi modelada para limpar a base de testes/simulação no dia antecedente à eleição, abrindo caminho limpo para as urnas oficiais.

*Como funciona:*
1. Somente acessível se o operador iniciar o container/servidor com a flag de sistema: `ALLOW_OPERATIONAL_RESET="true"`.
2. Para liberar a deleção, o operador deve digitar exatamente: `ZERAR APURAÇÃO` (Maiúsculas, sensível à formatação) no desafio interativo da página.
3. Se executado incorretamente ao longo do dia da eleição, o banco é extirpado de maneira irrecuperável.

**Segurança Recomendada:**
Em deploys estáveis (Produção), não cadastre a variável `ALLOW_OPERATIONAL_RESET` no servidor, mitigando a chance de intrusão ou falha humana. **Ocorrendo a necessidade genuína, sempre proceda um Backup do arquivo `prod.db` antes da ação.**

---

## 13. Deploy no Railway e Persistência SQLite

A aplicação é nativamente compatível com deployments serverless, mas devido à escolha arquitetural do SQLite, **exige obrigatoriamente vinculação a um disco persistente (Volume)**.

### Tutorial de Deploy
1. No [Railway](https://railway.app), crie um novo projeto interligado ao seu fork do repositório no GitHub. Selecione a branch `main`.
2. Nas configurações do *Service* criado, acesse **Volumes** e aloque um disco persistente. Especifique o *Mount Path* para o contêiner virtual no diretório `/data` (Por padrão histórico a aplicação aceitou limites na casa de `500 MB`).
3. Vá em **Variables** e defina:
   - `DATABASE_URL="file:/data/prod.db"` (Crucial! Informa ao Prisma para não utilizar a raiz efêmera do app).
   - `JWT_SECRET="<Sua chave ultrassecreta>"`
4. O Railway fará o *build* (`npm run build`) e em seguida injetará as migrações (se configurado o deploy command do Prisma) e iniciará.
5. Acesse o domínio publicado para um *smoke test* e navegue na interface para certificar a responsividade.

*Se você falhar na etapa 2 e 3, a aplicação inicializará normalmente, porém ao ocorrer qualquer rotatividade ou novo push no Github, o disco efêmero do docker será descartado e a contagem de votos reverterá a Zero.*

---

## 14. Backup e Restore

### Backup
O sistema **NÃO POSSUI UM SCRIPT DE BACKUP AUTOMÁTICO EM NUVEM**.
O backup é um **procedimento manual** que espelha o arquivo físico.
Na interface do Railway (ou provedor análogo), acesse a aba "Data" do seu serviço ou utilize o painel de gerenciamento do Volume para **baixar (Download) o arquivo `/data/prod.db`** periodicamente.

### Restore (⚠️ Risco Extremo)
**Realizar o Restore altera integralmente o estado operacional.**
Faça o upload e substitua o `prod.db` no seu Mount `/data`. O container deve ser reiniciado imediatamente para o Prisma reconectar à base.
Nunca faça restore a não ser que uma corrupção catastrófica exija a volta no tempo, pois toda a ingestão paralela dos operadores após o instante do backup será imediatamente evaporada.

---

## 15. Checklists Operacionais

### A) Checklist Pré-Eleição
- [ ] Obter a base visual correta (Configurar variáveis `.env` p/ cidade e UF).
- [ ] Confirmar exclusão irrestrita de variáveis como `ALLOW_OPERATIONAL_RESET`.
- [ ] Banco populacionado: Seções geográficas importadas. Cobertura de turno atrelada. Candidatos inseridos.
- [ ] Obter o **PLEI Oficial** da eleição e gravá-lo no Turno.
- [ ] Realizar backup completo preventivo do sistema (`prod.db`).

### B) Checklist Dia da Eleição
- [ ] (Apenas Verificar) Acessar a home pública e checar a zerésima paralela (Painel zerado, 0/100 urnas).
- [ ] Distribuir credenciais a operadores físicos do scanner.
- [ ] Acompanhar *smoke tests* logísticos: Passar a primeira urna real recebida para atestar integridade.
- [ ] Monitorar a aba pública e garantir convergência correta antes da liberação da tela da Projeção.

### C) Checklist Pós-Eleição (Hand-off)
- [ ] Conferir totalização via interface de Auditoria e comparar pontualmente às publicações da Imprensa/TSE.
- [ ] Extrair e baixar uma cópia definitiva imutável do `/data/prod.db` gerando hashes SHA256 do arquivo.
- [ ] Analisar encerramento do turno T1 no painel admin para viabilizar e iniciar importações seguras do escopo do T2 (caso pertinente).

---

## 16. Troubleshooting e Limitações Conhecidas

### Problemas e Diagnósticos Rápidos
| Problema | Causa Provável | Solução Prática |
| :--- | :--- | :--- |
| `npm run test` lançando erros bizarros EBUSY | Runner interrompido sem aviso. O Prisma não soltou as chaves do `test.db`. | Remova à mão o arquivo `prisma/test.db` e rode de novo. |
| Erro `URN_NOT_FOUND_IN_COVERAGE` | Urna lida possui Zona/Seção que o sistema não esperava (tabela `RoundCoverage` vazia ou alheia). | Audite a tabela no banco; reajuste a cobertura atrelando a urna ao RoundId ativo. |
| Câmera não inicializa (Tela preta / Erro) | Você acessou o painel por um IP local HTTP desprotegido. Navegadores bloqueiam `getUserMedia`. | Adote um tunelamento (como ngrok) ou gere certificados locais. |
| TSE Sumiu Títulos ("Governadora") | Mapeamento implementado no código. | É normal. A rotina `/api/tse-results` mapeia estaticamente para termos canônicos (1=Presidente, 3=Governador) ignorando o `nmf` volátil para proteger o frontend. |
| Zerei Tudo sem Querer | O operador apertou o botão perigoso do Admin com a tag `ALLOW_OPERATIONAL_RESET` habilitada. | Restaure imediatamente o arquivo de banco do Backup gerado anteriormente na nuvem. |

### Gaps Técnicos / Limitações (Known Limitations)
- Transição de Cidade não Scriptada: Substituir Concórdia por Curitiba exige intervenção direta nos seeds e no banco para ajustar geometria (RoundCoverage). A Identidade Visual não injeta votos no ar.
- Segurança monolítica: O sistema não conta com gestão de permissões RBAC avançada (Roles, Logs Nominais de Acesso Detalhados por Voluntário).

---

## 17. Testes, Build e Manutenção

Para programadores que pretendam expandir a codebase:

- O sistema utiliza `vitest` operando sob um banco SQLite temporário restrito por transação (no-file-parallelism).
  ```bash
  npm run test
  ```
  O histórico de estabilidade atual assegura **33 arquivos processados e 261 testes de sucesso.**

- Para compilar a suíte em ambiente produtivo do React/Next:
  ```bash
  npm run build
  ```
  Isso constrói o SSG e otimiza o frontend nas pastas `.next`. Só execute PR (Pull Requests) ou Deploys se ambos os comandos rodarem livre de falhas ou warnings de tipagem. Use o fluxo seguro (Test -> Build -> Commit -> Deploy).

---

## 18. Fixtures e Artefatos de Referência

A raiz do projeto abriga a pasta `external-fixtures/tse-2026/`.
Ela engloba manuais criptográficos do governo, diagramas de topologia ASN.1, chaves públicas sintéticas e amostras binárias brutas (.dat/.imgbu) oriundas do laboratório tecnológico oficial.
**Atenção Operador:** Estes artefatos servem apenas de referência teórica e insumo de leitura (Mock) para a suíte de Testes da aplicação. **Nunca interprete seu conteúdo ou seus PLEIs genéricos como base lógica para configurar parâmetros na produção real do sistema.**
