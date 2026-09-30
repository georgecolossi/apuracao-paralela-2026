# Auditoria Documental Oficial TSE 2026

**Data/hora da auditoria:** 29 de Setembro de 2026, 11:45 (Horário do Sistema)

**Páginas principais consultadas via Dorks/Search:**
- `https://www.tse.jus.br/eleicoes/eleicoes-2026` (Acesso direto negado por 403 Forbidden; inspecionado via indexação Google e ferramentas de busca direcionadas ao domínio).
- Portal de Transparência TSE (`site:tse.jus.br "Especificação Técnica" "QR Code" "2026"`).
- Portal de Sistemas Eleitorais (`site:tse.jus.br "Manual do QR Code" "2026"`).
- Repositórios e anexos (`site:tse.jus.br "Bu2026.asn1" OR "rdv2026.asn1" filetype:zip OR filetype:pdf`).

## Relação Completa dos Materiais 2026 Encontrados

A busca exaustiva por arquivos, manuais técnicos e pacotes de fixtures vinculados estritamente às Eleições 2026 no domínio oficial (`tse.jus.br`) não retornou arquivos estruturais. As referências bibliográficas encontradas em notícias institucionais apontam que o Ciclo de Transparência Democrática 2026 existiu, mas os pacotes `.zip` ou repositórios públicos abertos com os esquemas `.asn1` não foram indexados ou disponibilizados ao público geral através de links acessíveis na presente data.

Não foram localizados manuais em PDF, ZIPs de exemplos de QR ou dicionários de dados específicos de 2026.

## Tabela de Aceitação e Existência

| Item necessário | Encontrado? | Fonte oficial | Evidência | Suficiente para implementação? |
|---|---|---|---|---|
| Manual QR 2026 | NÃO LOCALIZADO | Portal TSE | Pesquisa por `"Manual do QR Code" "2026" site:tse.jus.br` retornou menções em notícias, mas sem PDF ou spec. | NÃO |
| Formato QR | NÃO LOCALIZADO | Portal TSE | Sem manual técnico. | NÃO |
| Multipartes | NÃO LOCALIZADO | Portal TSE | Sem manual técnico. | NÃO |
| Payload binário | NÃO LOCALIZADO | Portal TSE | Sem manual técnico. | NÃO |
| ASN.1 | NÃO LOCALIZADO | Portal TSE | Busca por `*.asn1` ou `"ASN.1" "2026" site:tse.jus.br` sem hits com código. | NÃO |
| Schema | NÃO LOCALIZADO | Portal TSE | Idem. | NÃO |
| Campos BU | NÃO LOCALIZADO | Portal TSE | Legislação (Res. 23.751/2026) descreve campos gerais, mas sem offset/schema para parsing. | NÃO |
| Hash | NÃO LOCALIZADO | Portal TSE | Não há documentação do algoritmo exato ou offset. | NÃO |
| Assinatura | NÃO LOCALIZADO | Portal TSE | Não há documentação das curvas ou offsets 2026. | NÃO |
| Chave pública | NÃO LOCALIZADO | Portal TSE | Repositórios de chaves 2026 não listados. | NÃO |
| Fixtures BU 2026 | NÃO LOCALIZADO | Portal TSE | Sem arquivos ZIP oficiais. | NÃO |
| Exemplo QR real | NÃO LOCALIZADO | Portal TSE | Sem fotos oficiais de BU impresso de 2026 no portal técnico. | NÃO |

## Conclusões Negativas
- **Não localizado em:** `https://www.tse.jus.br/eleicoes/eleicoes-2026` e todo o subdomínio `tse.jus.br` via buscas avançadas de Search Engine utilizando operadores exatos (`filetype:zip`, `filetype:pdf`, `ext:asn1`).
- Todos os itens necessários para a engenharia reversa do QR Code foram classificados como **NÃO LOCALIZADO**, pois a evidência aponta apenas ausência de publicação pública acessível no momento atual para a competência de 2026, diferentemente dos repositórios antigos de 2022/2024 que historicamente existiram mas que estão proibidos de serem reaproveitados sob presunção.

## Diretriz Adotada
Em conformidade com a política restritiva de *Não Inventar*:
A abstração `SCHEMA_2026_UNAVAILABLE` será mantida intocável no parser recém criado. Nenhum offset, schema ASN.1, posições ou tamanho de campo foi inserido ou deduzido. Nenhuma simulação E2E forjada foi criada. O código permanece aguardando a documentação.
