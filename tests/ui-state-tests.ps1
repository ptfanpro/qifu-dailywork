$ErrorActionPreference = 'Stop'
$env:PRAYER_UI_SMOKE_TEST = 'yes'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ui\PrayerAssistant.ps1')

function Assert-Equal($actual, $expected, [string]$message) {
    if ($actual -ne $expected) { throw "$message；预期=$expected，实际=$actual" }
}
function Write-TestJson([string]$file, $value) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    $value | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $file
}

$testBeijingTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById('China Standard Time')
$testBeijingToday = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow,$testBeijingTimeZone).Date
Assert-Equal $photoDate.Value.ToString('yyyy-MM-dd') $testBeijingToday.AddDays(-1).ToString('yyyy-MM-dd') '软件启动时照片业务日期必须固定为北京时间昨天'
Assert-Equal $pdfDate.Value.ToString('yyyy-MM-dd') $testBeijingToday.ToString('yyyy-MM-dd') '软件启动时 PDF 业务日期必须固定为北京时间今天'

$originalRoot = $rootBox.Text
$originalLocalStateRoot = $script:localStateRoot
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("prayer-ui-state-{0}" -f [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
try {
    $script:running = $true
    $rootBox.Text = $testRoot
    $script:localStateRoot = Join-Path $testRoot '祈福运行数据'
    $photoDate.Value = [DateTime]'2026-08-10'
    $pdfDate.Value = [DateTime]'2026-08-11'
    $script:running = $false

    $photoRunDir = Join-Path (Join-Path (Join-Path $script:localStateRoot 'workdays') '2026-08-10') 'photos'
    $manifest = [ordered]@{
        businessDate = '2026-08-10'
        blessingReady = $true
        fileSetHash = 'hash-1'
        counts = [ordered]@{ allImages=18; blessing=15; lampScene=2; waterScene=1; pdfPages=15 }
        errors = @()
        warnings = @()
    }
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-upload' '预检完成后应从福单图上传继续'
    Assert-Equal $photoProgress.Value 40 '福单上传前进度错误'

    Write-TestJson (Join-Path $photoRunDir 'photo-upload-receipt.json') ([ordered]@{complete=$true;fileSetHash='hash-1';uploadedCount=15})
    Write-TestJson (Join-Path $photoRunDir 'ui-workflow-state.json') ([ordered]@{state='failed';lastAction='photo-scenes'})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-scenes' '福单上传完成后应从场景图继续'
    if ($photoStatus.Text -notmatch '上次中断在场景图与牌位批量完成') { throw '没有显示照片中断环节' }

    $manifest.counts.missingBlessing = 2
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-scenes' '缺图批次上传现有照片后应先处理已上传订单'
    if ($photoStatus.Text -notmatch '只处理福单已上传的订单状态') { throw '缺图分批完成状态提示不正确' }
    Write-TestJson (Join-Path $photoRunDir 'scene-upload-receipt.json') ([ordered]@{complete=$false;partialComplete=$true;fileSetHash='hash-1';completedOrderCount=150;tabletCompletionVerified=$true})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-prepare' '现有已上传订单分批完成后应等待新增补图'
    if ($photoStatus.Text -notmatch '150 条订单已分批完成') { throw '缺图分批完成回执没有显示' }
    $manifest.counts.missingBlessing = 0
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest

    Write-TestJson (Join-Path $photoRunDir 'photo-online-closure.json') ([ordered]@{
        schemaVersion=1;businessDate='2026-08-10';checkedAt='2026-08-31T02:00:00Z';complete=$true;
        onlineNotUploadedCount=0;pendingRegularCount=0;pendingTabletCount=0;readOnly=$true;platformModified=$false
    })
    Refresh-PhotoCard
    if (-not [string]::IsNullOrWhiteSpace($script:photoNextAction)) { throw '线上零待办闭环后不应再安排本地旧断点动作' }
    Assert-Equal $photoProgress.Value 100 '线上闭环复核后的照片进度错误'
    Assert-Equal $photoMainButton.Enabled $false '线上闭环复核后主按钮应禁用'
    if ($photoStatus.Text -notmatch '线上闭环已复核') { throw '没有显示线上闭环复核结果' }
    Remove-Item -LiteralPath (Join-Path $photoRunDir 'photo-online-closure.json') -Force

    Write-TestJson (Join-Path $photoRunDir 'scene-upload-receipt.json') ([ordered]@{complete=$true;partialComplete=$false;fileSetHash='hash-1';completedOrderCount=164;tabletCompletionVerified=$true})
    Refresh-PhotoCard
    if (-not [string]::IsNullOrWhiteSpace($script:photoNextAction)) { throw '照片闭环完成后不应再安排动作' }
    Assert-Equal $photoProgress.Value 100 '照片完成进度错误'
    Assert-Equal $photoMainButton.Enabled $false '照片完成后主按钮应禁用'
    $manifest.counts.unexpected = 1
    $manifest.errors = @('发现新增原图')
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-prepare' '历史日期完成后又出现新增原图时不能被旧终态回执掩盖'
    $manifest.counts.unexpected = 0
    $manifest.errors = @()
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest

    $oldPhotoRunDir = Join-Path (Join-Path (Join-Path $script:localStateRoot 'workdays') '2026-08-07') 'photos'
    Write-TestJson (Join-Path $oldPhotoRunDir 'photo-manifest.json') ([ordered]@{businessDate='2026-08-07';counts=[ordered]@{allImages=5;missingBlessing=2}})
    Write-TestJson (Join-Path $oldPhotoRunDir 'ui-workflow-state.json') ([ordered]@{state='waiting-supplement';lastAction='photo-upload'})
    Write-TestJson (Join-Path $oldPhotoRunDir 'photo-online-closure.json') ([ordered]@{businessDate='2026-08-07';checkedAt='2026-08-31T02:00:00Z';complete=$true})
    $lateInbox = Join-Path (Join-Path $testRoot '8月8日') '1'
    New-Item -ItemType Directory -Force -Path $lateInbox | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $lateInbox '微信补图.jpg'),[byte[]](1,2,3))

    $legacyInbox = Join-Path (Join-Path $testRoot '1月26日') '1'
    New-Item -ItemType Directory -Force -Path $legacyInbox | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $legacyInbox '16.jpg'),[byte[]](1,2,3))
    [System.IO.File]::WriteAllBytes((Join-Path $legacyInbox '17.jpg'),[byte[]](1,2,3))
    [System.IO.File]::WriteAllBytes((Join-Path $legacyInbox '2.1.jpg'),[byte[]](1,2,3))
    [System.IO.File]::WriteAllBytes((Join-Path $legacyInbox '2.3.jpg'),[byte[]](1,2,3))
    [System.IO.File]::WriteAllBytes((Join-Path $legacyInbox '4.5.jpg'),[byte[]](1,2,3))
    $legacyRunDir = Join-Path (Join-Path (Join-Path $script:localStateRoot 'workdays') '2026-01-26') 'photos'
    Write-TestJson (Join-Path $legacyRunDir 'photo-manifest.json') ([ordered]@{
        businessDate='2026-01-26'; blessingReady=$false; fileSetHash='legacy-hash';
        counts=[ordered]@{allImages=5;blessing=2;lampScene=1;waterScene=0;unexpected=2;pdfPages=2;missingBlessing=0;extraBlessing=0};
        errors=@('16.jpg：文件超过 1.5 MiB','有 1 张图片尚未确认编号或场景类别')
    })
    Write-TestJson (Join-Path $legacyRunDir 'ui-workflow-state.json') ([ordered]@{state='failed';lastAction='photo-prepare'})

    $pendingDates = @(Get-PendingPhotoBusinessDates)
    Assert-Equal ($pendingDates -join ',') '2026-08-08' '线上已确认闭环的旧断点仍被错误列入待复核日期'
    Remove-Item -LiteralPath (Join-Path $oldPhotoRunDir 'photo-online-closure.json') -Force
    $pendingDates = @(Get-PendingPhotoBusinessDates)
    Assert-Equal ($pendingDates -join ',') '2026-08-07,2026-08-08' '初始化没有同时发现历史断点和其他日期新增原图'
    $script:running = $true
    $photoDate.Value = [DateTime]'2026-01-26'
    $script:running = $false
    Refresh-PhotoCard
    if ($photoStatus.Text -notmatch '仅发现历史成品') { throw '历史纯数字福单与旧小数编号场景图仍被显示为新增待办' }
    Assert-Equal $photoMainButton.Enabled $false '历史成品目录不应允许一键重新处理'
    if (-not [string]::IsNullOrWhiteSpace($script:photoNextAction)) { throw '历史成品目录不应安排照片动作' }
    $script:running = $true
    $photoDate.Value = [DateTime]'2026-08-10'
    $script:running = $false
    [void](Refresh-PendingPhotoDates)
    Assert-Equal $photoDate.Value.ToString('yyyy-MM-dd') '2026-08-10' '待办扫描不应覆盖主业务日期'
    Assert-Equal ([string]$pendingPhotoPicker.SelectedItem) '2026-08-07' '待办栏没有默认选中最早未闭环日期'
    Assert-Equal $pendingProcessButton.Enabled $true '存在待办日期时一键处理按钮应可用'
    if ($pendingStatus.Text -notmatch '2 个本机待复核日期') { throw '待办栏没有显示待复核日期数量' }

    $pdfFolder = Join-Path $testRoot '8月11日'
    New-Item -ItemType Directory -Force -Path $pdfFolder | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $pdfFolder '811红纸1.pdf'),[byte[]](37,80,68,70,45))
    $pdfRunDir = Join-Path (Join-Path $script:localStateRoot 'workdays') '2026-08-11'
    Write-TestJson (Join-Path $pdfRunDir 'run-state.json') ([ordered]@{pdfVerified=$true;stateChanged=$true;orderCount=170})
    Refresh-PdfCard
    Assert-Equal $script:pdfWorkflowComplete $true 'PDF 完成状态未识别'
    Assert-Equal $pdfProgress.Value 100 'PDF 完成进度错误'
    Assert-Equal $pdfMainButton.Enabled $false 'PDF 完成后主按钮应禁用'

    Write-TestJson (Join-Path $pdfRunDir 'online-verification.json') ([ordered]@{blessingPendingCount=1;tabletPendingCount=0;complete=$false})
    Refresh-PdfCard
    Assert-Equal $script:pdfNextAction 'export' '同日新增待祈福应进入增量导出'
    if ($pdfMainButton.Text -notmatch '同日补单') { throw '同日新增订单没有显示增量补单按钮' }
    Remove-Item -LiteralPath (Join-Path $pdfRunDir 'online-verification.json') -Force

    Write-TestJson (Join-Path $pdfRunDir 'renewal-online-verification.json') ([ordered]@{pendingCount=2;complete=$false})
    Refresh-PdfCard
    Assert-Equal $script:pdfNextAction 'export' '发现未处理续费后应继续 PDF 导出流程'
    if ($pdfMainButton.Text -notmatch '处理续费') { throw '发现续费后主按钮没有进入续费导出阶段' }

    Write-TestJson (Join-Path $pdfRunDir 'renewal-state.json') ([ordered]@{pdfVerified=$true;stateChanged=$false;orderCount=2;orderIdHash='renew-hash'})
    Refresh-PdfCard
    Assert-Equal $script:pdfNextAction 'renewal-state-change' '续费自动状态变更中断后应进入补做阶段'
    Assert-Equal $pdfMainButton.Text '继续 PDF：补做续费状态' '续费状态补做按钮文字错误'

    'UI state tests passed'
} finally {
    $script:running = $true
    $rootBox.Text = $originalRoot
    $script:localStateRoot = $originalLocalStateRoot
    $script:running = $false
    if (-not [string]::IsNullOrWhiteSpace($originalRoot) -and (Test-Path -LiteralPath $originalRoot)) { Save-Settings }
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:PRAYER_UI_SMOKE_TEST -ErrorAction SilentlyContinue
}
