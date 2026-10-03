param (
    [string]$DbPath = "prisma\prod.db",
    [string]$BackupDir = "backups"
)

# 1. Verifica se o diretório de backups existe, senão cria
if (-not (Test-Path -Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
    Write-Host "Diretório de backups criado: $BackupDir"
}

# 2. Verifica se o banco existe
if (-not (Test-Path -Path $DbPath)) {
    Write-Error "Banco operacional não encontrado em: $DbPath"
    exit 1
}

# 3. Verifica se o CLI sqlite3 está instalado e no PATH
$sqliteAvailable = Get-Command "sqlite3" -ErrorAction SilentlyContinue
if (-not $sqliteAvailable) {
    Write-Error "Dependência Ausente: O utilitário de linha de comando 'sqlite3' não foi encontrado no PATH."
    Write-Error "O backup online seguro do SQLite exige essa ferramenta."
    Write-Error "Instale o SQLite CLI para Windows ou adicione-o ao PATH e tente novamente."
    exit 1
}

# 4. Define o nome do backup com timestamp para evitar sobrescrita
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path -Path $BackupDir -ChildPath "prod-$timestamp.db"

# 5. Executa o backup seguro
Write-Host "Iniciando backup online seguro..."
Write-Host "Origem: $DbPath"
Write-Host "Destino: $backupFile"

# Usa Invoke-Expression ou exec direto
# O comando .backup do SQLite trava o banco momentaneamente apenas para leitura e faz a cópia segura
$command = "sqlite3 `"$DbPath`" `".backup '$backupFile'`""
Invoke-Expression $command

if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha ao executar o backup via sqlite3."
    exit 1
}

Write-Host "Backup concluído com sucesso: $backupFile"
exit 0
