param (
    [Parameter(Mandatory=$true)]
    [string]$BackupFile
)

# 1. Verifica se o backup existe
if (-not (Test-Path -Path $BackupFile)) {
    Write-Error "Arquivo de backup não encontrado: $BackupFile"
    exit 1
}

# 2. Define o banco temporário
$TempDb = "prisma\verify-temp.db"

# 3. Impede sobrescrever bancos oficiais
$ProtectedDbs = @("prisma\dev.db", "prisma\prod.db", "prisma\test.db", "prisma\e2e.db")
if ($ProtectedDbs -contains $TempDb) {
    Write-Error "O destino temporário conflita com um banco oficial protegido."
    exit 1
}

# 4. Limpa qualquer temporário antigo
if (Test-Path -Path $TempDb) {
    Remove-Item -Force $TempDb
}

# 5. Restaura copiando o arquivo
Write-Host "Restaurando backup para o banco temporário ($TempDb)..."
Copy-Item -Path $BackupFile -Destination $TempDb

# 6. Executa verificação de integridade
Write-Host "Executando PRAGMA integrity_check..."
$integrity = sqlite3 $TempDb "PRAGMA integrity_check;"
if ($integrity -ne "ok") {
    Write-Error "Integridade comprometida! Resultado: $integrity"
    Remove-Item -Force $TempDb
    exit 1
}
Write-Host "Integridade: OK"

# 7. Consulta dados básicos (Count de BUs e Votos)
Write-Host "Inspecionando dados básicos..."
$reports = sqlite3 $TempDb "SELECT COUNT(*) FROM BallotReport;"
$votes = sqlite3 $TempDb "SELECT COUNT(*) FROM BallotVote;"

Write-Host "-> Total de BUs persistidos (BallotReport): $reports"
Write-Host "-> Total de Votos agregados (BallotVote): $votes"

Write-Host "O backup é VÁLIDO e PODE SER UTILIZADO."

# 8. Limpa o banco temporário
Remove-Item -Force $TempDb
Write-Host "Banco temporário removido."
exit 0
