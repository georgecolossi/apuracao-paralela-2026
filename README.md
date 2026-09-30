# Apura��o Paralela 2026

Plataforma independente de apura��o paralela de votos para as elei��es de 2026.

Este sistema N�O � um sistema oficial do TSE.
Ele N�O tem validade jur�dica ou institucional.
Ele N�O substitui a totaliza��o oficial da Justi�a Eleitoral.

O sistema permite escanear QR Codes de Boletins de Urna (BUs), agreg�-los e exibir um painel p�blico de apura��o.

## Status da Valida��o (Elei��es 2026)
- **Parse Sem�ntico**: OK (Compat�vel com formato real QRBU 2026).
- **Validação de Hash (Integridade)**: OK (SHA-512 do payload concatenado, sem o campo HASH).
- **Assinatura Digital**: UNAVAILABLE. A validação implementada nesta versão contempla a verificação de integridade via HASH. A validação de assinatura digital permanece indisponível.

## Tecnologias
- Next.js (App Router)
- Prisma ORM
- Tailwind CSS
- Vitest / Playwright


## Cobertura Geográfica

O sistema permite restringir os Boletins de Urna aceitos a municípios específicos utilizando a variável de ambiente COVERAGE_CITY_CODES.
Se configurado com uma lista de códigos de municípios separados por vírgula (ex: COVERAGE_CITY_CODES=1392,71072), o sistema rejeitará BUs fora dessa lista com erro 403 (Forbidden).

**Aviso:** O valor 1392,71072 é apenas um exemplo técnico de lista de códigos utilizados pelo ambiente e testes, e NÃO significa automaticamente a configuração final de Concórdia e região. A configuração final de produção será definida posteriormente.
Se a variável for deixada em branco, todos os municípios são aceitos (padrão).
O exemplo 1392 corresponde à fixture oficial do TSE para Acrelândia/AC utilizada nos testes.
