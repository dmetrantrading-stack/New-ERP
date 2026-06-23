# Daily PostgreSQL backup for D METRAN ERP
# Reads connection settings from backend\.env
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\backup-database.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot 'backend\.env'
$backupDir = Join-Path $projectRoot 'backups'

if (-not (Test-Path $envFile)) {
  Write-Error "Missing backend\.env"
}

$config = @{}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#') -and $line -match '^([^=]+)=(.*)$') {
    $config[$matches[1].Trim()] = $matches[2].Trim()
  }
}

$dbHost = if ($config['DB_HOST']) { $config['DB_HOST'] } else { 'localhost' }
$dbPort = if ($config['DB_PORT']) { $config['DB_PORT'] } else { '5432' }
$dbName = if ($config['DB_NAME']) { $config['DB_NAME'] } else { 'd_metran_erp' }
$dbUser = if ($config['DB_USER']) { $config['DB_USER'] } else { 'postgres' }
$dbPass = $config['DB_PASSWORD']

if (-not $dbPass) {
  Write-Error 'DB_PASSWORD not set in backend\.env'
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  $pgVersions = Get-ChildItem 'C:\Program Files\PostgreSQL' -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  foreach ($ver in $pgVersions) {
    $candidate = Join-Path $ver.FullName 'bin\pg_dump.exe'
    if (Test-Path $candidate) {
      $pgDump = @{ Source = $candidate }
      break
    }
  }
}
if (-not $pgDump) {
  Write-Error 'pg_dump not found. Add PostgreSQL bin to PATH or install PostgreSQL.'
}

$pgDumpExe = if ($pgDump.Source) { $pgDump.Source } else { $pgDump.Path }

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$timestamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$outFile = Join-Path $backupDir "d_metran_erp_$timestamp.sql"
$logFile = Join-Path $backupDir 'backup.log'

$env:PGPASSWORD = $dbPass

Write-Host "Backing up $dbName to $outFile ..."

& $pgDumpExe -h $dbHost -p $dbPort -U $dbUser -d $dbName -F p -f $outFile

if ($LASTEXITCODE -ne 0) {
  "$(Get-Date -Format o) FAILED backup exit=$LASTEXITCODE" | Add-Content $logFile
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  exit $LASTEXITCODE
}

$sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
"$(Get-Date -Format o) OK $outFile (${sizeMb} MB)" | Add-Content $logFile
Write-Host "Backup OK (${sizeMb} MB)"

# Keep last 30 backups
Get-ChildItem $backupDir -Filter 'd_metran_erp_*.sql' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 |
  ForEach-Object {
    Write-Host "Removing old backup: $($_.Name)"
    Remove-Item $_.FullName -Force
  }

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
