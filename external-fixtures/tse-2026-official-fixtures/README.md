# Fixtures oficiais — QR Code do Boletim de Urna — TSE 2026

Fonte: pacote **Exemplos de Boletins de Urna com QR Code**, disponibilizado na página oficial Eleições 2026 do TSE.

- Arquivo recebido: `exemplos-de-boletins-de-urna-com-qr-code.zip`
- SHA-256 do ZIP: `8b1e28fdaff1d589b26836c27727715df8de71efaf0b0bf0cda49c0380a47bc9`
- Exemplos processados: 10
- PDFs processados: 10

## Regras de integridade

1. Os PDFs e `.dat` originais estão copiados em `examples/*/source/`.
2. Os textos em `examples/*/decoded/qr*.txt` são o resultado direto da decodificação dos QR Codes.
3. Nenhum payload QR foi corrigido ou editado manualmente.
4. `manifest.json` registra SHA-256 dos arquivos de origem, página do QR, tipo, índice e SHA-256 do payload.
5. `qrbu-mechanical-reconstruction.txt` é apenas uma reconstrução mecânica de conveniência. Ela **não deve ser usada como definição do input criptográfico** sem confronto com o Manual do QR Code 2026.
6. Os `.dat` são preservados como arquivos-fonte, mas não são tratados como se fossem o texto do QR impresso.

## Uso no projeto

Copie os payloads `QRBU` para `tests/fixtures/tse-2026/official/` preservando os bytes.
Fixtures adulteradas para testes negativos devem ser derivadas em outro diretório, nunca modificando estes arquivos.

Consulte `provenance.json` para a proveniência completa.
