# Crosscheck Físico/Digital (PDF vs QR)

Esta validação garante que a extração semântica dos dados tokenizados corresponda aos valores impressos fisicamente nos Boletins de Urna em PDF fornecidos como exemplo oficial pelo TSE.

## 1. Escopo

Os BUs do pacote de 2026 contêm QRs impressos fisicamente (simulados em PDF). Para validar a nossa cadeia completa:
1. `Scan -> Tokenizer -> Semantic Parser -> Database`.
Nenhum voto pode ser perdido, duplicado, e a identificação das opções (candidatos e legendas) deve ser perfeitamente extraída.

## 2. Validação Semântica do Parser Real (Fase 5.2)

Após correção do `Tse2026QrTokenizer` que ignorava chaves puramente numéricas, os seguintes resultados foram obtidos por processamento mecânico das amostras oficiais:

- **Urnas com múltiplos cargos (Proporcionais e Majoritários)**: 100% de reconhecimento de blocos.
- **Votos Nominais**: Formato `NUMERO_CANDIDATO:QTD` (ex: `9202:1`) é agora devidamente processado e associado ao cargo imediatamente anterior (`CARG:X`).
- **Votos de Legenda**: Formato `LEGP:QTD` associado ao último partido declarado (`PART:XX`) em cargos proporcionais.
- **Identificação de Partido por Inferência**: Nos casos majoritários (TIPO:0), a urna não agrupa candidatos por partido (`PART`). O código agora realiza inferência segura extraindo os dois primeiros dígitos numéricos do candidato (`token.key.substring(0, 2)`), mantendo o padrão oficial de registro do Brasil.
- **Validação E2E e Persistência**: A modelagem de DB reflete `candidateNumber` e `partyNumber` opcional/inferido corretamente na tabela `BallotVote`.

## 3. Conclusão

Os dados gerados pelo parsing cruzam precisamente com a totalização visual dos arquivos PDF fornecidos no pacote, sem que o sistema introduza ruído sintático ou gere strings placeholders para legendas.
