$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$target = (Get-Command powershell.exe -ErrorAction Stop).Source
$assistantScript = Join-Path $PSScriptRoot 'PrayerAssistant.ps1'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '祈福本地执行器.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.Arguments = ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $assistantScript)
$shortcut.WorkingDirectory = $appRoot
$shortcut.Description = '祈福每日工作流 V9 本地执行器'
$shortcut.Save()
Write-Host "桌面快捷方式已建立：$shortcutPath"
