# Rotina de Backup e Disaster Recovery

A integridade eleitoral da base requer backup contínuo do banco primário.

## Frequência
- **Logs de Auditoria:** Contínuo (WALS no Postgres).
- **Snapshot Frio:** A cada 30 minutos na data das eleições.
- **Retenção:** 5 anos.

## Script de Backup (PostgreSQL)

```bash
#!/bin/bash
TIMESTAMP=$(date +"%F_%T")
BACKUP_DIR="/var/backups/apuracao2026"
pg_dump -U postgres -d apuracao2026 -F c -f "$BACKUP_DIR/apuracao_$TIMESTAMP.dump"
```

## Restauração e Verificação

Em caso de corrompimento do banco primário:
1. Parar a aplicação (Downtime).
2. Restaurar dump: `pg_restore -U postgres -d apuracao2026_restore /var/backups/apuracao2026/apuracao_XXX.dump`
3. Como os agregados (Totalização) no painel `/apuracao` não são cacheados permanentemente e são derivados estritos de Live Query sobre `BallotVote`, a restauração garante que a soma reflita imediatamente o último BU salvo sem necessidade de reconstrução manual.
4. (Opcional) Executar o endpoint de recalculo em `/admin/recalcular` caso caches de Redis venham a ser implementados.

## Exportação Contábil
Independentemente do dump, operadores devem acionar `/api/export?format=csv` a cada fechamento de turno para possuir o dado espelhado em Excel (Disaster Recovery não-técnico).
