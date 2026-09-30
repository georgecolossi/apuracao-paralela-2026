# RELATÓRIO DA FASE 4: PLATAFORMA INDEPENDENTE

## Visão Geral
A infraestrutura sistêmica da "Apuração Paralela 2026" foi integralmente estabilizada, refatorada para transacionalidade real e escalonamento em PostgreSQL, isolando metodicamente a limitação imposta pela ausência da documentação oficial do QR Code 2026.

Nenhuma regra de negócio inventada foi embutida. A plataforma suporta *Dual-Mode* (Real e Simulação) de forma rigorosamente apartada.

---

## Separação Funcional (Matriz de Entrega)

### A) Funcionalidades Efetivamente Prontas
- **Autenticação:** BCrypt com sessões geridas via JWT HTTP-Only Cookies.
- **Isolamento de Estado (Sessão de Scan):** Tratamento correto de QRs multipartes desvinculado da tabela definitiva.
- **Dashboard Global (`/admin/conferencia`):** Lista global de BUs, identificando operadores, datas, modo de operação e status.
- **Painel Administrativo:** Status de instâncias, estatísticas agregadas de reais/simulados e sinalização ostensiva de que a engine de *Parsing 2026* encontra-se documentalmente bloqueada.
- **Live Query & Recálculo:** Arquitetura de soma e reagregação sem *stale cache*, permitindo anulação instantânea (com transação isolada de auditoria).
- **Exportação:** Endpoint configurado para CSV e JSON em `/api/export`, extraindo a base processada em formato de prestação de contas.
- **Preparação para PostgreSQL:** `.env.example`, `DEPLOY.md`, `BACKUP.md` com scripts atômicos de WALS e disaster recovery configurados para ambiente relacional pesado.

### B) Funcionalidades Testadas
- Concorrência de BUs duplicados simultaneamente (Vitest).
- Recuperação em memória de `ScanSession` com deduplicação de índices.
- Operações de CRUD nativas e relacionamentos complexos.

### C) Funcionalidades Testadas Apenas em Simulação
- **Testes Ponta a Ponta (E2E com Playwright):** Um parser especial `Tse2026SimulationParser` foi introduzido e roda sob a flag `isSimulation`. Ele permite validar que a UI de Conferência, as API Routes e o banco de dados funcionam em uníssono sob carga, mas garante (via injeção de ID modificado) que o dado do teste end-to-end NUNCA vazará para a contabilidade da Apuração Pública (`isSimulation: false`).

### D) Funcionalidades Bloqueadas pela Ausência da Especificação TSE 2026
- **Parser Semântico Real 2026:** Mantém o status `SCHEMA_2026_UNAVAILABLE`.
- **E2E Real com Fixtures:** Impossibilitado de acontecer até o lançamento do manual pelo tribunal.

### E) Funcionalidades Pendentes para Produção
- **Pub/Sub Distribuído:** O *Realtime Server-Sent Events* atual opera via processo em memória local. Se implantado em Vercel/Cluster, as instâncias precisarão de um *Redis* ou similar para propagar os eventos lateralmente.

---

## Conclusão de Prontidão
O projeto conclui a Fase 4 atingindo seu cume arquitetural independente. As fundações de segurança, performance, log de auditoria, concorrência e exportação estão validadas. O gap atual diz respeito estritamente à liberação das dependências regulatórias pela justiça eleitoral (esquema `ASN.1`, curvas `ED25519` e dicionários de compensação de bytes).


## Atualiza��o Fase 5 (Parser Real)
Posteriormente foi localizado o Manual oficial do QR Code no Boletim de Urna das Elei��es 2026. A conclus�o anterior SCHEMA_2026_UNAVAILABLE estava baseada em busca documental incompleta. O parser agora atua com base no mapeamento chave-valor real do QRBU.
