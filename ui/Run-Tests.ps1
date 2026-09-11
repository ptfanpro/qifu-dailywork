$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Find-Runtime.ps1')
$missingDrive = @('Z','Y','X','W','V','U','T','S','R','Q','P','O','N','M','L','K','J','I','H','G','F','E') |
    Where-Object { -not (Get-PSDrive -Name $_ -PSProvider FileSystem -ErrorAction SilentlyContinue) } |
    Select-Object -First 1
if ($missingDrive) {
    $invalidSavedRoot = "${missingDrive}:\Work\@@圣堂祈福2026\@每日福单"
    try {
        $resolvedBusinessRoot = Find-PrayerBusinessRoot -SavedRoot $invalidSavedRoot
    } catch {
        throw "失效盘符回归失败：$invalidSavedRoot 不应导致启动异常。$($_.Exception.Message)"
    }
    if ($resolvedBusinessRoot -and -not (Test-Path -LiteralPath $resolvedBusinessRoot -PathType Container)) {
        throw "失效盘符回归失败：返回了不存在的业务目录 $resolvedBusinessRoot"
    }
    Write-Output "失效盘符启动回归通过：$invalidSavedRoot"
}
$runtime = Find-PrayerNodeRuntime
if ($runtime.NodePath) { $env:NODE_PATH = $runtime.NodePath }
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $root 'tests\runtime-location-tests.ps1')
& (Join-Path $root 'tests\process-safety-tests.ps1')
& (Join-Path $root 'tests\ui-state-tests.ps1')
& $runtime.Node (Join-Path $root 'tests\run-tests.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $runtime.Node (Join-Path $root 'tests\windows-ocr-long-path-integration.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $runtime.Node (Join-Path $root 'tests\experiments\chinese-reader-smoke.mjs') (Join-Path $root 'models\paddleocr-zh-v4')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $runtime.Node (Join-Path $root 'tests\server-code-model-smoke.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $runtime.Node (Join-Path $root 'tests\experiments\detection-cache-integration.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $runtime.Node (Join-Path $root 'tests\detected-observation-cache-integration.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $runtime.Node (Join-Path $root 'tests\english-model-cache-integration.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $runtime.Node (Join-Path $root 'tests\list-query-browser.mjs')
exit $LASTEXITCODE
