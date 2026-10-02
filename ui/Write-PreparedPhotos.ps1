param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-BytesHash([byte[]]$bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function Save-CommitJournal {
    $temporary = $plan.journalPath + '.tmp'
    [IO.File]::WriteAllText($temporary,($plan | ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($plan.journalPath)) { [IO.File]::Replace($temporary,$plan.journalPath,($plan.journalPath + '.previous')) }
    else { [IO.File]::Move($temporary,$plan.journalPath) }
}
try {
    foreach ($entry in $plan.files) {
        if ($entry.status -eq 'verified') { continue }
        $output = [IO.File]::ReadAllBytes($entry.prepared)
        if ((Get-BytesHash $output) -ne $entry.afterSha256) { throw '压缩成品在保存前发生变化，已停止。' }
        $stream = $null
        for ($attempt=1; $attempt -le $plan.attempts; $attempt++) {
            try {
                # Request read/write access but share READ only. Compatible
                # readers may stay open; competing writes/deletes cannot race
                # our hash check, backup, save, or immediate error rollback.
                $stream = [IO.File]::Open($entry.source,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
                break
            } catch [IO.IOException] {
                $code = $_.Exception.HResult -band 65535
                if ($code -notin @(32,33) -or $attempt -eq $plan.attempts) { throw "$([IO.Path]::GetFileName($entry.source)) 被占用，原目录尚未压缩；已停止有限重试。$($_.Exception.Message)" }
                Start-Sleep -Milliseconds $plan.delayMs
            }
        }
        try {
            $memory = New-Object IO.MemoryStream
            try { $stream.CopyTo($memory); $original = $memory.ToArray() } finally { $memory.Dispose() }
            $currentHash = Get-BytesHash $original
            if ($currentHash -eq $entry.afterSha256) { $entry.status='verified'; Save-CommitJournal; continue }
            if ($currentHash -ne $entry.beforeSha256) { throw '原图在保存前发生变化，已停止；不会覆盖同步产生的新照片。' }
            $backup = [IO.File]::Open($entry.backup,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
            try { $backup.Write($original,0,$original.Length); $backup.Flush($true) } finally { $backup.Dispose() }
            if ((Get-BytesHash ([IO.File]::ReadAllBytes($entry.backup))) -ne $entry.beforeSha256) { throw '原图备份校验失败，未写回原目录。' }
            $entry.status='writing'
            Save-CommitJournal
            try {
                $stream.Position=0
                $stream.Write($output,0,$output.Length)
                $stream.SetLength($output.Length)
                $stream.Flush($true)
                $stream.Position=0
                $memory = New-Object IO.MemoryStream
                try { $stream.CopyTo($memory); $written=$memory.ToArray() } finally { $memory.Dispose() }
                if ((Get-BytesHash $written) -ne $entry.afterSha256) { throw '原目录保存后的哈希不一致。' }
                $entry.status='verified'
                Save-CommitJournal
            } catch {
                $saveFailure = $_
                try {
                    $stream.Position=0
                    $stream.Write($original,0,$original.Length)
                    $stream.SetLength($original.Length)
                    $stream.Flush($true)
                    $entry.status='restored'
                    Save-CommitJournal
                } catch { throw "原目录写入失败且自动恢复失败；完整原图备份已保留在 $($entry.backup)" }
                throw $saveFailure
            }
        } finally { if ($stream) { $stream.Dispose() } }
    }
    [Console]::WriteLine('SOURCE_COMMIT_OK')
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
