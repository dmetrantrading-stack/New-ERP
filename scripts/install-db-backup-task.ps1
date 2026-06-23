# Registers daily database backup at 11:00 PM
# Run once:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-db-backup-task.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot 'backup-database.ps1'
$taskName = 'D METRAN ERP Database Backup'

if (-not (Test-Path $scriptPath)) {
  Write-Error "Not found: $scriptPath"
}

$psExe = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $psExe -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '11:00PM'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "OK: Scheduled task '$taskName' created."
Write-Host "  Runs: every day at 11:00 PM"
Write-Host "  Backups folder: $projectRoot\backups"
Write-Host ""
Write-Host "Test backup now: powershell -ExecutionPolicy Bypass -File `"$scriptPath`""
Write-Host "Remove task: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
