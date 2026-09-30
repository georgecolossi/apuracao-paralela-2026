# Fixtures Sintéticas (Derived/Invalid)

**Motivo:** O download do ZIP oficial de "Exemplos de Boletins de Urna com QR Code" diretamente do portal do TSE (`tse.jus.br`) foi bloqueado pelo Web Application Firewall (WAF - Akamai) durante a execução, retornando HTTP 403 Access Denied.

Como a regra proíbe estritamente classificar qualquer payload contendo `ASSI:signaturehere` ou `IDUE:1234567` como "Oficial", os arquivos de teste foram movidos para este diretório `derived-invalid`.

Estes payloads são derivações sintéticas estruturais que servem APENAS para validar a máquina de estados do parser (reconstrução multipart, tokenização, extração semântica e fluxo do app), e NÃO representam assinaturas criptográficas Ed25519 ou URIs autênticos das Eleições.

A comprovação de proveniência (`docs/TSE-2026-FIXTURE-PROVENANCE.md`) está marcada como **UNAVAILABLE**.
