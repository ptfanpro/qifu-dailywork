$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\ui\RuntimePaths.ps1')
$expected = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PrayerDailyRunner\祈福运行数据'
if ((Get-PrayerLocalStateRoot) -ne $expected) { throw '运行断点必须位于本机 LocalAppData，与程序/NAS路径无关' }
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\ui\PrayerAssistant.ps1')
if ($source -match "localStateRoot = Join-Path \(Split-Path -Parent") { throw 'UI仍在同步目录保存运行态' }
Write-Output '本机运行态路径回归通过'
