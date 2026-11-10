# Apuração Paralela 2026 — Manual Operacional e de Infraestrutura

Este documento consolida as diretrizes técnicas e operacionais para configuração, implantação, operação, manutenção e contingência do sistema **Apuração Paralela 2026**.

---

## 1. Visão Geral da Arquitetura

O sistema opera sobre uma arquitetura web moderna baseada em Next.js (App Router), Prisma ORM e banco de dados SQLite persistido em volume dedicado no Railway:

```text
[Operadores / Fiscais]               [Eleitores / Público]
       ↓                                       ↓
  /admin/scanner                          /apuracao
       ↓                                       ↓
  POST /api/scan                         GET /api/totals
       ↓                                       ↓
[Parser QRBU / Validador SHA-512]     [Mecanismo de Apuração]
       ↓                                       ↓
   Prisma ORM                             Prisma ORM
       ↓                                       ↓
[SQLite /data/prod.db no Volume Persistente Railway]
```

### Componentes Principais
- **Frontend Público (`/apuracao`):** Painel responsivo em tempo real com visualização dos votos por candidato, percentuais, votos brancos/nulos, abstenções e projeção linear provisória.
- **Painel Administrativo (`/admin`):** Gestão operacional, ativação de turnos, visualização de cobertura e conferência de boletins.
- **Scanner de QRBU (`/admin/scanner`):** Interface ótica baseada em HTML5 para leitura contínua de QR Codes impressos nos Boletins de Urna, compatível com múltiplos dispositivos simultâneos.
- **API de Totais (`/api/totals`):** Endpoint de dados com cabeçalhos HTTP `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, prevenindo respostas obsoletas em proxies e navegadores.
- **Adaptador Dinâmico TSE (`/api/tse-results`):** Endpoint de consulta aos arquivos EA20 oficiais do TSE, inteiramente orientado pela configuração eleitoral persistida em `TseSyncConfig` e Setup Wizard, com isolamento de contexto e cache de 15 segundos.

---

## 2. Estado de Produção e Parâmetros Eleitorais

### Primeiro Turno (T1) — Histórico Preservado
- **Status:** `ACTIVE` (mantido para consulta pública e histórico).
- **Pleito (PLEI):** `3220`.
- **Eleição Federal:** `6257` | **Eleição Estadual SC:** `6259`.
- **Município:** `80837` — Concórdia/SC (`isCoverage: true`).
- **Boletins Processados:** 193 de 193 BUs esperados (100% concluído).
- **Votos Preservados:** 18.837 votos contabilizados e imutáveis.

### Segundo Turno (T2) — Pronto para Ativação
- **Status:** `PLANNED` (aguardando autorização no dia da eleição).
- **Pleito (PLEI):** `3221`.
- **Eleição Federal:** `6258`.
- **Cargo Único:** `1` — Presidente da República.
- **Candidatos Oficiais:**
  - `13` — **LULA** (PT)
  - `22` — **FLAVIO BOLSONARO** (PL)
- **Cobertura Provisória:** 193 urnas estimadas de referência (com base na malha histórica validada).
- **Boletins Processados:** 0 BUs contabilizados.
- **Fase de Operação:** `O` (Oficial). Boletins com `FASE:S` (Simulado) ou `FASE:T` (Treinamento) são estritamente rejeitados em produção com HTTP 400 (`SIMULATED_QRBU_REJECTED`).

---

## 3. Isolamento de Turnos (RoundContext Isolation)

O modelo de dados do sistema vincula cada eleição a turnos independentes (`ElectionRound`), garantindo:
1. **PLEI Independente:** Cada turno armazena seu próprio código oficial do pleito (`ElectionRound.plei`), eliminando riscos de aceitação cruzada entre T1 e T2.
2. **Cobertura por Turno (`RoundCoverage`):** As seções eleitorais são vinculadas especificamente a cada turno. O T1 possui 194 seções vinculadas na tabela `RoundCoverage`, enquanto o T2 registra dinamicamente as seções recebidas.
3. **Idempotência por `deterministicId`:** Cada BU recebe um identificador determinístico composto por `plei-roundNumber-state-city-zone-section-urn`. Tentativas de reenvio do mesmo BU são identificadas imediatamente e descartadas sem duplicidade de votos (HTTP 409).

---

## 4. Cadastro Dinâmico e Seções Agregadas

### Cadastro Dinâmico no Segundo Turno
No 2º turno, o sistema adota cobertura dinâmica supervisionada:
- Se uma seção da Zona `0090` de Concórdia enviar um BU oficial legítimo (`FASE:O`), o scanner a cadastra dinamicamente na base com `expectedBUs = 1`, cria o registro correspondente em `RoundCoverage` e registra a ação em `AuditLog`.
- Seções de municípios ou zonas fora do escopo configurado continuam estritamente rejeitadas com HTTP 403 (`OUT_OF_COVERAGE`).

### Seções Agregadas
- **Conceito:** Seções que votam na urna de outra seção principal. No cadastro de Concórdia, a seção `0125` da Zona `0090` está registrada com `expectedBUs = 0`.
- **Proteção:** Tentativas de escanear um BU gerado diretamente para a seção agregada `0125` são rejeitadas pelo backend com HTTP 403 (`SECTION_AGGREGATED_NO_BU`). Seus votos são computados na urna da seção principal.

---

## 5. Projeção Matemática Provisória

A projeção eleitoral exibida no painel público segue rigorosamente os seguintes critérios matemáticos e lógicos:

$$\text{Votos Projetados} = \text{round}\left( \text{Votos Atuais} \times \frac{\text{BUs Esperados}}{\text{BUs Processados}} \right)$$

### Regras de Exibição
1. **Aguardando Início:** Enquanto `processedReports == 0`, a projeção **não é calculada nem exibida**; o painel exibe aviso informando que a projeção aguarda a apuração da primeira urna.
2. **Durante a Apuração:** Exibida a partir de $1 \le \text{processedReports} < \text{expectedReports}$.
3. **Garantia de Não-Regressão:** Os votos projetados são sempre $\ge$ aos votos nominais já apurados.
4. **Conclusão:** Ao atingir 100% das urnas apuradas ($\text{processedReports} \ge \text{expectedReports}$), a projeção é **automaticamente ocultada**, restando apenas os resultados consolidados finais.

---

## 6. Deploy no Railway e Persistência SQLite

A aplicação é hospedada no **Railway** utilizando container Docker gerenciado e volume persistente.

### Requisitos Estruturais
- **Volume Persistente Obrigatório:** Um volume chamado `apuracao-paralela-2026-volume` montado em `/data`.
- **Banco de Produção:** O arquivo SQLite reside em `/data/prod.db`.
- **Espaço em Disco:** Recomenda-se manter pelo menos 100 MB livres no volume `/data`.

### Variáveis de Ambiente em Produção
| Variável | Valor Padrão / Exemplo | Finalidade |
| :--- | :--- | :--- |
| `DATABASE_URL` | `file:/data/prod.db` | Caminho do SQLite no volume persistente. |
| `JWT_SECRET` | `[chave aleatória de 256 bits]` | Assinatura dos tokens de sessão administrativa. |
| `ALLOW_OPERATIONAL_RESET` | `false` | Bloqueia a rota destrutiva `/admin/preparar`. |
| `ALLOW_SIMULATED_FASE` | `false` (ou ausente) | Rejeita BUs de teste (`FASE:S` e `FASE:T`). |
| `NEXT_PUBLIC_CITY_NAME` | `Concórdia` | Nome da cidade exibido na interface pública. |
| `NEXT_PUBLIC_STATE_CODE` | `SC` | Sigla da UF exibida na interface pública. |

---

## 7. Procedimentos de Backup e Recuperação

### Backups Locais no Volume
A cada alteração estrutural ou publicação, backups completos do banco de dados são gerados em `/data`:
- Exemplo: `/data/prod-backup-2026-10-23-pre-final-audit-publish.db`

### Exportação Segura para Fora da Infraestrutura (Offsite)
Antes do início da votação em 25/10/2026, exporte uma cópia de segurança do banco de produção para o computador local:
```powershell
# Executar no terminal com Railway CLI autenticado
railway ssh "cat /data/prod.db" > backups-local/prod-backup-2026-10-23-offsite.db

# Verificar integridade calculando o SHA-256
Get-FileHash backups-local/prod-backup-2026-10-23-offsite.db -Algorithm SHA256
```

### Procedimento de Restore de Emergência (Risco Elevado)
> [!CAUTION]
> A restauração substitui a totalização atual pela cópia de segurança anterior. Realize somente em caso de corrupção irreparável do banco.

1. Conecte-se ao container via SSH:
   ```bash
   railway ssh
   ```
2. Faça uma cópia do arquivo atual antes de sobrescrever:
   ```bash
   cp /data/prod.db /data/prod.db.damaged-$(date +%s)
   ```
3. Substitua o arquivo `/data/prod.db` pelo backup desejado:
   ```bash
   cp /data/prod-backup-YYYY-MM-DD.db /data/prod.db
   ```
4. Reinicie o serviço no painel do Railway para restabelecer conexões SQLite limpas.

---

## 8. Procedimentos no Dia da Eleição (25/10/2026)

### Antes das 17h00 (Pré-Abertura)
1. Execute o checklist de diagnóstico automatizado:
   ```bash
   node scripts/pre-election-readiness.mjs
   ```
2. Confirme que o painel público exibe os candidatos com zero votos e referência de ~193 urnas provisórias.
3. Confirme que os operadores possuem as credenciais de acesso em mãos.
4. **Após autorização expressa:** Acesse `/admin/turnos` e clique em **Ativar Turno** no card do 2º Turno. O status mudará de `PLANNED` para `ACTIVE`.

### Às 17h00 (Início da Coleta)
1. Os operadores acessam `/admin/scanner` em seus dispositivos (múltiplos logins simultâneos com a mesma conta são suportados).
2. Posicione a câmera sobre o QR Code principal do Boletim de Urna impresso (Página 1 do espelho do BU).
3. Aguarde a mensagem visual de sucesso (**"Boletim Processado"**).
4. O **primeiro BU recebido** deve ser auditado manualmente por um coordenador em `/admin/conferir/[id]`, confrontando município, zona, seção, votos nominais, brancos e nulos com a fita física de papel.

### Encerramento da Apuração
1. Quando todas as seções forem transmitidas, o painel atingirá 100% e a projeção linear desaparecerá automaticamente.
2. Acesse `/admin/turnos` para registrar o encerramento operacional se desejado.
3. Exporte a cópia final do banco `/data/prod.db` para arquivo imutável de prestação de contas.

---

## 9. Contingência e Resolução de Problemas

| Situação | Procedimento de Resolução |
| :--- | :--- |
| **Instabilidade de conexão no colégio eleitoral** | O operador deve fotografar com boa nitidez o QR Code impresso no BU físico. Assim que conectar à internet, abra `/admin/scanner` e leia o QR Code a partir da imagem. |
| **Leitura interrompida em QR multipartes** | O scanner armazena partes parciais da mesma sessão. Se houver falha, reescaneie os códigos na ordem indicada. |
| **Erro `SIMULATED_QRBU_REJECTED` (HTTP 400)** | O QR Code escaneado possui `FASE:S` ou `FASE:T`. Certifique-se de escanear o BU oficial impresso após as 17h00 da urna eletrônica (`FASE:O`). |
| **Erro `SECTION_AGGREGATED_NO_BU` (HTTP 403)** | A seção é agregada e não possui urna física independente. Seus eleitores votaram na seção principal do mesmo local. Não é necessário enviar este número de seção. |
| **Divergência entre BU de papel e tela** | Interrompa novos envios imediatamente. Acesse `/admin/conferencia`, localize o lote em questão e compare os hashes e votos com o relatório físico. |

---

## 10. Adaptador Dinâmico de Integração com o TSE (PR 8)

A partir da arquitetura universal 2.0 (PR 8), o endpoint `GET /api/tse-results` (`src/lib/tse/tseResultsService.ts` e `src/lib/tse/tseResultsCache.ts`) deixou de utilizar quaisquer parâmetros estáticos (ano, UF, código de município ou códigos de eleição pré-fixados) e passou a operar exclusivamente orientado pela configuração persistida no banco de dados.

### 10.1. Fonte Única de Configuração (`TseSyncConfig` + Setup Wizard)
- **Origem dos Dados:** Todos os parâmetros da integração são extraídos da tabela `TseSyncConfig` vinculada à entidade `Election` (`Election.year`, `Election.scopes`, `Election.offices` e `Election.rounds`), alimentada pelo Setup Wizard (`/api/admin/wizard` / `wizardService.ts`) ou diretamente no cadastro relacional da eleição.
- **Zero Acoplamentos Estáticos:** As URLs EA20 oficiais são construídas dinamicamente no padrão `{baseUrl}/ele{year}/{officialElectionCode}/dados/{abrFolder}/{abrPrefix}-c{cargoCode}-e{eleCode}-u.json`, suportando abrangências **MUNICIPAL** (`{uf}{muniTseCode}`), **ESTADUAL** (`{uf}`) e **NACIONAL** (`br`), bem como URLs personalizadas válidas em `TseSyncConfig.sourceUrl`.
- **Resolução de Cargos:** Cargos são resolvidos pelo campo `TseSyncConfig.officeCode` ou expandidos automaticamente para os registros de `Office` cadastrados na eleição quando `officeCode` for nulo (`ALL`). Os nomes exibidos priorizam o cadastro de `Office.name` e normalizam flexões de gênero da resposta oficial.

### 10.2. Isolamento entre Eleições, Turnos e Segurança (Anti-SSRF)
- **Contexto Eleitoral:** Sem o parâmetro `?election`, o endpoint resolve estritamente a eleição `ACTIVE` única (retornando HTTP 400 `ELEICOES_MULTIPLAS_ATIVAS` se houver ambiguidade). Com `?election=<id_ou_slug>`, apenas eleições nos estados públicos `ACTIVE` ou `FINISHED` são acessíveis; eleições `DRAFT` ou `ARCHIVED` são bloqueadas com **HTTP 403 (`CONTEXTO_NAO_AUTORIZADO`)**.
- **Anti-Proxy e Bloqueio de Sobrescrita:** Parâmetros externos de sobrescrita (`uf`, `muni`, `muniCode`, `muniTseCode`, `eleCode`, `officialElectionCode`, `year`, `sourceUrl`, `url`, `baseUrl`, `cargo`, `officeCode`, `scopeType`) na query string são sumariamente rejeitados com **HTTP 400 (`PARAMETRO_NAO_PERMITIDO`)**.
- **Validação Anti-SSRF em Camadas (`validateTseSourceUrl` / `resolveAndValidateTseSourceUrl`):**
  - **HTTPS Obrigatório em Produção:** Em produção (`NODE_ENV === 'production'`), apenas URLs `https://` públicas são aceitas; **HTTP e `localhost`/loopback são estritamente bloqueados** (exceções de loopback HTTP existem apenas mediante opt-in programático em testes automatizados Vitest, sem bypass em produção).
  - **Bloqueio Completo IPv4 e IPv6 Não Públicos:** Normaliza representações alternativas (decimal, octal, hexadecimal, abreviada e IPv4-mapeado em IPv6 `::ffff:...`) e bloqueia integralmente `127.0.0.0/8`, RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), `169.254.0.0/16` (link-local/metadata), `100.64.0.0/10` (CGNAT), `0.0.0.0/8`, multicast/reservados/documentação, além de IPv6 `::/128`, `::1/128`, `fe80::/10`, `fc00::/7` (ULA), `ff00::/8`, `2001:db8::/32` e hostnames internos (`.local`, `.internal`, `.localhost`, `metadata.google.internal`).
  - **Resolução DNS Multi-Registro e Proteção Anti-DNS-Rebinding:** Resolve todos os registros DNS (`all: true`) em modo fail-closed (rejeitando se qualquer registro apontar para IP não público), fixa os IPs validados diretamente no `lookup` do socket (`executePinnedHttpGetJson` com SNI/TLS validado) e bloqueia redirecionamentos HTTP (`3xx`).
- **Turnos Independentes:** O parâmetro obrigatório `?round=1` ou `?round=2` é validado por regex estrita `/^[1-2]$/` e filtra exclusivamente os registros de `TseSyncConfig` associados ao respectivo `roundNumber`.

### 10.3. Comportamento para Configurações Ausentes, Pausadas ou Incompletas
- **Configuração Ausente (`CONFIGURACAO_TSE_AUSENTE`):** Caso não exista eleição ativa ou não haja `TseSyncConfig` para o turno solicitado, o endpoint não aciona nenhuma URL externa e retorna resposta controlada HTTP 200 `{ status: 'NOT_YET_AVAILABLE', error: 'CONFIGURACAO_TSE_AUSENTE', offices: [] }` com `Cache-Control: no-store`.
- **Configuração Pausada (`CONFIGURACAO_TSE_PAUSADA`):** Quando todos os registros estiverem com `isActive: false` ou `status: 'PAUSED'`, nenhuma requisição externa é disparada (`status: 'NOT_YET_AVAILABLE'`, `no-store`).
- **Configuração Incompleta ou Inconsistente:** Configurações com `officialElectionCode` inválido, município ausente em escopo `MUNICIPAL`, `officeCode` nulo sem cargos cadastrados ou conflito de UF/município/SSRF são rejeitadas previamente com **HTTP 422 (`CONFIGURACAO_TSE_INCOMPLETA` / `CONFIGURACAO_TSE_INCONSISTENTE`)**, impedindo consultas externas malformadas ou inseguras.

### 10.4. Política de Cache Context-Bound de 15 Segundos e Resultados Parciais
- **Chave Criptográfica Contextual e Fingerprint Completo:** Implementada em `src/lib/tse/tseResultsCache.ts`, a chave de cache calcula SHA-256 sobre `[electionId, year, roundNumber, uf, muniTseCode, configFingerprint]`. O `configFingerprint` inclui integralmente os campos funcionais de:
  1. Todos os registros ativos de **`TseSyncConfig`** do turno;
  2. Todos os registros de **`ElectionScope`** da eleição (`scopeType`, `scopeKey`, `isCoverageArea`, UF e código/nome municipal);
  3. Todos os registros de **`Office`** cadastrados (`code`, `name`, `type` e ordenação por `orderNumber`).
- **Invalidação e Isolamento:**
  - Requisições repetidas dentro de **15 segundos** (`TSE_CACHE_TTL_MS = 15_000`) para o mesmo contexto e fingerprint reutilizam a resposta em memória e emitem `Cache-Control: public, max-age=15, stale-while-revalidate=15`.
  - Após 15 segundos, a entrada expira deterministicamente.
  - Qualquer alteração em `TseSyncConfig`, `ElectionScope`, `Office` (cadastro, código, nome ou ordenação), troca de eleição ou turno altera o fingerprint e purga imediatamente entradas obsoletas do mesmo `(electionId, roundNumber)`.
- **Política Explícita de Cacheabilidade por Cenário (`isCacheableTseResponse`):**

| Cenário | Status Retornado | HTTP | Entra no Cache (15s)? | Cabeçalho HTTP |
| :--- | :--- | :---: | :---: | :--- |
| **Resposta integralmente válida** (todos os cargos `AVAILABLE`) | `AVAILABLE` | `200` | **Sim** | `public, max-age=15, stale-while-revalidate=15` |
| **Resposta parcialmente disponível** (≥1 cargo `AVAILABLE` e outro(s) em `404`/`NOT_YET_AVAILABLE`, `TEMPORARILY_UNAVAILABLE` ou `INVALID_RESPONSE`) | `AVAILABLE` (mantém exibição parcial por cargo no painel) | `200` | **Não** | `no-store, no-cache, must-revalidate` |
| **Cargo ainda não publicado** (`404` em todos os cargos) | `NOT_YET_AVAILABLE` | `200` | **Não** | `no-store, no-cache, must-revalidate` |
| **Falha de rede / DNS / HTTP 5xx** (todos os cargos indisponíveis) | `TEMPORARILY_UNAVAILABLE` | `503` | **Não** | `no-store, no-cache, must-revalidate` |
| **Timeout externo** | `TEMPORARILY_UNAVAILABLE` | `503` | **Não** | `no-store, no-cache, must-revalidate` |
| **Payload inválido** (JSON corrompido, vazio ou divergente) | `INVALID_RESPONSE` | `502` | **Não** | `no-store, no-cache, must-revalidate` |

### 10.5. Tratamento de Falhas Externas e Limitações Conhecidas
- **Timeouts, Rede e Conexão Segura:** Cada consulta ao endpoint EA20 utiliza transporte com IP previamente validado e fixado (`executePinnedHttpGetJson`), `AbortController` com corrida temporal (`Promise.race`, padrão 5.000 ms) e bloqueio de redirecionamentos `3xx`. Timeouts, erros de rede/DNS e HTTP 5xx externos retornam status `TEMPORARILY_UNAVAILABLE` (**HTTP 503** quando nenhum cargo responder com sucesso), sem expor URLs internas, IPs privados, tokens ou stack traces.
- **Validação Estrita de Payload EA20:** Respostas JSON corrompidas, vazias (`{}`) ou com divergência em `t` (turno), `cdabr` (município/UF), `ele` (código da eleição) ou código do cargo são classificadas como `INVALID_RESPONSE` (**HTTP 502** quando nenhum cargo for válido).
- **Limitação Conhecida (Cache em Memória por Processo):** O cache contextual de 15 segundos reside em memória por instância do servidor Node.js. Em implantações multi-réplica sem stickiness, cada instância mantém seu próprio ciclo de 15s (mitigado pelo cabeçalho HTTP `max-age=15` e sem risco de mistura entre contextos).
