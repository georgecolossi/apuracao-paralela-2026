# Relatório de Implementação — PR 7
## Últimas Urnas Apuradas — Imprensa e Rádio

**Data:** 30 de Outubro de 2026  
**Repositório:** `georgecolossi/apuracao-paralela-2026`  
**Branch de Origem (PR 7):** `feature/v2-pr7-press-radio`  
**Branch de Destino Autorizada:** `feature/v2-universal`  
**Base Commit:** `9fb0b44abf8a2e64b667a4876854c0d87dcb92c3`  
**Commit de Implementação (HEAD):** `e768db0`  

---

## 1. Sumário Executivo

O **PR 7** entrega o módulo público **"Últimas Urnas Apuradas — Imprensa e Rádio"**, concebido para atender às demandas de redações de jornalismo, radiodifusão, auditores e cidadãos durante a apuração eleitoral. O módulo disponibiliza:

1. **Feed Cronológico de Urnas:** Listagem paginada por keyset cursor dos Boletins de Urna processados, com resolução territorial de município, zona, seção e local de votação.
2. **Endpoint de Detalhe por Urna:** Visualização integral dos votos computados por cargo (majoritário e proporcional), candidatos, legendas partidárias, comparecimento e abstenção.
3. **Gerador de Roteiro para Locução em Rádio:** Geração dinâmica de texto estruturado para leitura oral imediata em estúdio de radiodifusão, sem nomes ou números fixos no código.
4. **Página Pública `/imprensa`:** Interface com atualização periódica automática (10s), pausada em aba oculta (`document.visibilityState === 'hidden'`), modo Teleprompter de alta legibilidade/contraste e cópia em 1 clique para a área de transferência.
5. **Gravação Temporal Confiável (`confirmedAt`):** Registro de data/hora exata no momento da homologação do BU para o status `PROCESSADO`, mantendo compatibilidade determinística com registros históricos.

---

## 2. Arquitetura e Decisões Técnicas

### 2.1. Semântica Temporal e Ordenação Determinística

- **Novas Confirmações:** Em `src/app/api/reports/[id]/confirm/route.ts`, ao atualizar o status para `PROCESSADO`, é gravado `confirmedAt: new Date()`.
- **Boletins Históricos:** Registros legados com `confirmedAt = null` utilizam `createdAt` como fallback para exibição, sendo explicitamente sinalizados como `(Estimado)` no DTO e na UI.
- **Ordenação Keyset no SQLite:** A ordenação composta:
  ```sql
  ORDER BY confirmedAt DESC, createdAt DESC, id DESC
  ```
  No SQLite (`NULL` é o menor valor em ordenações), garante que todos os registros com `confirmedAt` informado apareçam no topo, seguidos pelos registros históricos com `confirmedAt = null`, sem necessidade de SQL bruto ou funções proprietárias.
- **Desempate Lexicográfico:** O desempate por `id DESC` elimina ambiguidades quando timestamps coincidem.

### 2.2. Paginação Estável por Keyset Cursor (`urnaCursor.ts`)

- **Estrutura Base64URL:** O cursor codifica exclusivamente o payload `{ e, r, z, s, c, t, i }` em formato `base64url`. Trata-se de um token estruturado com validação estrita de schema e context binding, e não de um token assinado ou criptograficamente selado.
- **Avaliação de Risco e Ausência de HMAC:** Como o endpoint `/api/urnas` é público e exclusivamente de leitura, os filtros de segurança essenciais são garantidos pelo servidor na cláusula `WHERE` do Prisma (`electionId = activeElection`, `roundId = activeRound`, `status = 'PROCESSADO'`, `isSimulation = false`). Manipular os campos escalares `c`, `t` ou `i` do cursor altera unicamente os limites da paginação (`confirmedAt < c OR ...`), sem qualquer possibilidade de acessar dados de outras eleições, boletins não homologados, relatórios de simulação ou executar injeção SQL. Portanto, a ausência de HMAC/assinatura é uma decisão técnica fundamentada que elimina overhead de gerenciamento de chaves secretas sem criar brechas de segurança.
- **Context Binding:** A validação confere se a eleição (`e`), turno (`r`), filtro de zona (`z`) e seção (`s`) coincidem estritamente com os parâmetros da requisição atual. Em caso de divergência, a requisição é rejeitada com HTTP 400 (`CURSOR_CONTEXT_MISMATCH`).
- **Validação Estrutural Estrita:** Tokens com chaves extras, tamanho superior a 512 bytes, formato Base64URL irregular, timestamps ISO-8601 malformados ou códigos territoriais não canônicos são rejeitados com HTTP 400 sob política *fail-closed*.
- **Semântica Concorrente do Keyset:**
  - *Inserções Concorrentes:* Novos boletins que ingressam no topo do feed com `confirmedAt` mais recente não provocam deslocamento de página (*offset drift*) nem causam repetição de itens para leitores paginando com cursor anterior.
  - *Resiliência de Continuação:* A busca subsequente compara valores escalares (`confirmedAt`, `createdAt`, `id`) e prossegue corretamente mesmo se o registro referenciado pelo cursor tiver sido excluído.
  - *Comportamento Real:* Registros excluídos ou desclassificados do status `PROCESSADO` após a emissão do cursor naturalmente não constarão nas páginas seguintes, refletindo o estado atualizado do banco de dados sem falha estrutural do mecanismo de paginação.

### 2.3. Validação Territorial Estrita e Compatibilidade de Formatos (`territoryValidator.ts`)

- **Sem tolerância a espaços:** Rejeita strings com espaços ou vazias (`?zone= `, `?zone=`) sem aplicar `trim()` como mecanismo de aceitação permissiva.
- **Normalização Canônica:** Aceita de 1 a 4 dígitos numéricos ASCII (`/^\d{1,4}$/`), normalizando `0009` para `9` e rejeitando zeros absolutos (`0`, `00`).
- **Compatibilidade Territorial Ampla (`getTerritoryVariants`):** Gera todas as variantes com e sem zeros à esquerda (ex.: `['9', '09', '009', '0009']` ou `['42', '042', '0042']`), garantindo interoperabilidade entre formatos de importação históricos e oficiais do TSE nas consultas de feed e detalhe.

### 2.4. Validação Rigorosa de Parâmetros de Consulta (`route.ts`)

- **Turno (`round`):** Validação estrita por regex `/^[1-2]$/`, rejeitando entradas parcialmente numéricas (`1abc`, `2x`) com HTTP 400 (`TURNO_INVALIDO`).
- **Limite (`limit`):** Validação estrita por regex `/^\d+$/`, exigindo inteiro positivo $\ge 1$ (padrão 20, máximo 50). Entradas como `20x`, `0` ou valores negativos são rejeitadas com HTTP 400 (`PARAMETRO_INVALIDO`).

### 2.5. Resolução Territorial Otimizada (Evitando N+1)

Em `src/app/api/urnas/route.ts`, as tríades territoriais `(cityCode, zoneCode, sectionCode)` dos boletins da página são agrupadas e resolvidas em lote via `findMany` com cláusula `OR` composta por variantes de padding, mapeando municípios e locais de votação em memória (`sectionLookup`) em uma única consulta ao banco de dados.

### 2.6. Privacidade e Proteção de Dados (DTOs Públicos)

- As APIs públicas (`GET /api/urnas` e `GET /api/urnas/[id]`) não expõem campos operacionais ou sensíveis:
  - `operatorId` removido;
  - Hashes de senha e versões de sessão não existem nos modelos retornados;
  - Relatórios de simulação (`isSimulation: true`) são omitidos em cláusula `where: { isSimulation: false }`;
  - Somente relatórios com `status: 'PROCESSADO'` são disponibilizados.
- Cabeçalhos de cache: `Cache-Control: public, max-age=5, s-maxage=5, stale-while-revalidate=10`.

---

## 3. Arquivos Criados e Alterados

| Arquivo | Ação | Responsabilidade |
| :--- | :---: | :--- |
| `src/lib/presentation/pressDto.ts` | Criado | Interfaces tipadas de DTOs públicos (`UrnaFeedItemDTO`, `UrnaDetailDTO`, `UrnaFeedResponse`). |
| `src/lib/presentation/territoryValidator.ts` | Criado | Validador rigoroso de códigos de zona e seção eleitoral. |
| `src/lib/presentation/urnaCursor.ts` | Criado | Codificação, decodificação, contexto e segurança de keyset cursors. |
| `src/lib/presentation/radioScriptGenerator.ts` | Criado | Gerador agnóstico de roteiros de locução para rádio e estúdio. |
| `src/app/api/urnas/route.ts` | Criado | Endpoint público do feed de urnas com paginação e filtros. |
| `src/app/api/urnas/[id]/route.ts` | Criado | Endpoint público de detalhe de BU com roteiro de locução. |
| `src/app/api/reports/[id]/confirm/route.ts` | Modificado | Gravação de `confirmedAt: new Date()` no momento do processamento. |
| `src/components/press/UrnasFeed.tsx` | Criado | Componente React do feed com polling (10s), filtros e modo Teleprompter. |
| `src/components/press/UrnaDetailModal.tsx` | Criado | Modal de detalhe com abas de votos/rádio e cópia em 1 clique. |
| `src/app/imprensa/page.tsx` | Criado | Página pública `/imprensa` com header, navegação e footer. |
| `src/app/apuracao/page.tsx` | Modificado | Adicionado botão de navegação direta para `/imprensa` no header. |
| `tests/pr7-radio-script.test.ts` | Criado | Testes unitários do gerador de rádio, validadores e cursor (17 testes). |
| `tests/pr7-urnas-feed.test.ts` | Criado | Matriz completa de integração PAG-01 a PAG-30 e cache headers (31 testes). |
| `tests/pr7-press-component.test.tsx` | Criado | Testes com componentes React reais montados em Happy-DOM (7 testes). |

---

## 4. Matriz de Testes da Paginação por Keyset (PAG-01 a PAG-30)

| Código | Descrição do Caso de Teste | Status |
| :---: | :--- | :---: |
| **PAG-01** | Primeira página retorna registros ordenados por `(confirmedAt DESC, createdAt DESC, id DESC)` limitados por `limit`. | **Aprovado** |
| **PAG-02** | Paginação contínua avança para o próximo registro confirmado via keyset cursor. | **Aprovado** |
| **PAG-03** | Transição determinística: confirmados aparecem estritamente antes dos históricos (`confirmedAt = null`). | **Aprovado** |
| **PAG-04** | Continuação da paginação dentro do bloco histórico respeita `createdAt DESC, id DESC`. | **Aprovado** |
| **PAG-05** | Ao atingir o final dos registros, `hasMore = false` e `nextCursor = null`. | **Aprovado** |
| **PAG-06** | Desempate determinístico por `id DESC` quando timestamps coincidem exatamente. | **Aprovado** |
| **PAG-07** | Inserção concorrente no topo não causa deslocamento de offset (*offset drift*) nem repetição de itens. | **Aprovado** |
| **PAG-08** | Remoção concorrente do registro do cursor não quebra a continuação keyset por valores escalares. | **Aprovado** |
| **PAG-09** | Isolamento de eleições: boletins de outras eleições não aparecem no feed da eleição ativa. | **Aprovado** |
| **PAG-10** | Isolamento de turnos: registros do 2º turno não aparecem na consulta do 1º turno e vice-versa. | **Aprovado** |
| **PAG-11** | Filtro por Zona retorna apenas urnas da zona especificada. | **Aprovado** |
| **PAG-12** | Filtro por Seção retorna apenas urnas da seção especificada. | **Aprovado** |
| **PAG-13** | Filtro combinado de Zona e Seção retorna a urna específica. | **Aprovado** |
| **PAG-14** | Rejeição de cursor malformado/corrompido com HTTP 400 (`CURSOR_MALFORMADO`). | **Aprovado** |
| **PAG-15** | Rejeição de cursor com timestamp malformado com HTTP 400 (`CURSOR_INVALIDO`). | **Aprovado** |
| **PAG-16** | Rejeição de cursor com eleição divergente com HTTP 400 (`CURSOR_CONTEXT_MISMATCH`). | **Aprovado** |
| **PAG-17** | Rejeição de cursor com turno divergente com HTTP 400 (`CURSOR_CONTEXT_MISMATCH`). | **Aprovado** |
| **PAG-18** | Rejeição de cursor quando filtros de zona/seção divergem com HTTP 400 (`CURSOR_CONTEXT_MISMATCH`). | **Aprovado** |
| **PAG-19** | Isolamento de simulação: registros com `isSimulation: true` não aparecem no feed nem no detalhe (404). | **Aprovado** |
| **PAG-20** | Isolamento de status: registros com status diferente de `PROCESSADO` não aparecem no feed nem no detalhe (404). | **Aprovado** |
| **PAG-21** | Endpoint de detalhe `/api/urnas/[id]` retorna DTO completo com candidatos, comparecimento e roteiro. | **Aprovado** |
| **PAG-22** | Confirmação de BU (`POST /api/reports/[id]/confirm`) grava `confirmedAt: new Date()` atual no banco. | **Aprovado** |
| **PAG-23** | Parâmetro `?zone=` vazio é rejeitado com HTTP 400 (`PARAMETRO_INVALIDO`). | **Aprovado** |
| **PAG-24** | Parâmetro `?zone=%20%20` com espaços é rejeitado sem tolerância a `trim()`. | **Aprovado** |
| **PAG-25** | Parâmetro `?zone=0009` é aceito e normalizado canonicamente para `'9'`. | **Aprovado** |
| **PAG-26** | Parâmetro com formato não numérico (`?zone=abc` ou `?zone=12a`) é rejeitado com HTTP 400. | **Aprovado** |
| **PAG-27** | Parâmetro `?zone=0` (zero) é rejeitado com HTTP 400. | **Aprovado** |
| **PAG-28** | Cursor com zona não canônica (ex: `"09"` com zero à esquerda) é rejeitado no decode. | **Aprovado** |
| **PAG-29** | Cursor com tamanho superior a 512 bytes é rejeitado com HTTP 400. | **Aprovado** |
| **PAG-30** | Cursor com chaves extras não previstas é rejeitado sob validação estrutural estrita. | **Aprovado** |
| **PAG-31** | Parâmetro `?round=1abc` ou `?round=2x` parcialmente numérico é rejeitado com HTTP 400 (`TURNO_INVALIDO`). | **Aprovado** |
| **PAG-32** | Parâmetro `?limit=20x` parcialmente numérico é rejeitado com HTTP 400 (`PARAMETRO_INVALIDO`). | **Aprovado** |
| **PAG-33** | Parâmetro `?limit=0` ou negativo é rejeitado com HTTP 400 (`PARAMETRO_INVALIDO`). | **Aprovado** |
| **PAG-34** | Compatibilidade territorial: busca por zona/seção localiza variantes com e sem zeros à esquerda (`9`, `09`, `0009` / `42`, `0042`). | **Aprovado** |
| **PAG-35** | Compatibilidade territorial no detalhe `/api/urnas/[id]`: resolve município e seção para dados importados com variantes de padding. | **Aprovado** |

---

## 5. Comprovação dos Quality Gates

### 5.1. Prisma Schema Validate
```powershell
$env:DATABASE_URL="file:./test.db"; npx prisma validate
# Saída:
# Prisma schema loaded from prisma\schema.prisma
# The schema at prisma\schema.prisma is valid 🚀
```

### 5.2. Verificação de Codificação UTF-8
```powershell
npm run check:encoding
# Saída:
# Iniciando verificação estrita de encoding e integridade UTF-8 dos arquivos-fonte...
# Sucesso: Todos os arquivos-fonte possuem codificação UTF-8 íntegra, sem U+FFFD e sem mojibake.
```

### 5.3. TypeScript Typecheck
```powershell
npm run typecheck
# Saída:
# > tsc --noEmit
# (Concluído com código de saída 0 - zero erros de tipo)
```

### 5.4. Execução da Suíte Completa de Testes
```powershell
node scripts/run-tests.mjs --no-file-parallelism
# Saída:
# Test Files  60 passed (60)
# Tests       718 passed | 1 skipped (719)
# Duration    143.44s
# Result: 10/10 fixtures oficiais processadas com integridade.
```

### 5.5. Build de Produção Next.js
```powershell
npm run build
# Saída:
# ▲ Next.js 16.3.7 (Turbopack)
# ✓ Compiled successfully in 7.3s
# Finished TypeScript in 15.6s
# Generating static pages using 7 workers (23/23)
# Rotas geradas: 23 rotas (incluindo /imprensa, /api/urnas e /api/urnas/[id])
```

---

## 6. Conformidade com as Restrições Operacionais

1. **Ramo `main`:** Não foi alterado (`9d63936` preservado).
2. **Ambiente de Produção:** Banco `/data/prod.db` não foi acessado nem modificado.
3. **Migrações:** Nenhuma migração destrutiva foi executada. O modelo existente do Prisma (`confirmedAt DateTime?` e tabelas de cobertura) foi plenamente preservado.
4. **Isolamento de Branches:** Todo o desenvolvimento e validação ocorreram na branch `feature/v2-pr7-press-radio`.
