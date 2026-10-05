# Apuração Paralela 2026 - Concórdia/SC

Sistema independente e não-oficial projetado para auditar, contabilizar e apresentar em tempo real o resultado primário da eleição (1º Turno de 2026) a partir da leitura óptica direta dos Boletins de Urna (QRBU) de Concórdia, SC.

**ESTE É UM SISTEMA INDEPENDENTE DE APURAÇÃO PARALELA. NÃO POSSUI VÍNCULO, HOMOLOGAÇÃO OU VALIDADE OFICIAL PERANTE O TRIBUNAL SUPERIOR ELEITORAL (TSE).**

---

## Estado Operacional

O sistema alcançou o status **OPERACIONAL**. Foi submetido a baterias de testes físicos, lógicos e automatizados para atuar no ambiente de apuração paralela de Concórdia/SC (PLEI 3220).

**Limitações conhecidas:** Trata-se de uma aplicação de escopo fechado, sem garantias de segurança absoluta, confiabilidade absoluta ou compatibilidade ilimitada de hardware móvel. O software atende estritamente às especificações necessárias para a missão em questão.

---

## Arquitetura Atual

- **Backend / Frontend**: Next.js (App Router).
- **Persistência**: Banco de dados relacional (SQLite via Prisma ORM) operando em `journal_mode=delete`.
- **Hospedagem**: Railway.app com volume persistente montado em `/data`.
- **Comunicação**: HTTPS.
- **Interfaces**:
  - Painel Administrativo protegido por autenticação isolada (cookies httpOnly secure) via Username/Password.
  - Painel Público (`/apuracao`) acessível via navegador.
- **Scanner Óptico**: Scanner web via câmera do smartphone (`html5-qrcode`).
- **Realtime**: Server-Sent Events (SSE) notificando o painel público a cada confirmação de Boletim de Urna, descartando a necessidade de atualizações manuais (F5).
- **Modelo de Dados**:
  - **Boletim de Urna (BU/QRBU)**: A leitura em papel/tela se mantém a todo instante como a *única fonte primária e irrevogável* da verdade de dados de totalização, validada via assinatura de hash (SHA-512) conforme norma TSE 2026.
  - **Eleições e Turnos (Election e ElectionRound)**: A base suporta múltiplos turnos no mesmo banco de dados. A totalização pública e a exportação operam exclusivamente sob a perspectiva do turno (Round) atualmente marcado como ACTIVE. BUs importados em turnos anteriores permanecem inteiramente preservados no banco histórico, garantindo que a transição de ciclo não exija destruição de dados (ZERAR APURAÇÃO). Através do painel **Admin > Gerenciar Turnos**, o operador pode encerra o turno atual e ativar o subsequente (alterando os estados de PLANNED -> ACTIVE e ACTIVE -> FINISHED). Essa transição é inteiramente transacional, impede reaberturas acidentais e nunca apaga o histórico de votos prévio.
  - **CandidateMetadata**: Dados reais oficiais carregados unicamente para enriquecimento visual (nomes de urna e partidos) no UI. Eles não interferem no algoritmo matemático de agregação dos totais brutos.

---

## Escopo Operacional (Hardening)

O sistema possui proteções (fail-closed) explícitas na rota de parsing para evitar a injeção ou totalização acidental de dados espúrios e fixtures da fase de testes:

- **Município / UF**: Concórdia / SC (Código TSE: 80837).
- **Pleito (PLEI)**: 3220.
- **Turno (TURN)**: 1.
- QRBUs escaneados com origem diferente são bloqueados com erro `OUT_OF_COVERAGE` e impedidos de ingressar na base operacional.

---

## Deploy

O sistema é implantado utilizando contêineres na plataforma Railway. O ambiente deve prover persistência apropriada no disco.

**Configuração do Ambiente de Produção:**
A execução do Node/Next no contêiner exige estritamente:
- `DATABASE_URL="file:/data/prod.db"` (apontando para o volume).
- Configurações estritas como `ADMIN_USERNAME`, `ADMIN_PASSWORD` e `JWT_SECRET` geridas de maneira segura via enclaves operacionais do Railway (nunca commitadas e não documentadas textualmente).

*Nota: O ambiente Staging é utilizado puramente para testes destrutivos. Segredos não são compartilhados.*

---

## Validações Realizadas (Certification)

O sistema conta com as seguintes certificações para a fase eleitoral final:

- **Parser Oficial TSE**: Fixtures oficiais do TSE 2026 foram submetidos e validados estrutural e matematicamente `[TESTED]`.
- **Leitura via Câmera (1 Parte)**: QRBU oficial single-part testado com leitura física pelo celular via HTTPS (Railway) `[HARDWARE TESTED]`.
- **Leitura via Câmera (2 Partes)**: QRBU oficial multipart (2 partes) testado fisicamente e ordenado/montado pelo assembler `[HARDWARE TESTED]`.
- **Assembler QRBU (3+ Partes)**: QRBUs sintéticos (criados sob medida) de 1, 2 e 3 partes foram processados com sucesso. O assembler não tem limite de blocos. *O pacote de fixtures do TSE não disponibilizou QRBUs oficiais com 3 ou mais partes para verificação final em hardware.* `[TESTED]`
- **Realtime (SSE)**: Conexão text/event-stream verificada atualizando dinamicamente a UI (sem necessidade de F5) imediatamente após aprovação do BU pela mesa. `[E2E TESTED]`
- **Reconexão Realtime (SSE)**: Mecânica nativa de fallback HTTP do navegador confirmada pelo protocolo EventSource spec. `[STATICALLY VERIFIED]`
- **Persistência / Deduplicação**: Reinício abrupto do backend (Kill/Start) não corrompe SQLite, não perde votos e não reseta totais. QRBUs já validados antes do reset não podem ser inseridos de novo. `[E2E TESTED]`

---

## Ferramentas de Apoio (QRBU Sintético)

O sistema possui em sua base de scripts uma ferramenta oficial (`generate-synthetic-qrbu.js`) construída para certificar limites e falhas (stress test). Esta ferramenta elabora QRBUs 100% sintéticos imitando Concórdia/SC.

* **Comando:** `npm run test:generate-qrbu`

**ATENÇÃO:**
Os artefatos criados pela ferramenta:
- São **MOCK/SINTÉTICOS**.
- Não possuem validade legal.
- Não foram criados por urna oficial do TSE nem carregam assinatura privada ECDSA TSE.
- Se apontados sob a lente na instância de Produção, eles "envenenariam" irreversivelmente a totalização oficial paralela por obedecerem ao código `80837/3220/1` de segurança. Devem ser escaneados unicamente no Staging local descartável.

---

## Isolamento e Testes

O projeto trabalha com uma estrutura restrita:
- `dev.db` (desenvolvimento / npm run db:setup).
- `test.db` (Vitest integração com prisma-test-environment).
- `e2e.db` (Playwright isolado).
- `prod.db` (Operação final intocada).

Além das separações de banco, o projeto dispõe de um script preventivo de auditoria de encoding (`npm run check:encoding`), para assegurar que caracteres corrompidos (como U+FFFD) não sejam adicionados inadvertidamente aos arquivos-fonte e documentação.

---

## Referências Oficiais
- Tribunal Superior Eleitoral: https://www.tse.jus.br
- Candidatos TSE 2026: https://dadosabertos.tse.jus.br/pt_BR/dataset/candidatos-2026
- Informações técnicas e manuais técnicos de divulgação de resultados e QRBU (Edição 2026).

## Leitor Operacional de BU .dat (TSE 2026)

O projeto inclui agora uma ferramenta de linha de comando (scripts/bu-dat/decode_all_bu.py e run_dry_run.ts) capaz de fazer parse recursivo e decodificacao estruturada dos Boletins de Urna oficiais em formato ASN.1 fornecidos pelo TSE para a Eleicao de 2026. Essa ferramenta realiza decodificacao validada e viabiliza dry-runs pre-importacao para confrontar BUs do disco com o banco de dados operacional, identificando duplicidades, dados ineditos e eventuais conflitos, sem alterar o sistema em producao.

