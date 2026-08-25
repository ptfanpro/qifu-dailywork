function Write-PrayerAtomicJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value,
        [ValidateRange(1, 100)][int]$MaxAttempts = 8,
        [ValidateRange(0, 5000)][int]$RetryDelayMilliseconds = 125
    )

    $directory = Split-Path -Parent $Path
    if ([string]::IsNullOrWhiteSpace($directory)) {
        throw "配置文件路径缺少父目录：$Path"
    }
    New-Item -ItemType Directory -Force -Path $directory | Out-Null

    $leaf = Split-Path -Leaf $Path
    $writeId = [Guid]::NewGuid().ToString('N')
    $tempPath = Join-Path $directory ('.{0}.{1}.{2}.tmp' -f $leaf,$PID,$writeId)
    $backupPath = Join-Path $directory ('.{0}.{1}.{2}.bak' -f $leaf,$PID,$writeId)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $json = $Value | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($tempPath, $json + [Environment]::NewLine, $utf8NoBom)

    $lastError = $null
    try {
        for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
            try {
                if (Test-Path -LiteralPath $Path) {
                    [System.IO.File]::Replace($tempPath, $Path, $backupPath, $true)
                    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
                } else {
                    [System.IO.File]::Move($tempPath, $Path)
                }
                return
            } catch [System.IO.IOException] {
                $lastError = $_.Exception
            } catch [System.UnauthorizedAccessException] {
                $lastError = $_.Exception
            }

            if ($attempt -lt $MaxAttempts -and $RetryDelayMilliseconds -gt 0) {
                Start-Sleep -Milliseconds $RetryDelayMilliseconds
            }
        }

        throw [System.IO.IOException]::new(
            "配置文件暂时被其他程序占用，已重试 $MaxAttempts 次：$Path",
            $lastError
        )
    } finally {
        if (Test-Path -LiteralPath $tempPath) {
            Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        }
    }
}
