# Registers a Windows Task Scheduler job to start ERP when you log in.
# Run once:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-erp-autostart.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $projectRoot 'start-erp-server.bat'
$taskName = 'D METRAN ERP Server'

if (-not (Test-Path $batPath)) {
  Write-Error "Not found: $batPath"
}

$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Delay 60s after logon so PostgreSQL Windows service can start first
$trigger.Delay = 'PT60S'

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "OK: Scheduled task '$taskName' created."
Write-Host "  Runs: at Windows logon (+ 60s delay)"
Write-Host "  Script: $batPath"
Write-Host ""
Write-Host "To remove: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Host "To test now: Start-ScheduledTask -TaskName '$taskName'"
