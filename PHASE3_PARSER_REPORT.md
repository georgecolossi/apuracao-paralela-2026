# RELATÓRIO DA FASE 3: IMPLEMENTAÇÃO DO PARSER REAL DO BU 2026

## 1. Documentação Oficial Utilizada
Foram realizadas buscas exaustivas avançadas (Dorks) por materiais oficiais do TSE (Eleições 2026) referentes à estrutura ASN.1 DER do Boletim de Urna e do Registro Digital do Voto. 
A conclusão formal desta busca encontra-se detalhada no arquivo de auditoria `docs/TSE-2026-DOCUMENT-AUDIT.md`. A conclusão é de que os materiais técnicos estruturais estão **NÃO LOCALIZADOS** nos portais públicos do TSE.

## 2. Arquivos Oficiais Utilizados como Fixtures
**Nenhum.** As publicações e manuais estritos do formato binário ASN.1 para 2026 ainda não foram disponibilizados publicamente no repositório de transparência do TSE. As chaves públicas ED25519/RSA para o ciclo 2026 também encontram-se indisponíveis.

## 3. Formato Real Descoberto
A arquitetura foi fundamentada na praxe estrutural do TSE documentada em pleitos passados, mas estritamente desacoplada para 2026:
- Cabeçalhos textuais para identificação da parte (`QR BU:X/Y:`).
- Codificação de Payload Binário comprimido ou puro em codificação ISO-8859-1.
- Árvore binária codificada sob as regras **DER (Distinguished Encoding Rules) da sintaxe ASN.1**.

## 4. Arquitetura do Parser
A classe `Tse2026BallotReportParser` foi construída para seguir o pipeline rigoroso de decodificação:
`Decodificação de String Multipartes -> Reconstrução de ArrayBuffer -> Decodificador ASN.1 (asn1js) -> Validadores Abstratos (Estrutural/Semântico)`.

## 5. Etapas Implementadas
- Decodificador de Header Multipartes agnóstico (não interfere em offsets de bytes do payload).
- Conversor transparente de bytes (Latin1) para `ArrayBuffer`.
- Extrator ASN.1 BER/DER genérico provido pela biblioteca oficial `asn1js`.
- Abstração completa dos Validadores.

## 6. Campos Extraídos
**NENHUM.** Em obediência à regra estrita de "NÃO INVENTAR O FORMATO", "Não inventar offsets" e "Não criar parser ASN.1 aproximado", a extração de campos falha intencionalmente retornando o código de erro `SCHEMA_2026_UNAVAILABLE`.

## 7. Validações Implementadas
- Validação estrutural de falha de decodificação de bytes em base64/latin1.
- Validação estrita de violação de DER (`asn1.offset === -1`).
- Assinatura: Isolada e retorna `UNAVAILABLE`.

## 8. Validações Indisponíveis
- Mapeamento Semântico.
- Mapeamento Estrutural Específico (árvore `SEQUENCE`, `OCTET STRING`, etc).
- Assinatura ED25519.

## 9. Testes Criados e Executados
Foram criados testes unitários baseados no Vitest (`tests/tse2026-parser.test.ts`) para garantir a passagem das etapas arquiteturais sem crashar a thread.
- **Resultados:** 3 testes executados, 3 aprovados (confirmando a queda controlada no erro `SCHEMA_2026_UNAVAILABLE` quando injetado um binário DER válido mas não mapeado semanticamente).
- **E2E Playwright com Fixture Real:** **FALHA/BLOQUEADO**. Como não existe fixture real de 2026 e é proibido utilizar mocks textuais nesse teste, o script E2E de validação de tela com dados do parser real encontra-se bloqueado logicamente.

## 10. Limitações e Bloqueadores
A aplicação atinge o teto do que pode ser arquitetado no escopo do software. Todo o pipeline binário e de segurança (concorrência e deduplicação no banco) foi provado, mas aguarda a *spec* ASN.1 de 2026 para mapear a injeção final do JSON no DB.

---

# STATUS: PARSER REAL 2026

⚠️ **PARCIAL**

**Justificativa Objetiva:** A arquitetura binária estrita exigida de decodificação e reconstrução ASN.1 foi construída sem ofender nenhuma regra de offset ou suposição (o parser atual não usa pipe-separated, e sim a decodificação de bytes `ArrayBuffer` e processamento `asn1js`). No entanto, a extração efetiva dos campos para visualização na UI e consolidação das somas falha estritamente devido à não publicação do esquema oficial do ano correspondente pelas autoridades. O E2E exigido usando "fixture oficial" é impossível pelo mesmo fator bloqueador.


## Atualizao Fase 5 (Parser Real)
Posteriormente foi localizado o Manual oficial do QR Code no Boletim de Urna das Eleies 2026. A concluso anterior SCHEMA_2026_UNAVAILABLE estava baseada em busca documental incompleta. O parser agora atua com base no mapeamento chave-valor real do QRBU.
