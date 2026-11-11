# Apuração Paralela 2.0 — Manual Operacional e de Infraestrutura

Este manual orienta a configuração, operação, homologação e manutenção em produção do **Apuração Paralela 2.0** (`v2.0.0`), com separação explícita entre **Desenvolvimento Local**, **Homologação / Staging** e **Produção**.

---

## 1. Visão Geral da Arquitetura Operacional

```text
[Coordenadores / Fiscais]                     [Cidadãos / Imprensa]
         ↓                                              ↓
  /admin/wizard  /admin/scanner               /apuracao      /imprensa
         ↓               ↓                         ↓             ↓
 /api/admin/wizard  POST /api/scan           GET /api/totals  GET /api/urnas
         ↓               ↓                   GET /api/tse-results
         └───────┬───────┘                              ↓
         [Prisma ORM (SQLite)] <────────────────────────┘
                 ↓
   dev.db (Local) | staging db | /data/prod.db (Produção)
```

### Interfaces e Rotas Principais
- **Painéis Públicos:**
  - `/apuracao`: totalização em tempo real por cargo/turno, indicadores de cobertura eleitoral, projeção provisória e comparativo dinâmico com o TSE (`/api/totals`, `/api/tse-results`).
  - `/imprensa`: feed cronológico **Últimas Urnas Apuradas** com filtros por Zona/Seção, detalhamento de urna, validação SHA-512, roteiro de locução para rádio e modo **Teleprompter** (`/api/urnas`, `/api/urnas/[id]`).
  - `/metodologia`: transparência sobre critérios matemáticos, validação criptográfica e escopo cívico independente.
- **Área Administrativa (`/login` e `/admin/*`):**
  - `/admin/wizard`: **Setup Wizard Universal** para criação/edição/ativação de eleições (Nacional, Estadual, Municipal ou Consulta Popular), cargos, turnos e fontes dinâmicas do TSE.
  - `/admin/usuarios`: gestão de contas e RBAC (`ADMIN`, `OPERATOR`, `VIEWER`), troca de senha e revogação instantânea de sessões (`sessionVersion`).
  - `/admin/turnos` e `/admin/cobertura`: ativação de turnos (`PLANNED` → `ACTIVE` → `FINISHED`) e gestão de malha/seções esperadas e agregadas (`RoundCoverage`).
  - `/admin/scanner`, `/admin/conferencia` e `/admin/conferir/[id]`: ingestão ótica/manual de QRBUs (incluindo multipartes) e conferência humana contra a fita física.
  - `/admin/audit`, `/admin/recalcular` e `/admin/preparar`: trilha de auditoria (`AuditLog`), inspeção de consistência e reset operacional controlado (bloqueado por padrão em produção).

---

## 2. Separação Explícita de Ambientes

| Aspecto | Desenvolvimento Local | Homologação / Staging | Produção |
| :--- | :--- | :--- | :--- |
| **Banco de Dados (`DATABASE_URL`)** | `file:./dev.db` | Arquivo SQLite isolado de staging | `file:/data/prod.db` (volume persistente dedicado) |
| **Testes Automatizados** | `test.db` e `e2e.db` (isolados pelos scripts) | Executados em CI/local antes do deploy | **Nunca** rodar suítes de teste contra `prod.db` |
| **Setup HTTP (`/api/setup`)** | `DISABLE_HTTP_SETUP="false"` | Desativar após bootstrap | **`DISABLE_HTTP_SETUP="true"`** após criar 1º admin |
| **BUs Simulados (`FASE:S`/`FASE:T`)** | `ALLOW_SIMULATED_FASE="false"` (ou `"true"` só em teste local controlado) | Conforme plano de ensaio; usar `isSimulation` no scanner para ensaios isolados | **`ALLOW_SIMULATED_FASE="false"`** (ou ausente) |
| **Reset Destrutivo (`/admin/preparar`)** | Opcional (`"false"` por padrão) | Permitido apenas em ensaios controlados | **`ALLOW_OPERATIONAL_RESET="false"`** obrigatório |
| **Banner de Staging (`NEXT_PUBLIC_APP_ENV`)** | `"development"` | `"staging"` (exibe aviso visual de homologação) | `"production"` (ou omitido) |
| **Protocolo e CSRF (`NODE_ENV`)** | HTTP `localhost:3000` permitido em `NODE_ENV !== 'production'` | HTTPS obrigatório em proxy reverso | **HTTPS estrito** + `APP_URL`, `NEXT_PUBLIC_APP_URL` e/ou `RAILWAY_PUBLIC_DOMAIN` configurados |

> [!CAUTION]
> Em nenhum momento execute scripts de reset, migração de teste ou alteração direta contra o banco de produção sem snapshot verificado prévio em `/data`.

---

## 3. Guia por Ambiente

### 3.1. Desenvolvimento Local
1. Copie `.env.example` para `.env` e defina `DATABASE_URL="file:./dev.db"` e um `JWT_SECRET` com pelo menos 32 caracteres aleatórios.
2. Aplique o schema Prisma:
   ```bash
   npx prisma db push
   ```
3. Crie o administrador inicial usando uma das formas:
   ```bash
   node scripts/create-initial-admin.mjs admin@local.test "SenhaForteLocal123" "Admin Local"
   ```
   Ou defina `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` / `INITIAL_ADMIN_NAME` no `.env` e execute `npx tsx prisma/seed.ts`.
4. Suba o servidor de desenvolvimento com `npm run dev` e acesse `/login` → `/admin/wizard`.
5. Para validar antes de commits, execute as suítes isoladas em `test.db` e `e2e.db`:
   ```bash
   npm run check:encoding && npm run typecheck && npm run test && npm run test:e2e
   ```

### 3.2. Homologação / Staging
1. Provisione uma instância separada com banco isolado e defina `NEXT_PUBLIC_APP_ENV="staging"`, `JWT_SECRET` exclusivo do ambiente e URL pública HTTPS em `APP_URL` e `NEXT_PUBLIC_APP_URL`.
2. Valide o fluxo completo via interface:
   - Criação de administrador inicial e login RBAC (`ADMIN` e `OPERATOR`).
   - Configuração da eleição de ensaio pelo `/admin/wizard` (definição de `year`, `type`, `scopes`, `offices`, `rounds` e `TseSyncConfig`).
   - Leitura de QRBU em modo simulação (`isSimulation`) confirmando que o painel público oficial (`/apuracao` e `/imprensa`) permanece isolado e sem contaminação.
   - Validação de rejeições (QRBU corrompido, seção agregada, fora de cobertura, `FASE:S` quando `ALLOW_SIMULATED_FASE="false"`).
   - Validação do `/api/tse-results` com configuração real/homologada e verificação da exibição no `/imprensa`.

### 3.3. Produção (Deploy, Volume Persistente e Segurança)

#### Variáveis de Ambiente Obrigatórias em Produção
| Variável | Valor Recomendado | Finalidade |
| :--- | :--- | :--- |
| `DATABASE_URL` | `file:/data/prod.db` | Banco SQLite no volume persistente montado em `/data`. |
| `JWT_SECRET` | `[chave CSPRNG >= 256 bits]` | Assinatura dos tokens JWT em cookie `HttpOnly`. Falha fechada (`JWT_SECRET_NOT_CONFIGURED`) se ausente. |
| `APP_URL` | `https://seu-dominio` | Origem primária aceita pela proteção CSRF (`src/lib/security/csrf.ts`). |
| `NEXT_PUBLIC_APP_URL` | `https://seu-dominio` | Origem pública configurada no cliente e na validação CSRF. |
| `RAILWAY_PUBLIC_DOMAIN` | `seu-app.up.railway.app` | Domínio público Railway adicionado automaticamente às origens HTTPS confiáveis. |
| `DISABLE_HTTP_SETUP` | `true` | Bloqueia `POST /api/setup` após criação do primeiro `ADMIN`. |
| `ALLOW_OPERATIONAL_RESET` | `false` | Bloqueia `/api/admin/reset` e a rota destrutiva `/admin/preparar`. |
| `ALLOW_SIMULATED_FASE` | `false` | Garante rejeição (`SIMULATED_QRBU_REJECTED`) de qualquer BU que não seja `FASE:O`. |
| `ALLOW_EXPERIMENTAL_VRQR` | `false` | Bloqueia versões experimentais não homologadas do QRBU. |
| `TSE_FETCH_TIMEOUT_MS` | `5000` | Timeout externo para consultas EA20 ao TSE. |
| `LOGIN_TRUSTED_PROXY_HOPS` | `1` (Railway direto) / `2+` (CDN + proxy) / `0` (sem proxy confiável) | Número exato de proxies reversos confiáveis à frente do app para leitura posicional de `X-Forwarded-For` da direita para esquerda em `POST /api/login` (validar cadeia real no ambiente de produção antes de elevar de `0`). |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` (opcional) | Janela em ms do rate limiting de login (padrão: 15 minutos). |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_PAIR` | `5` (opcional) | Máximo de falhas/reservas por par `(IP, conta)` — ou por conta quando o IP é desconhecido — na janela. |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_IP` | `20` (opcional) | Máximo agregado por `IP` verificado na janela (inativo quando não há IP confiável). |

#### Bootstrap Inicial Seguro em Produção
1. Com o volume `/data` montado e `npx prisma db push` aplicado:
   - **Opção A (recomendada — CLI via shell seguro):**
     ```bash
     node scripts/create-initial-admin.mjs "coordenador@dominio.org" "SenhaMuitoForte!" "Coordenador Geral"
     ```
   - **Opção B (HTTP temporário com token):** configure temporariamente `ADMIN_SETUP_TOKEN` (mínimo 16 caracteres CSPRNG), chame `POST /api/setup` enviando `{ name, email, password, setupToken }`, remova `ADMIN_SETUP_TOKEN` e fixe `DISABLE_HTTP_SETUP="true"`.
2. Faça `npm run build` e `npm start` sempre atrás de proxy reverso com TLS/HTTPS (`X-Forwarded-Proto: https`). Em `NODE_ENV=production`, mutações HTTP sem HTTPS são rejeitadas pela proteção CSRF.
3. **Configuração de Proxy Reverso (Railway / Nginx) e Rate Limiting de Login:**
   - **Em produção no Railway (proxy gerenciado único na borda):** configure `LOGIN_TRUSTED_PROXY_HOPS="1"` caso a aplicação receba o tráfego diretamente do proxy de borda do Railway (ou `"2"`/`"3"` caso exista CDN/WAF adicional à frente, como Cloudflare). **Ressalva operacional:** este repositório não validou empiricamente a cadeia real de `X-Forwarded-For` do serviço de produção no Railway; antes de depender do limite por IP, confirme em log/requisição de teste no ambiente alvo quantos hops confiáveis são anexados à direita.
   - **Leitura estrita e fail-safe:** com `LOGIN_TRUSTED_PROXY_HOPS >= 1`, o servidor lê `X-Forwarded-For` posicionalmente da direita para esquerda sem filtrar entradas malformadas (evitando deslocamento de índice para valores à esquerda forjados pelo cliente) e ignora `X-Real-IP`. Se `LOGIN_TRUSTED_PROXY_HOPS="0"`, ou se o cabeçalho estiver ausente, insuficiente ou malformado no sufixo confiável, nenhum identificador IP compartilhado é criado — o rate limiter aplica proteção individual por conta (`acct:<conta>`), impedindo bloqueio coletivo entre contas legítimas.
   - **Concorrência, capacidade e escopo:** cada requisição reserva capacidade antes da consulta ao banco e do `bcrypt` (evitando bypass por rajada concorrente) e libera em `finally`. Bloqueios ativos nunca são descartados sob saturação de memória (`10.000` entradas na store primária; excesso isolado em tabela de overflow fixa). Os contadores permanecem em memória volátil por instância Node.js e não são compartilhados entre múltiplas réplicas horizontais.

---

## 4. Ciclo Operacional e Governança da Eleição

### 4.1. Configuração Universal pelo Setup Wizard (`/admin/wizard`)
Qualquer eleição é configurada diretamente na interface administrativa sem edição manual de código:
1. Defina **Nome**, **Slug**, **Ano**, **Tipo** (`GENERAL`, `MUNICIPAL`, `SUPPLEMENTARY`, `CONSULTA`) e **PLEI**.
2. Cadastre os **Cargos (`Office`)** com código oficial TSE (`1` Presidente, `3` Governador, `5` Senador, `6` Dep. Federal, `7` Dep. Estadual, `11` Prefeito, `13` Vereador, etc.), tipo (`MAJORITARIO` / `PROPORCIONAL`) e ordem.
3. Defina as **Abrangências (`ElectionScope`)**: Nacional (`BR`), Estadual (`UF:<SIGLA>`) ou Municipal (`MUN:<CODIGO_TSE>`), permitindo múltiplas abrangências e eleições paralelas isoladas por contexto.
4. Configure os **Turnos (`ElectionRound`)** e opcionalmente as **Fontes TSE (`TseSyncConfig`)** ou importe configurações auxiliares.
5. Utilize o status `DRAFT` durante a preparação e ative a eleição (`ACTIVE`) apenas após validação completa.

> [!NOTE]
> Apenas uma eleição deve permanecer como `ACTIVE` padrão caso os consumidores consultem `/api/totals`, `/api/urnas` ou `/api/tse-results` sem o parâmetro `?election=<slug_ou_id>`. Eleições históricas em estado `FINISHED` continuam acessíveis mediante `?election=<slug_ou_id>` e preservam seus resultados imutáveis.

### 4.2. Controle de Acesso Baseado em Papéis (RBAC) e CSRF
- **`ADMIN`:** acesso integral (Wizard, usuários, turnos, cobertura, scanner, conferência, auditoria e recálculo). O sistema impede desativar, rebaixar ou excluir o último `ADMIN` ativo.
- **`OPERATOR`:** leitura em campo (`/admin/scanner`) e conferência de BUs (`/admin/conferencia`, `/admin/conferir/[id]`).
- **`VIEWER`:** perfil restrito sem permissão de mutação/escaneamento (recebe HTTP `403 FORBIDDEN_ROLE` ao tentar ingerir BUs ou confirmar boletins).
- **Sessões e Proteção CSRF:** senhas redefinidas ou sessões revogadas em `/admin/usuarios` incrementam `User.sessionVersion`, invalidando cookies antigos imediatamente. Requisições `POST`/`PUT`/`PATCH`/`DELETE` autenticadas passam por `validateCsrfProtection` (`Origin`/`Referer`/`Sec-Fetch-Site` ou header HMAC `x-csrf-token` de `GET /api/csrf-token`).

### 4.3. Turnos, Cobertura Dinâmica e Seções Agregadas
1. **Isolamento de Turnos:** `1º` e `2º` turnos operam com registros independentes em `ElectionRound` (PLEI próprio) e `RoundCoverage`.
2. **Ativação:** em `/admin/turnos`, ative o turno autorizado (`PLANNED` → `ACTIVE`).
3. **Seções Agregadas vs Cobertura Dinâmica:**
   - Seções agregadas possuem `expectedBUs = 0` (e/ou `isAggregated = true`) e têm seus envios diretos bloqueados com HTTP `403` (`SECTION_AGGREGATED_NO_BU`).
   - Em cobertura provisória/dinâmica no município em escopo, seções legítimas com `FASE:O` são cadastradas automaticamente com `expectedBUs = 1` e registradas em `AuditLog`.
4. **Projeção Provisória:** calculada por $\text{round}(\text{Votos Atuais} \times \frac{\text{BUs Esperados}}{\text{BUs Processados}})$ apenas enquanto $1 \le \text{processedReports} < \text{expectedReports}$; oculta-se automaticamente quando `processedReports == 0` ou ao atingir 100% da cobertura.

---

## 5. Operação no Dia da Eleição

### Pré-Abertura (Antes das 17h00)
1. Gere snapshot preventivo do banco operacional (Seção 7) antes de abrir os trabalhos.
2. Confirme no painel `/admin` que a eleição correta está `ACTIVE`, o turno desejado está `ACTIVE` e a cobertura territorial/cargos está conferida.
3. Confirme acesso de operadores no `/login` e funcionamento de câmera + plano de contingência (foto nítida do QRBU para leitura via arquivo/texto em `/admin/scanner`).
4. Valide manualmente `GET /api/totals?round=1` (ou `2`), `GET /api/urnas?round=...` e `GET /api/tse-results?round=...` garantindo ausência de erros `422`/`500`.

### Durante a Apuração (Após as 17h00)
1. Operadores autenticam-se em `/admin/scanner` e realizam a leitura dos fragmentos do QRBU (`QRBU:n:m`). Múltiplos dispositivos são suportados simultaneamente; reenvios do mesmo BU são bloqueados atomicamente por `deterministicId` (HTTP `409 DUPLICADO`).
2. Cada BU ingerido segue para conferência humana em `/admin/conferir/[id]`, onde coordenadores validam `HASH VERIFICADO` (SHA-512) e comparam votos nominais, brancos e nulos com a fita impressa antes de acionar **Confirmar e Totalizar**.
3. O painel `/apuracao` e a sala `/imprensa` exibem imediatamente os boletins confirmados (`PROCESSADO`, `isSimulation = false`).

### Pós-Apuração e Encerramento
1. Exporte a prestação de contas contábil em CSV via `GET /api/export?format=csv` (autenticado como `ADMIN`).
2. Opcionalmente altere o turno ou a eleição para `FINISHED` em `/admin/turnos` / `/admin/wizard`, preservando histórico somado para consulta pública via `?election=<slug>`.
3. Gere backup final e valide sua integridade e hash SHA-256 fora do servidor.

---

## 6. Contingência e Resolução de Problemas

| Situação / Código | Procedimento de Resolução |
| :--- | :--- |
| **Instabilidade de internet no local de votação** | Fotografe com nitidez os QR Codes do BU impresso; quando houver conexão, use a contingência de imagem/texto manual em `/admin/scanner`. |
| **Erro `SIMULATED_QRBU_REJECTED` (HTTP 400)** | O payload possui `FASE:S` ou `FASE:T`. Confira se o documento escaneado é o BU oficial impresso após o encerramento (`FASE:O`). |
| **Erro `CRYPTOGRAPHIC_INTEGRITY_FAILED` (HTTP 400/422)** | Divergência no hash SHA-512 ou texto truncado. Reinicie a sessão de leitura no botão de refresh do cabeçalho e leia os fragmentos novamente em boa iluminação. |
| **Erro `SECTION_AGGREGATED_NO_BU` (HTTP 403)** | Seção agregada a outra principal. Leia o BU impresso da seção principal receptora. |
| **Erro `OUT_OF_COVERAGE` / `ELECTION_CONTEXT_MISMATCH`** | Verifique se o município/zona do BU integra a abrangência configurada no Setup Wizard e se o `plei`/turno do BU corresponde ao turno `ACTIVE`. |
| **Falha CSRF em proxy reverso (`403 CSRF`)** | Verifique se `APP_URL`, `NEXT_PUBLIC_APP_URL` e/ou `RAILWAY_PUBLIC_DOMAIN` correspondem exatamente ao domínio HTTPS externo e se o proxy envia `X-Forwarded-Proto: https`. |

---

## 7. Backup, Verificação e Restauração (SQLite)

### Backup Local / Windows (Scripts Oficiais)
```powershell
# Gera snapshot consistente via sqlite3 (.backup) em backups/prod-YYYYMMDD-HHMMSS.db
.\scripts\backup-operacional.ps1 -DbPath "prisma\prod.db" -BackupDir "backups"

# Valida PRAGMA integrity_check e contagem de BallotReport / BallotVote em banco temporário isolado
.\scripts\verify-backup.ps1 -BackupFile "backups\prod-YYYYMMDD-HHMMSS.db"
```

### Backup Offsite e Restore no Volume `/data` (Railway)
```powershell
# Exporta cópia local do banco em produção (Railway CLI autenticado)
railway ssh "cat /data/prod.db" > backups-local/prod-backup-offsite.db
Get-FileHash backups-local/prod-backup-offsite.db -Algorithm SHA256
```

> [!CAUTION]
> **Restore de Emergência:** só sobrescreva `/data/prod.db` se houver corrupção irrecuperável, sempre após parar novas gravações e copiar o arquivo danificado.
> ```bash
> railway ssh
> cp /data/prod.db /data/prod.db.damaged-$(date +%s)
> cp /data/prod-backup-YYYY-MM-DD.db /data/prod.db
> # Em seguida reinicie o serviço no painel Railway.
> ```

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

---

## Apêndice Histórico — Implantação Piloto 1.0 (Concórdia/SC)

Antes da arquitetura universal 2.0, o sistema operou em produção na implantação inicial dedicada ao município de Concórdia/SC (código TSE `80837`), contabilizando **193 de 193 BUs esperados** e **18.837 votos** no 1º Turno (PLEI `3220`) e preparando a cobertura provisória do 2º Turno (PLEI `3221`, com seção agregada `0125` na Zona `0090` bloqueada com `expectedBUs = 0`). Na versão `v2.0.0`, esses contextos permanecem suportados como registros históricos isolados dentro do mesmo modelo universal multi-eleição.
