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
