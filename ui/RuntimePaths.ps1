param([switch]$PrintRoot)

function Assert-PrayerPhysicalStatePath([string]$path) {
    $fullPath = [IO.Path]::GetFullPath($path)
    if ($fullPath.StartsWith('\\')) { throw '本机运行目录不能位于网络共享。' }
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($fullPath))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw '本机运行目录必须位于本机固定磁盘。' }
    $probe = $fullPath
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
    return $fullPath
}

function Get-PrayerLocalStateRoot {
    $localBase = [Environment]::GetFolderPath('LocalApplicationData')
    if ([string]::IsNullOrWhiteSpace($localBase) -or $localBase.StartsWith('\\')) {
        throw '无法确定本机非同步运行目录，已停止；不会退回程序目录或 NAS。'
    }
    [void](Assert-PrayerPhysicalStatePath $localBase)
    $runnerDir = Join-Path $localBase 'PrayerDailyRunner'
    if (Test-Path -LiteralPath $runnerDir) {
        $runnerEntry = Get-Item -Force -LiteralPath $runnerDir
        if (($runnerEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            if ($runnerEntry.LinkType -ne 'Junction' -or -not $runnerEntry.Target) {
                throw '本机运行目录经过未授权的重解析点，已停止。'
            }
            # 迁移后的本机目录可保留 LocalAppData 兼容入口。
            # 只使用固定磁盘上的物理目标，不通过联接读写运行态。
            $physicalRunnerDir = Assert-PrayerPhysicalStatePath ([string](@($runnerEntry.Target)[0]))
            if ((Split-Path -Leaf $physicalRunnerDir) -ne 'PrayerDailyRunner') {
                throw '本机运行目录联接的目标名称不正确，已停止。'
            }
            return (Assert-PrayerPhysicalStatePath (Join-Path $physicalRunnerDir '祈福运行数据'))
        }
    }
    return (Assert-PrayerPhysicalStatePath (Join-Path $runnerDir '祈福运行数据'))
}
if ($PrintRoot) {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    Get-PrayerLocalStateRoot
}
