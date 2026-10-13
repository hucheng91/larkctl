# Running larkctl on Windows in the background

## Option A: Task Scheduler (built in)
Run in PowerShell (as your normal user):
```powershell
$npx = (Get-Command npx.cmd).Source
$action  = New-ScheduledTaskAction -Execute $npx -Argument "-y larkctl start"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$set     = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName larkctl -Action $action -Trigger $trigger -Settings $set
Start-ScheduledTask larkctl
```
Running "at log on" as your user keeps access to your desktop (screenshots) and your Codex/Claude logins.

## Option B: NSSM (Windows service)
```powershell
nssm install larkctl (Get-Command node).Source "$env:APPDATA\npm\node_modules\larkctl\dist\cli.js" start
nssm set larkctl AppEnvironmentExtra LARKCTL_CONFIG_DIR=$env:APPDATA\larkctl
nssm set larkctl ObjectName .\YourUser YourPassword
nssm start larkctl
```
(Install globally first: `npm i -g larkctl`.) Services run in session 0, so `/screenshot` will not see your desktop.

## Option C
`npx larkctl start --daemon` (detached process, stops at logoff), `npx larkctl stop` to stop it.
