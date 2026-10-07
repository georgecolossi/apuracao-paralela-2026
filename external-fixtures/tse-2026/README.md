# Artefatos Oficiais TSE 2026

## Origem e Finalidade
Este diretório contém especificações, scripts de referência Python, diagramas e documentações técnicas distribuídas oficialmente pelo Tribunal Superior Eleitoral (TSE) referentes ao formato de arquivos e dados das eleições de 2026.

**IMPORTANTE:** 
- Os fixtures e exemplos do TSE (encontrados em `external-fixtures/tse-2026-official-fixtures/` e `tests/fixtures/`) são utilizados APENAS para fins de validação técnica do parser, decodificador e fluxos do aplicativo.
- Estes fixtures (como os do Acre e simuladores) NÃO representam BUs reais do município de Concórdia/SC.
- NENHUM dado destes arquivos deve ser inserido no banco de dados operacional de produção para configurar a Eleição, o PLEI, ou candidatos do 1º ou 2º Turno.

## Estrutura de Arquivos
- `specs/`: Contém os arquivos de definição técnica `.asn1` originais e inalterados para `bu`, `rdv` e `assinatura`.
- `reference-python/`: Código-fonte fornecido pelo TSE como prova de conceito para dump e verificação dos arquivos `.dat`.
- `diagrams/`: Diagramas conceituais UML (arquivos `.puml`) explicando o relacionamento de chaves e pacotes.
- `docs/`: Manuais em PDF liberados pelo TSE que detalham os padrões do QR Code e demais componentes do ecossistema criptográfico.

## Turnos Presentes e Fixtures de Exemplos (T2)
Os exemplos em formato `.dat` e `.pdf` estão no diretório de exemplos legados (`tse-2026-official-fixtures/examples/`) e correspondem aos cenários:
- **T1:** `BU_apuracao_eletronica_pelo_SA`, `BU_urna_encerrada_pelo_RED`, e simuladores de urna (UE2013 a UE2022).
- **T2:** Simuladores isolados contemplando combinações de cargos como: `Pres-T2` (Somente Presidente), `PresGov-T2` (Presidente e Governador), `PresGovConMunic-T2`, `PresGovPrefeito-T2`.

Estes arquivos PDF servem para testes visuais com a Câmera/Scanner, enquanto os arquivos `.dat` oferecem verificação binária com o log original ASN.1.

## Integridade
Os arquivos aqui dispostos são cópias `byte-for-byte` dos artefatos oficiais obtidos no "dados baixados tse.zip". Para validar a integridade dos arquivos, consulte o `MANIFEST.sha256` anexo.
