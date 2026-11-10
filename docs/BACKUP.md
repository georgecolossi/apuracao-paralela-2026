# Rotina de Backup e Disaster Recovery

A integridade eleitoral da base exige cópias regulares do arquivo SQLite operacional e exportações contábeis auditáveis.

---

## 1. Runtime Padrão (SQLite)

No schema ativo (`prisma/schema.prisma`), toda a persistência reside em um arquivo SQLite único (`prisma/dev.db` em desenvolvimento ou `/data/prod.db` no volume persistente em produção).

### Scripts PowerShell Disponíveis (Operação Windows/Local)
- **Gerar backup online seguro (`.backup` do CLI `sqlite3`):**
  ```powershell
  .\scripts\backup-operacional.ps1 -DbPath "prisma\prod.db" -BackupDir "backups"
  ```
- **Verificar integridade e contagem mínima (`PRAGMA integrity_check` em banco temporário isolado):**
  ```powershell
  .\scripts\verify-backup.ps1 -BackupFile "backups\prod-YYYYMMDD-HHMMSS.db"
  ```
> Requer o executável `sqlite3` disponível no `PATH`.

### Backup Offsite em Volume Persistente (Railway)
Em produção gerenciada sobre volume `/data`, consulte os comandos completos de snapshot, hash SHA-256 e restore na Seção **Produção** de [`docs/OPERACAO.md`](./OPERACAO.md).

---

## 2. Exportação Contábil Independente

Além do backup físico do banco, operadores autorizados podem exportar os resultados via:
- `GET /api/export?format=csv` (recomendado a cada marco de fechamento/turno para arquivo imutável e conferência externa).

---

## 3. Cenário Alternativo PostgreSQL (`prisma/schema.postgresql.prisma`)

Caso a implantação adote PostgreSQL com o schema alternativo (`prisma/schema.postgresql.prisma`), utilize snapshots nativos via `pg_dump` / `pg_restore` antes de janelas de manutenção e valide a contagem de `BallotReport` e `BallotVote` após restauração.
