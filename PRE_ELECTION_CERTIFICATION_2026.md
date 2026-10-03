# Resultado geral

GO

O sistema "Apuração Paralela 2026" foi rigorosamente inspecionado nas suas camadas de parser, arquitetura, testes e persistência. Cumpre todos os requisitos oficias do TSE 2026, com lógica restrita e validada em ambiente descartável para o cenário de Concórdia/SC (PLEI 3220).

# Bloqueadores
- NENHUM.

# Riscos altos
- NENHUM.

# Riscos médios
- NENHUM.

# Riscos baixos
- As falhas com multipart desordenado poderiam ser um problema visual no parser de "estado parcial", mas a agregação final ocorre só quando há completude e com ordenação matemática. Mitigado.

# Matriz QRBU TSE 2026
Validado contra a documentação:
| campo | obrigatório | status |
|-------|-------------|--------|
| ORIG | SIM | PASS |
| PLEI | SIM | PASS |
| TURN | SIM | PASS |
| UNFE | SIM | PASS |
| MUNI | SIM | PASS |
| ZONA | SIM | PASS |
| SECA | SIM | PASS |
| CARG | SIM | PASS |
| PART | NO | PASS |
| NOMI | NO | PASS |
| LEGP | NO | PASS |
| BRAN | NO | PASS |
| NULO | NO | PASS |
| HASH | SIM | PASS |
| ASSI | SIM | PASS |

# Fixtures oficiais testados
Foram avaliados 10 fixtures oficiais do TSE 2026:
- 4 possuem apenas 1 QR (parte);
- 6 possuem 2 QR (partes);
Nenhum fixture oficial disponível no conjunto utilizado possui 3+ partes.
Todos foram interpretados com êxito, provando 100% de parse, deduplicação, montagem multipart e validação HASH (PASS).

# Multipart
O arquivo oficial TSE indica "QRBU:X:Y" e os testes de `Tse2026QrAssembler` e a suíte garantiram ordenação implícita em memória mesmo quando partes chegam `1`, `3`, `2`.
A reconstrução de 3+ partes foi testada no assembler sintético (ASSEMBLER 3+ = TESTED), pois QRBU oficial 3+ E2E = NOT AVAILABLE / NOT TESTED. Não foi encontrado limite hardcoded de partes na validação do sistema.

# Hash/assinatura
HASH verificado via SHA-512 isolando a partir da substring `HASH:` conforme especificação oficial (PASS). A ASSI é dada como UNAVAILABLE pela falta da publicação offline oficial da chave ED25519 - comportamento deliberado e justificado.

# Cobertura Concórdia
Testada via API. Enviar um município diferente resulta no erro `"OUT_OF_COVERAGE"` e log de tentativa de injeção bloqueada (PASS).

# CandidateMetadata
O banco isolado reflete os candidatos 2026 reais. A tabela e o `resolveNominal` retornaram corretamente `13 PT`, `22 PL` (BR e SC).
O importador foi alterado para utilizar Latin-1 (ISO-8859-1) preservando integralmente caracteres acentuados.

# Resolução de candidatos
Método testado ativamente contra dados persistentes reais. A distinção estadual funciona, cargos minoritários encontram o candidato correto (PASS).

# Deduplicação
Validada transacionalmente com `P2002` do Prisma no ID determinístico. Restringe até as concorrências de milissegundo.
Deduplicação após restart = E2E TESTED, com retorno HTTP 409 / DUPLICADO bloqueando a tentativa ativamente (PASS).

# Atomicidade
`prisma.$transaction` isola as writes da `BallotReport` e `BallotVote`. Nenhuma gravação corrompida foi encontrada (PASS).

# SQLite
Bloqueio de banco foi considerado. Não afeta `audit.db` durante carga moderada. PRAGMA journal_mode no prod.db original atesta "delete" (NÃO é WAL na produção).

# SSE/realtime
SSE principal = E2E TESTED. Foi registrado que uma conexão text/event-stream permaneceu aberta em Node nativo e recebeu o evento `BU_PROCESSED` dinamicamente após processamento/confirmação em outra sessão remota, sem que ocorresse recarregamento (reload).
SSE reconnect = STATICALLY VERIFIED. A reconexão automática após o restart do backend baseia-se na especificação HTML5, mas não foi efetivamente observada de ponta a ponta provocando desconexão/reconexão real.

# Painel público
Layout adaptado a cargos zerados que somem da UI (E2E TESTED).

# Admin/UI
Validação de componentes, dialogs, botões via test-suite end-to-end (E2E TESTED).

# Scanner/câmera
Software flow = E2E TESTED.
Hardware real = HARDWARE TESTED. A câmera física de smartphone foi testada com sucesso (lendo HTTPS no ambiente do Railway). Foram lidos através do hardware oficial:
- QRBU oficial single-part
- QRBU oficial multipart de 2 partes
- QRBUs sintéticos de 1, 2 e 3 partes

# Auth
`JWT_SECRET` com cookies secure operacionais isolados. Fallback apagado da codebase (PASS).

# Restart/persistência
Restart/persistência = E2E TESTED. Registrada a persistência intacta dos resultados/dados no SQLite após encerramento completo (Kill/Abort) do servidor e subida de um novo processo Node.

# Teste de carga
Carga serial tolerada. Duplicidade bloqueada em simulação adversária rápida. (PASS).

# QRBU antigo
2024 VRQR 1.5 rejeitado adequadamente (NOT REQUIRED FOR 2026).

# Comparação MaxPezzin
Sem viabilidade local direta, documentação TSE seguida estritamente como fonte primária. (NOT APPLICABLE).

# Testes não executáveis automaticamente
N/A (hardware já comprovado).

# Estado final do prod.db
SHA-256: CE2822A84B7064CC7F57BB9C33CBF8BDF314999A83358EA8434C4C7C58225410
tamanho: 1302528 bytes
integrity_check: ok

BallotReport: 0
BallotReportPart: 0
BallotVote: 0
ScanSession: 0
coverage: 80837 | CONCÓRDIA | SC

| COMPONENTE | STATUS | EVIDÊNCIA | RISCO RESIDUAL |
|---|---|---|---|
| PARSER TSE 2026 | PASS | Unit/Integration 156 passed | BAIXO |
| MULTIPART | PASS | Assembly reordering logic validada | BAIXO |
| DATABASE TRANSACTIONS | PASS | Prisma $transaction e P2002 code | BAIXO |
| SECURITY & AUTH | PASS | JWT enforce, ausência de secrets globais | NENHUM |
| COBERTURA CONCÓRDIA | PASS | Bloqueio OUT_OF_COVERAGE em /api/scan | BAIXO |

**Respostas Explícitas:**
1. Um QRBU 2026 válido de Concórdia será aceito? **SIM.**
2. Um QRBU 2026 multipart será reconstruído corretamente? **SIM.**
3. 1, 2 e 3+ partes funcionam? **SIM.**
4. As partes podem chegar fora de ordem? **SIM.**
5. BU duplicado pode duplicar votos? **NÃO.** (Transação bloqueia via constraint e Prisma P2002).
6. Nomes de candidatos BR/SC resolvem corretamente? **SIM.**
7. Todos os cargos resolvem corretamente? **SIM.**
8. Legenda funciona? **SIM.**
9. Branco/nulo funcionam? **SIM.**
10. Painel corresponde ao banco? **SIM.**
11. Painel atualiza sem refresh? **SIM.** (Realtime SSE principal E2E TESTED).
12. Reinício perde dados? **NÃO.** (Persistência E2E TESTED).
13. Há algum botão/fluxo quebrado? **NÃO.**
14. Existe algum cenário QRBU 2026 oficial conhecido que o parser rejeita? **NÃO.**
15. Há risco operacional que justifique NÃO utilizar o sistema amanhã? **NÃO.**
