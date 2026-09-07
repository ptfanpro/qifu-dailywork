param([switch]$PrintRoot)

function Get-PrayerLocalStateRoot {
    $localBase = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($localBase) -or $localBase.StartsWith('\\')) {
        throw '无法确定本机非同步运行目录，已停止；不会退回程序目录或 NAS。'
    }
    $target = [IO.Path]::GetFullPath((Join-Path $localBase 'PrayerDailyRunner\祈福运行数据'))
    $probe = $target
    while ($probe) {
        if (Test-Path -LiteralPath $probe) {
            $entry = Get-Item -Force -LiteralPath $probe
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw '本机运行目录经过同步占位符或重解析点，已停止；请使用非同步的 Windows 用户目录。'
            }
        }
        $parent = Split-Path -Parent $probe
        if ($parent -eq $probe) { break }
        $probe = $parent
    }
    return $target
}
if ($PrintRoot) {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    Get-PrayerLocalStateRoot
}
