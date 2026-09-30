# TSE 2026 Official Fixture Inventory

Este documento inventaria as amostras oficiais do Tribunal Superior Eleitoral para as Eleições 2026 (QR Code Boletim de Urna).

O TSE publicou um conjunto de exemplos (ZIP original com SHA-256 `8b1e28fdaff1d589b26836c27727715df8de71efaf0b0bf0cda49c0380a47bc9`) contendo imagens dos BUs impressos. A partir destas imagens, os dados QR foram mecanicamente extraídos (decoded).

Abaixo está o inventário atestando as capacidades do parser atual (`Tse2026BallotReportParser`) ao processar estas fixtures oficiais reais.

## Resumo de Validação Criptográfica

A validação criptográfica (HASH) é a prova definitiva de que o parser interpretou o array de bytes do payload real do TSE de forma idêntica à especificação oficial do HASH.

**Status do Algoritmo de Reconstrução TSE 2026:** ✅ Descoberto e Implementado (Fase 5.2). O hash da parte `N` é validado concatenando-se o conteúdo útil de todas as partes de `1` a `N`, sem o cabeçalho `QRBU:n:x VRQR:6.0 `.

## Matriz de Cobertura

| Arquivo Origem | Descrição / Contexto | QRBU Parts | Status Hash | Status Assinatura | Votos Decodificados (Tokenização) |
| --- | --- | --- | --- | --- | --- |
| `UE2013_s02110ac0139200090110-imgbu` | Urna Eletrônica 2013 | 2 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `UE2015_s02110ac0139200090110-imgbu` | Urna Eletrônica 2015 | 2 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `UE2020_s02110ac0139200090110-imgbu` | Urna Eletrônica 2020 | 2 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `UE2022_s02110ac0139200090110-imgbu` | Urna Eletrônica 2022 | 2 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `s02110ac0139200090110-imgbusa` | Urna sem Assinatura de Juiz (Especial) | 2 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `RED_s02110ac0139200090110-imgbu` | Recuperação de Dados (RED) | 2 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `Pres-T2_s02202ac0139200090013-imgbu` | Presidente 2º Turno | 1 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `PresGov-T2_s02200ac0139200090013-imgbu` | Pres. e Gov. 2º Turno | 1 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `PresGovConMunic-T2_s02120ac0139200090013-imgbu` | Múltiplos Cargos 2º Turno | 1 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |
| `PresGovPrefeito-T2_s18153sp6665603020018-imgbu` | Múltiplos Cargos 2º Turno com Prefeito | 2 | ✅ VERIFIED | 🟡 UNAVAILABLE | ⚠️ PARCIAL (Apenas Branco/Nulo) |

**Nota sobre a Tokenização**: A validação do hash demonstrou que a camada de bytes está correta. No entanto, o `Tse2026QrTokenizer` atual utiliza uma Expressão Regular incompatível com o formato numérico sem prefixo (e.g., `PART:92 9202:1`). Este parser será reescrito na etapa seguinte para capturar os votos nominais de candidatos e legendas.
