function Find-PrayerNodeRuntime {
    $candidates = @()
    $runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes'
    if (Test-Path -LiteralPath $runtimeRoot) {
        $candidates += Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\dependencies\\node\\bin\\node\.exe$' } |
            Sort-Object @{ Expression = { if ($_.FullName -match '\.previous-') { 1 } else { 0 } } }, @{ Expression = 'LastWriteTime'; Descending = $true }
    }
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { $candidates += Get-Item -LiteralPath $systemNode.Source }
    $node = $candidates | Where-Object {
        if ($_.FullName -match '^(.*\\dependencies\\node)\\bin\\node\.exe$') {
            (Test-Path -LiteralPath (Join-Path $Matches[1] 'node_modules\playwright')) -and
            (Test-Path -LiteralPath (Join-Path $Matches[1] 'node_modules\pdf-lib'))
        } else { $true }
    } | Select-Object -First 1
    if (-not $node) {
        throw '没有找到运行环境。请先安装并启动一次 Codex 桌面版，然后重试。'
    }
    $nodePath = $null
    if ($node.FullName -match '^(.*\\dependencies\\node)\\bin\\node\.exe$') {
        $nodePath = Join-Path $Matches[1] 'node_modules'
    }
    [PSCustomObject]@{ Node = $node.FullName; NodePath = $nodePath }
}

function Find-PrayerBusinessRoot {
    param([string]$SavedRoot)
    $checks = @()
    if ($SavedRoot) { $checks += $SavedRoot }
    foreach ($drive in Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue) {
        # 迁移后系统可能仍保留已移除的盘符。先验证当前盘符真实可用，
        # 再构造候选路径，避免 Join-Path 在不存在的盘符上直接终止 GUI。
        try {
            if (-not (Test-Path -LiteralPath $drive.Root -PathType Container -ErrorAction Stop)) { continue }
            $checks += [System.IO.Path]::Combine([string]$drive.Root, 'Work\@@圣堂祈福2026\@每日福单')
            $checks += [System.IO.Path]::Combine([string]$drive.Root, '@@圣堂祈福2026\@每日福单')
        } catch {
            continue
        }
    }
    foreach ($candidate in $checks | Select-Object -Unique) {
        if ([string]::IsNullOrWhiteSpace([string]$candidate)) { continue }
        try {
            if (Test-Path -LiteralPath $candidate -PathType Container -ErrorAction Stop) {
                return (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
            }
        } catch {
            # 旧电脑保存的 E:/F: 等失效盘符属于正常迁移场景，静默跳过。
            continue
        }
        try {
            $nested = [System.IO.Path]::Combine([string]$candidate, '@每日福单')
            if (Test-Path -LiteralPath $nested -PathType Container -ErrorAction Stop) {
                return (Resolve-Path -LiteralPath $nested -ErrorAction Stop).Path
            }
        } catch {
            continue
        }
    }
    return $null
}
