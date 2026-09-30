# Apura��o Paralela 2026

Plataforma independente de apura��o paralela de votos para as elei��es de 2026.

Este sistema N�O � um sistema oficial do TSE.
Ele N�O tem validade jur�dica ou institucional.
Ele N�O substitui a totaliza��o oficial da Justi�a Eleitoral.

O sistema permite escanear QR Codes de Boletins de Urna (BUs), agreg�-los e exibir um painel p�blico de apura��o.

## Status da Valida��o (Elei��es 2026)
- **Parse Sem�ntico**: OK (Compat�vel com formato real QRBU 2026).
- **Valida��o de Hash (Integridade)**: OK (SHA-512 do payload concatenado, sem o campo HASH).
- **Assinatura Digital**: UNAVAILABLE (A valida��o de assinatura digital n�o est� implementada nesta vers�o e reportada como UNAVAILABLE. Apenas integridade via HASH � garantida).

## Tecnologias
- Next.js (App Router)
- Prisma ORM
- Tailwind CSS
- Vitest / Playwright


## Cobertura Geográfica

O sistema permite restringir os Boletins de Urna aceitos a municípios específicos utilizando a variável de ambiente COVERAGE_CITY_CODES.
Se configurado com uma lista de códigos de municípios separados por vírgula (ex: COVERAGE_CITY_CODES=1392,80879), o sistema rejeitará BUs fora dessa lista com erro 403 (Forbidden).
Se a variável for deixada em branco, todos os municípios são aceitos (padrão).
O exemplo 92 corresponde à fixture oficial do TSE para Acrelândia/AC utilizada nos testes.
