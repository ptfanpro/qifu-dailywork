$ErrorActionPreference = 'Stop'
$env:PRAYER_UI_SMOKE_TEST = 'yes'
$uiSmokeRoot = Join-Path ([IO.Path]::GetTempPath()) ('prayer-ui-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $uiSmokeRoot -Force | Out-Null
$env:PRAYER_UI_SMOKE_ROOT = $uiSmokeRoot
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ui\PrayerAssistant.ps1')
if (-not $settingsPath.StartsWith($uiSmokeRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'UI test loaded real settings.' }

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
Assert-Equal $photoGroup.Text '照片业务（人工编号后，软件压缩并上传）' '照片界面没有切换到人工编号模式'
Assert-Equal $photoMainButton.Text '一键处理照片' '照片主按钮名称不正确'
Assert-Equal $pdfMainButton.Text '一键处理 PDF' 'PDF 主按钮名称不正确'
if ($null -ne $photoRefreshButton -or $null -ne $pdfRefreshButton) { throw '照片或 PDF 主区域仍保留重新检查按钮' }
if ($null -ne $pendingPhotoPicker) { throw '历史未解决业务仍要求选择日期' }
Assert-Equal $pendingProcessButton.Text '检查历史未解决业务' '历史线上检查按钮名称不正确'
Assert-Equal $manualPhotoPrepare.Text '人工编号照片压缩' '高级工具仍然显示自动识别入口'
Assert-Equal $refreshLocalButton.Text '刷新照片和PDF状态' '缺少无需重启的本地状态刷新入口'
Assert-Equal $script:availabilityTimer.Interval 15000 '照片和 PDF 时间状态没有定时检查'
Assert-Equal (Test-PhotoAutoAdvance 'photo-scenes' 'photo-scenes' 2) $false '同一步骤不得自动无限重试'
Assert-Equal (Test-PhotoAutoAdvance 'photo-upload' 'photo-scenes' 4) $false '照片自动续跑必须有次数上限'
Assert-Equal (Test-PhotoAutoAdvance 'photo-upload' 'photo-scenes' 2) $true '正常上传后仍应自动进入场景步骤'

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
    $manualInbox = Join-Path $testRoot '8月10日\1'
    New-Item -ItemType Directory -Force -Path $manualInbox | Out-Null
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') ([ordered]@{
        businessDate='2026-08-10';manualNumberedMode=$true;blessingReady=$false;fileSetHash='empty-hash';
        counts=[ordered]@{allImages=0;blessing=0;lampScene=0;waterScene=0};inputFileHashes=[ordered]@{}
    })
    Refresh-PhotoCard
    Assert-Equal $photoMainButton.Enabled $false '照片目录为空时应显示等待状态'
    $manualPhoto = Join-Path $manualInbox '101.jpg'
    [System.IO.File]::WriteAllBytes($manualPhoto,[byte[]](1,2,3))
    Refresh-LocalAvailability
    Assert-Equal $script:photoNextAction 'photo-manual-prepare' '放入照片后应自动解锁照片主按钮'
    Assert-Equal $photoMainButton.Enabled $true '放入照片后仍不能点击照片主按钮'
    $savedBeijingHour = (Get-Command Get-BeijingHour).ScriptBlock
    function Get-BeijingHour { return 9 }
    Refresh-LocalAvailability
    Assert-Equal $pdfMainButton.Enabled $false '北京时间 10 点前 PDF 按钮应保持禁用'
    function Get-BeijingHour { return 10 }
    Refresh-LocalAvailability
    Assert-Equal $pdfMainButton.Enabled $true '北京时间到 10 点后应无需重启解锁 PDF 按钮'
    Set-Item Function:Get-BeijingHour $savedBeijingHour
    $manualHash = (Get-FileHash -LiteralPath $manualPhoto -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') ([ordered]@{
        businessDate='2026-08-10';manualNumberedMode=$true;blessingReady=$false;fileSetHash='manual-hash';
        counts=[ordered]@{allImages=1;blessing=1;lampScene=0;waterScene=0;missingBlessing=0;extraBlessing=0};
        blockingErrors=@('101.jpg：尺寸必须为 1800×1350');
        inputFileHashes=[ordered]@{'101.jpg'=$manualHash}
    })
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-manual-prepare' '人工编号照片不合规格时应允许先压缩'
    Assert-Equal $photoMainButton.Enabled $true '人工编号照片待压缩时主按钮不能被历史成品规则禁用'
    Remove-Item -LiteralPath $manualInbox -Recurse -Force
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

    $manifest.blessingReady = $false
    $manifest.blockingErrors = @('微信图片_损坏.jpg：图片无法读取')
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    Write-TestJson (Join-Path $photoRunDir 'ui-workflow-state.json') ([ordered]@{state='running';lastAction='photo-manual-prepare'})
    Refresh-PhotoCard
    if ($photoStatus.Text -notmatch '微信图片_损坏\.jpg：图片无法读取') { throw "照片卡片没有显示具体失败文件名和原因：$($photoStatus.Text)" }
    $manifest.blessingReady = $true
    $manifest.blockingErrors = @()
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest

    Write-TestJson (Join-Path $photoRunDir 'photo-upload-receipt.json') ([ordered]@{complete=$true;fileSetHash='hash-1';uploadedCount=15})
    Write-TestJson (Join-Path $photoRunDir 'ui-workflow-state.json') ([ordered]@{state='failed';lastAction='photo-scenes'})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-scenes' '福单上传完成后应从场景图继续'
    if ($photoStatus.Text -notmatch '上次中断在场景图与牌位批量完成') { throw '没有显示照片中断环节' }

    $manifest.counts.missingBlessing = 2
    $manifest.counts.unexpected = 2
    $manifest.photoAvailability = [ordered]@{
        summary='未匹配的 PDF 编号：702、703。以下现有文件尚未识别或确认：微信图片_A.jpg、微信图片_B.jpg。它们可能对应上述编号，暂不能判定真正缺图；请先逐张核对。'
    }
    $manifest.manualIssues = @('以下照片没有识别成福单编号，也没有确认成供灯或供水场景：微信图片_A.jpg、微信图片_B.jpg。')
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-scenes' '缺图批次上传现有照片后应先处理已上传订单'
    if ($photoStatus.Text -notmatch '只处理福单已上传的订单状态') { throw '缺图分批完成状态提示不正确' }
    if ($photoStatus.Text -notmatch '未匹配的 PDF 编号：702、703' -or $photoStatus.Text -notmatch '微信图片_A\.jpg、微信图片_B\.jpg' -or $photoStatus.Text -match '张待补|仍待补 2') { throw '照片卡片没有列明未匹配编号和未识别文件' }
    Write-TestJson (Join-Path $photoRunDir 'scene-upload-receipt.json') ([ordered]@{complete=$false;partialComplete=$true;fileSetHash='hash-1';completedOrderCount=150;tabletCompletionVerified=$true})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-manual-prepare' '现有已上传订单分批完成后应等待人工编号补图'
    if ($photoStatus.Text -notmatch '150 条订单已分批完成') { throw '缺图分批完成回执没有显示' }
    if ($photoStatus.Text -notmatch '微信图片_A\.jpg、微信图片_B\.jpg') { throw '分批完成后的提示没有列出待识别文件' }
    $manifest.counts.missingBlessing = 0
    $manifest.counts.unexpected = 0
    $manifest.photoAvailability = $null
    $manifest.manualIssues = @()
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    $manifest.manualNumberedMode = $true
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    Write-TestJson (Join-Path $photoRunDir 'scene-upload-receipt.json') ([ordered]@{complete=$false;partialComplete=$true;fileSetHash='hash-1';completedOrderCount=142;onlineNotUploadedCount=142;tabletCompletionVerified=$true})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-manual-prepare' '人工编号模式线上仍缺图时应停下等待新照片'
    Assert-Equal $photoMainButton.Enabled $false '没有新增照片时不得反复启动场景完成'
    if ($photoStatus.Text -notmatch '142 条') { throw '等待补图状态没有说明线上未上传订单数' }
    $savedStartRunner = (Get-Command Start-Runner).ScriptBlock
    $script:testRunnerCalls = 0
    function Start-Runner { $script:testRunnerCalls += 1 }
    $script:activeAction = 'photo-scenes'
    $script:activeFlow = 'photo'
    Complete-Runner 0
    Assert-Equal $script:testRunnerCalls 0 '部分完成回执不得再次自动启动场景步骤'
    Assert-Equal (Read-JsonFile (Join-Path $photoRunDir 'ui-workflow-state.json')).state 'waiting-supplement' '部分完成后应保存等待补图状态'
    Set-Item Function:Start-Runner $savedStartRunner

    Write-TestJson (Join-Path $photoRunDir 'photo-online-closure.json') ([ordered]@{
        schemaVersion=1;businessDate='2026-08-10';checkedAt='2026-08-31T02:00:00Z';complete=$true;
        onlineNotUploadedCount=0;pendingRegularCount=0;pendingTabletCount=0;onlineScopeCount=164;onlineUnfinishedCount=0;readOnly=$true;platformModified=$false
    })
    Refresh-PhotoCard
    if (-not [string]::IsNullOrWhiteSpace($script:photoNextAction)) { throw '线上零待办闭环后不应再安排本地旧断点动作' }
    Assert-Equal $photoProgress.Value 100 '线上闭环复核后的照片进度错误'
    Assert-Equal $photoMainButton.Enabled $false '线上闭环复核后主按钮应禁用'
    if ($photoStatus.Text -notmatch '线上闭环已复核') { throw '没有显示线上闭环复核结果' }
    Remove-Item -LiteralPath (Join-Path $photoRunDir 'photo-online-closure.json') -Force

    Write-TestJson (Join-Path $photoRunDir 'scene-upload-receipt.json') ([ordered]@{complete=$true;partialComplete=$false;fileSetHash='hash-1';completedOrderCount=164;tabletCompletionVerified=$true})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-online-recheck' '旧场景回执没有线上核查凭据时必须允许重新核查'
    Assert-Equal $photoMainButton.Enabled $true '旧场景回执不应禁用照片主按钮'
    if ($photoStatus.Text -notmatch '线上未核实') { throw '旧场景回执不应显示线上已完成' }
    Write-TestJson (Join-Path $photoRunDir 'photo-online-closure.json') ([ordered]@{businessDate='2026-08-10';complete=$false;onlineScopeCount=449;onlineUnfinishedCount=449;historicalOrderCount=449})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-scenes' '线上仍为祈福中的订单应能继续处理'
    if ($photoStatus.Text -notmatch '449 条祈福未完成') { throw '线上未完成数没有显示在照片卡片' }
    Write-TestJson (Join-Path $photoRunDir 'photo-online-closure.json') ([ordered]@{businessDate='2026-08-10';complete=$false;onlineScopeCount=0;onlineUnfinishedCount=0;historicalOrderCount=184})
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-online-recheck' '线上当前查询无订单时不能直接续跑'
    if ($photoStatus.Text -notmatch '本地旧清单有 184 条订单') { throw '空查询没有说明旧订单与线上不一致' }
    Remove-Item -LiteralPath (Join-Path $photoRunDir 'photo-online-closure.json') -Force
    $manifest.manualNumberedMode = $true
    $manifest.inputFileHashes = [ordered]@{'101.jpg'=$manualHash}
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    New-Item -ItemType Directory -Force -Path $manualInbox | Out-Null
    [System.IO.File]::WriteAllBytes($manualPhoto,[byte[]](1,2,3))
    $newNumberedPhoto = Join-Path $manualInbox '102.jpg'
    [System.IO.File]::WriteAllBytes($newNumberedPhoto,[byte[]](4,5,6))
    Refresh-LocalAvailability
    Assert-Equal $script:photoNextAction 'photo-manual-prepare' '已有完成回执后新增纯数字照片仍应先重新预检'
    Remove-Item -LiteralPath $newNumberedPhoto -Force
    $manifest.counts.unexpected = 1
    $manifest.errors = @('发现新增原图')
    $manifest.blockingErrors = @('微信补图.jpg：尚未识别编号或场景类别')
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest
    Refresh-PhotoCard
    Assert-Equal $script:photoNextAction 'photo-manual-prepare' '历史日期完成后又出现新增原图时不能被旧终态回执掩盖'
    $manifest.counts.unexpected = 0
    $manifest.errors = @()
    $manifest.blockingErrors = @()
    Write-TestJson (Join-Path $photoRunDir 'photo-manifest.json') $manifest

    Refresh-PendingPhotoBar
    Assert-Equal $pendingProcessButton.Enabled $true '历史线上检查按钮应可直接使用'
    if ($pendingStatus.Text -notmatch '点击按钮查询') { throw '首次使用没有显示历史线上检查说明' }
    $historyDir = Join-Path $script:localStateRoot 'historical-backlog'
    Write-TestJson (Join-Path $historyDir 'latest.json') ([ordered]@{
        checkedAt='2026-08-11T02:00:00Z'; complete=$false; totalCount=4;
        pendingPrayerCount=2; prayingWithoutPhotoCount=2; businessDates=@('2026-08-07','2026-08-08');
        range=[ordered]@{endExclusive='2026-08-11';todayExcluded=$true};readOnly=$true;platformModified=$false
    })
    Refresh-PendingPhotoBar
    if ($pendingStatus.Text -notmatch '发现 4 条' -or $pendingStatus.Text -notmatch '待祈福 2 条' -or $pendingStatus.Text -notmatch '祈福中未上传照片 2 条') { throw '历史线上检查结果没有显示两类未解决业务' }
    Assert-Equal $photoDate.Value.ToString('yyyy-MM-dd') '2026-08-10' '历史线上检查不应改变照片业务日期'

    $pdfFolder = Join-Path $testRoot '8月11日'
    New-Item -ItemType Directory -Force -Path $pdfFolder | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $pdfFolder '811红纸1.pdf'),[byte[]](37,80,68,70,45))
    $pdfRunDir = Join-Path (Join-Path $script:localStateRoot 'workdays') '2026-08-11'
    Write-TestJson (Join-Path $pdfRunDir 'run-state.json') ([ordered]@{pdfVerified=$true;stateChanged=$true;orderCount=170})
    Assert-Equal (Test-NeedAutomaticPdfInspect) $false 'PDF 已完成时启动初始化不应再次登录并锁住照片按钮'
    Refresh-PdfCard
    Assert-Equal $script:pdfWorkflowComplete $true 'PDF 完成状态未识别'
    Assert-Equal $pdfProgress.Value 100 'PDF 完成进度错误'
    Assert-Equal $pdfMainButton.Enabled $false 'PDF 完成后主按钮应禁用'

    Write-TestJson (Join-Path $pdfRunDir 'online-verification.json') ([ordered]@{blessingPendingCount=1;tabletPendingCount=0;complete=$false})
    Refresh-PdfCard
    Assert-Equal $script:pdfNextAction 'export' '同日新增待祈福应进入增量导出'
    Assert-Equal $pdfMainButton.Text '一键处理 PDF' 'PDF 主按钮名称在同日补单状态下发生变化'
    Remove-Item -LiteralPath (Join-Path $pdfRunDir 'online-verification.json') -Force

    Write-TestJson (Join-Path $pdfRunDir 'renewal-online-verification.json') ([ordered]@{pendingCount=2;complete=$false})
    Refresh-PdfCard
    Assert-Equal $script:pdfNextAction 'export' '发现未处理续费后应继续 PDF 导出流程'
    Assert-Equal $pdfMainButton.Text '一键处理 PDF' 'PDF 主按钮名称在续费状态下发生变化'

    Write-TestJson (Join-Path $pdfRunDir 'renewal-state.json') ([ordered]@{pdfVerified=$true;stateChanged=$false;orderCount=2;orderIdHash='renew-hash'})
    Refresh-PdfCard
    Assert-Equal $script:pdfNextAction 'renewal-state-change' '续费自动状态变更中断后应进入补做阶段'
    Assert-Equal $pdfMainButton.Text '一键处理 PDF' 'PDF 主按钮名称在状态补做阶段发生变化'

    'UI state tests passed'
} finally {
    $script:running = $true
    $rootBox.Text = $originalRoot
    $script:localStateRoot = $originalLocalStateRoot
    $script:running = $false
    if (-not [string]::IsNullOrWhiteSpace($originalRoot) -and (Test-Path -LiteralPath $originalRoot)) { Save-Settings }
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:PRAYER_UI_SMOKE_TEST -ErrorAction SilentlyContinue
    Remove-Item Env:PRAYER_UI_SMOKE_ROOT -ErrorAction SilentlyContinue
    $form.Dispose()
    Remove-Item -LiteralPath $uiSmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
