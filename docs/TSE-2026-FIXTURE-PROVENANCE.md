# Proveniência da Fixture Oficial TSE 2026

**STATUS: UNAVAILABLE**

O download do ZIP oficial de "Exemplos de Boletins de Urna com QR Code" diretamente do portal do TSE (`tse.jus.br`) foi interceptado e bloqueado pela proteção perimetral (Akamai WAF), retornando o seguinte erro na tentativa de extração automatizada:

```html
<TITLE>Access Denied</TITLE>
<H1>Access Denied</H1>
You don't have permission to access "http://www.tse.jus.br/eleicoes/eleicoes-2022/arquivos/tse-exemplos-de-boletins-de-urna-com-qr-code-eleicoes-2022/@@download/file" on this server.
Reference #18.d0c41002.1790696571.81d6cb56
```

Devido à rigorosa diretiva de que NENHUMA fixture com modificações sintéticas (ex: `ASSI:signaturehere` ou numeração fictícia) pode ser apresentada ou denominada como Oficial, a validação de proveniência byte-for-byte oficial não pôde ser atendida neste ciclo.

Todos os testes de parser estão rodando sobre *Synthetic Derived Fixtures*, claramente isoladas e demarcadas no repositório (`tests/fixtures/tse-2026/derived-invalid/`).
