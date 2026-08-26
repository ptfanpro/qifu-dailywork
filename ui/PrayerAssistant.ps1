$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'SingleInstance.ps1')
. (Join-Path $PSScriptRoot 'SettingsStore.ps1')
. (Join-Path $PSScriptRoot 'Find-Runtime.ps1')

$script:singleInstance = if ($env:PRAYER_UI_SMOKE_TEST -eq 'yes') {
    [pscustomobject]@{ Name='smoke-test'; Mutex=$null; OwnsLock=$true }
} else {
    Enter-PrayerSingleInstance
}
if (-not $script:singleInstance.OwnsLock) {
    [System.Windows.Forms.MessageBox]::Show(
        '祈福本地执行器已经在运行。请切换到现有窗口，不要重复启动。',
        '祈福本地执行器 V9.5.70',
        'OK',
        'Information'
    ) | Out-Null
    Exit-PrayerSingleInstance $script:singleInstance
    return
}

$appRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $appRoot 'data'
$script:localStateRoot = Join-Path (Split-Path -Parent $appRoot) '祈福运行数据'
$settingsPath = Join-Path $script:localStateRoot 'settings.json'
$legacySettingsPath = Join-Path $dataDir 'settings.json'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $script:localStateRoot | Out-Null

$settings = @{}
if (Test-Path -LiteralPath $settingsPath) {
    try { $settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath | ConvertFrom-Json } catch { $settings = @{} }
} elseif (Test-Path -LiteralPath $legacySettingsPath) {
    try { $settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $legacySettingsPath | ConvertFrom-Json } catch { $settings = @{} }
}
$businessRoot = Find-PrayerBusinessRoot -SavedRoot $settings.businessRoot
$today = [DateTime]::Today

function Resolve-SavedBusinessDate($savedValue, [DateTime]$fallback, [string]$branch) {
    if (-not [string]::IsNullOrWhiteSpace([string]$savedValue)) {
        try {
            $parsed = [DateTime]::ParseExact([string]$savedValue,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
            return [pscustomobject]@{ Date=$parsed; Remembered=$true; Source='settings' }
        } catch {}
    }
    # 一次性兼容旧版本：旧 settings 没有保存日期时，取最后一次真正运行过的
    # 对应业务分支，而不是回到“昨天”或最早历史失败断点。
    $workdays = Join-Path $script:localStateRoot 'workdays'
    if (Test-Path -LiteralPath $workdays -PathType Container) {
        $candidates = foreach ($workday in Get-ChildItem -LiteralPath $workdays -Directory -ErrorAction SilentlyContinue) {
            if ($workday.Name -notmatch '^\d{4}-\d{2}-\d{2}$') { continue }
            $stateFile = if ($branch -eq 'photo') {
                Join-Path $workday.FullName 'photos\ui-workflow-state.json'
            } else {
                Join-Path $workday.FullName 'ui-workflow-state.json'
            }
            if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
                [pscustomobject]@{ DateText=$workday.Name; LastWriteTime=(Get-Item -LiteralPath $stateFile).LastWriteTime }
            }
        }
        $latest = @($candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
        if ($latest.Count -gt 0) {
            try {
                $parsed = [DateTime]::ParseExact($latest[0].DateText,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
                return [pscustomobject]@{ Date=$parsed; Remembered=$true; Source='last-run' }
            } catch {}
        }
    }
    return [pscustomobject]@{ Date=$fallback; Remembered=$false; Source='fallback' }
}

$photoDateDefault = Resolve-SavedBusinessDate $settings.photoBusinessDate ($today.AddDays(-1)) 'photo'
$pdfDateDefault = Resolve-SavedBusinessDate $settings.pdfBusinessDate $today 'pdf'
$script:hasRememberedPhotoDate = [bool]$photoDateDefault.Remembered
$script:hasRememberedPdfDate = [bool]$pdfDateDefault.Remembered

$form = New-Object System.Windows.Forms.Form
$form.Text = '祈福本地执行器 V9.5.70（单张场景补图闭环版）'
$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$preferredClientHeight = [Math]::Min(760, [Math]::Max(680, $workingArea.Height - 90))
$form.ClientSize = New-Object System.Drawing.Size(880, $preferredClientHeight)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$form.MinimumSize = New-Object System.Drawing.Size(900, 800)

function Add-Label($parent, [string]$text, [int]$x, [int]$y, [int]$w = 130, [int]$h = 28) {
    $control = New-Object System.Windows.Forms.Label
    $control.Text = $text
    $control.Location = New-Object System.Drawing.Point($x,$y)
    $control.Size = New-Object System.Drawing.Size($w,$h)
    $parent.Controls.Add($control)
    return $control
}
function Add-Button($parent, [string]$text, [int]$x, [int]$y, [int]$w = 170, [int]$h = 38) {
    $control = New-Object System.Windows.Forms.Button
    $control.Text = $text
    $control.Location = New-Object System.Drawing.Point($x,$y)
    $control.Size = New-Object System.Drawing.Size($w,$h)
    $parent.Controls.Add($control)
    return $control
}
function Read-JsonFile([string]$file) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
    try { return Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json } catch { return $null }
}

Add-Label $form 'NAS 每日福单目录' 20 20 150 | Out-Null
$rootBox = New-Object System.Windows.Forms.TextBox
$rootBox.Location = New-Object System.Drawing.Point(170,16)
$rootBox.Size = New-Object System.Drawing.Size(575,30)
$rootBox.Text = $businessRoot
$form.Controls.Add($rootBox)
$browseButton = Add-Button $form '选择目录' 755 13 105 36

$photoGroup = New-Object System.Windows.Forms.GroupBox
$photoGroup.Text = '照片业务（独立执行）'
$photoGroup.Location = New-Object System.Drawing.Point(20,62)
$photoGroup.Size = New-Object System.Drawing.Size(840,145)
$form.Controls.Add($photoGroup)
Add-Label $photoGroup '业务日期' 18 30 75 | Out-Null
$photoDate = New-Object System.Windows.Forms.DateTimePicker
$photoDate.Format = 'Custom'
$photoDate.CustomFormat = 'yyyy-MM-dd'
$photoDate.Value = $photoDateDefault.Date
$photoDate.Location = New-Object System.Drawing.Point(92,27)
$photoDate.Size = New-Object System.Drawing.Size(150,30)
$photoGroup.Controls.Add($photoDate)
$photoMainButton = Add-Button $photoGroup '正在初始化照片状态…' 255 24 245 42
$photoRefreshButton = Add-Button $photoGroup '重新检测照片' 510 24 135 42
$openPhotoButton = Add-Button $photoGroup '打开照片目录' 655 24 165 42
$photoStatus = Add-Label $photoGroup '尚未初始化。' 18 76 800 28
$photoStatus.ForeColor = [System.Drawing.Color]::DimGray
$photoProgress = New-Object System.Windows.Forms.ProgressBar
$photoProgress.Location = New-Object System.Drawing.Point(18,108)
$photoProgress.Size = New-Object System.Drawing.Size(802,18)
$photoGroup.Controls.Add($photoProgress)

$pendingGroup = New-Object System.Windows.Forms.GroupBox
$pendingGroup.Text = '历史尚未闭环业务（独立处理，完成后恢复上方日期）'
$pendingGroup.Location = New-Object System.Drawing.Point(20,218)
$pendingGroup.Size = New-Object System.Drawing.Size(840,68)
$form.Controls.Add($pendingGroup)
$pendingStatus = Add-Label $pendingGroup '正在扫描尚未闭环日期……' 18 28 385 28
$pendingStatus.ForeColor = [System.Drawing.Color]::DimGray
$pendingPhotoPicker = New-Object System.Windows.Forms.ComboBox
$pendingPhotoPicker.DropDownStyle = 'DropDownList'
$pendingPhotoPicker.Location = New-Object System.Drawing.Point(415,23)
$pendingPhotoPicker.Size = New-Object System.Drawing.Size(145,30)
$pendingGroup.Controls.Add($pendingPhotoPicker)
$pendingProcessButton = Add-Button $pendingGroup '继续处理未完成项' 575 20 245 36
$pendingProcessButton.Enabled = $false

$pdfGroup = New-Object System.Windows.Forms.GroupBox
$pdfGroup.Text = 'PDF 业务（独立执行，不会自动关联照片日期）'
$pdfGroup.Location = New-Object System.Drawing.Point(20,297)
$pdfGroup.Size = New-Object System.Drawing.Size(840,145)
$form.Controls.Add($pdfGroup)
Add-Label $pdfGroup '业务日期' 18 30 75 | Out-Null
$pdfDate = New-Object System.Windows.Forms.DateTimePicker
$pdfDate.Format = 'Custom'
$pdfDate.CustomFormat = 'yyyy-MM-dd'
$pdfDate.Value = $pdfDateDefault.Date
$pdfDate.Location = New-Object System.Drawing.Point(92,27)
$pdfDate.Size = New-Object System.Drawing.Size(150,30)
$pdfGroup.Controls.Add($pdfDate)
$pdfMainButton = Add-Button $pdfGroup '正在初始化 PDF 状态…' 255 24 245 42
$pdfRefreshButton = Add-Button $pdfGroup '重新检测 PDF' 510 24 135 42
$openPdfButton = Add-Button $pdfGroup '打开 PDF 目录' 655 24 165 42
$pdfStatus = Add-Label $pdfGroup '尚未初始化。' 18 76 800 28
$pdfStatus.ForeColor = [System.Drawing.Color]::DimGray
$pdfProgress = New-Object System.Windows.Forms.ProgressBar
$pdfProgress.Location = New-Object System.Drawing.Point(18,108)
$pdfProgress.Size = New-Object System.Drawing.Size(802,18)
$pdfGroup.Controls.Add($pdfProgress)

$refreshAllButton = Add-Button $form '重新初始化全部状态' 20 457 185 38
$copyButton = Add-Button $form '复制数量通知' 215 457 160 38
$copyButton.Enabled = $false
$advancedToggle = Add-Button $form '展开高级/故障工具 ▼' 600 457 260 38

$advancedPanel = New-Object System.Windows.Forms.Panel
$advancedPanel.Location = New-Object System.Drawing.Point(20,501)
$advancedPanel.Size = New-Object System.Drawing.Size(840,92)
$advancedPanel.BorderStyle = 'FixedSingle'
$advancedPanel.Visible = $false
$form.Controls.Add($advancedPanel)
$manualPhotoPrepare = Add-Button $advancedPanel '自动处理并编号' 8 8 180 34
$manualPhotoScan = Add-Button $advancedPanel '照片：只预检' 198 8 155 34
$manualPhotoUpload = Add-Button $advancedPanel '照片：只上传福单' 363 8 175 34
$manualSceneUpload = Add-Button $advancedPanel '照片：只处理场景' 548 8 180 34
$manualPdfInspect = Add-Button $advancedPanel 'PDF：只检查' 8 49 180 34
$manualPdfExport = Add-Button $advancedPanel 'PDF：导出并完成' 198 49 195 34
$manualState = Add-Button $advancedPanel 'PDF：只补状态' 403 49 175 34

$globalStatus = Add-Label $form '正在初始化本地与线上状态，请稍候……' 20 509 840 30
$globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(20,545)
$logBox.Size = New-Object System.Drawing.Size(840,274)
$logBox.Multiline = $true
$logBox.ScrollBars = 'Vertical'
$logBox.ReadOnly = $true
$logBox.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($logBox)

function Update-ResponsiveLayout {
    $contentWidth = [Math]::Max(840, $form.ClientSize.Width - 40)
    $logTop = if ($advancedPanel.Visible) { 637 } else { 545 }
    $logHeight = [Math]::Max(100, $form.ClientSize.Height - $logTop - 20)

    $rootBox.Width = [Math]::Max(420, $form.ClientSize.Width - 305)
    $browseButton.Left = $form.ClientSize.Width - 125
    foreach ($control in @($photoGroup,$pendingGroup,$pdfGroup,$advancedPanel)) { $control.Width = $contentWidth }
    foreach ($control in @($photoProgress,$pdfProgress)) { $control.Width = [Math]::Max(500, $contentWidth - 38) }
    $advancedToggle.Left = $form.ClientSize.Width - 280
    $globalStatus.Width = $contentWidth
    $globalStatus.Top = if ($advancedPanel.Visible) { 601 } else { 509 }
    $logBox.Location = New-Object System.Drawing.Point(20,$logTop)
    $logBox.Size = New-Object System.Drawing.Size($contentWidth,$logHeight)
}

$form.Add_Resize({ Update-ResponsiveLayout })
Update-ResponsiveLayout

$script:running = $false
$script:activeAction = $null
$script:activeFlow = $null
$script:activeProcess = $null
$script:initQueue = New-Object System.Collections.Queue
$script:initFailures = New-Object System.Collections.Generic.List[string]
$script:photoNextAction = $null
$script:pendingPhotoDates = @()
$script:backlogOriginalPhotoDate = $null
$script:backlogBusinessDate = $null
$script:pdfWorkflowComplete = $false
$script:pdfNextAction = 'export'
$script:lastSummary = $null
$script:uiLogPath = Join-Path $script:localStateRoot 'ui-run.log'
$script:uiLogLength = 0
$script:processTimer = New-Object System.Windows.Forms.Timer
$script:processTimer.Interval = 250

function Save-Settings {
    $savedPhotoDate = if ($null -ne $script:backlogOriginalPhotoDate) {
        ([DateTime]$script:backlogOriginalPhotoDate).ToString('yyyy-MM-dd')
    } else {
        $photoDate.Value.ToString('yyyy-MM-dd')
    }
    Write-PrayerAtomicJson -Path $settingsPath -Value @{
        businessRoot = $rootBox.Text.Trim()
        photoBusinessDate = $savedPhotoDate
        pdfBusinessDate = $pdfDate.Value.ToString('yyyy-MM-dd')
    }
}
function Validate-Root([bool]$showMessage = $true) {
    $value = $rootBox.Text.Trim()
    if (-not (Test-Path -LiteralPath $value -PathType Container)) {
        if ($showMessage) { [System.Windows.Forms.MessageBox]::Show('请先选择有效的 @每日福单 目录。','目录无效','OK','Warning') | Out-Null }
        return $false
    }
    Save-Settings
    return $true
}
function Get-WorkdayRoot([string]$date) {
    return Join-Path (Join-Path $script:localStateRoot 'workdays') $date
}
function Get-PhotoInboxForBusinessDate([string]$date) {
    try {
        $parsed = [DateTime]::ParseExact($date,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
        return Join-Path (Join-Path $rootBox.Text.Trim() ("{0}月{1}日" -f $parsed.Month,$parsed.Day)) '1'
    } catch {
        return $null
    }
}
function Test-PhotoInboxHasNewRaw([string]$inbox) {
    if ([string]::IsNullOrWhiteSpace($inbox) -or -not (Test-Path -LiteralPath $inbox -PathType Container)) { return $false }
    return @(Get-ChildItem -LiteralPath $inbox -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Extension -match '^\.(jpg|jpeg|png)$' -and
        $_.BaseName -notmatch '^\d+$' -and
        $_.BaseName -notmatch '^\d+\.\d+$'
    }).Count -gt 0
}
function Test-PhotoRunHasResumeEvidence([string]$photoRunDir, $manifest, $checkpoint) {
    if ($manifest -and [int]$manifest.counts.missingBlessing -gt 0) { return $true }
    foreach ($receiptName in @('photo-prepare-receipt.json','photo-upload-receipt.json','scene-upload-receipt.json')) {
        if (Test-Path -LiteralPath (Join-Path $photoRunDir $receiptName) -PathType Leaf) { return $true }
    }
    if ($checkpoint) {
        if ($checkpoint.state -in @('waiting-supplement','running','stage-completed')) { return $true }
        if ($checkpoint.lastAction -in @('photo-upload','photo-scenes')) { return $true }
    }
    return $false
}
function Get-PendingPhotoBusinessDates {
    $found = New-Object 'System.Collections.Generic.HashSet[string]'
    if (-not (Validate-Root $false)) { return @() }
    $businessRootPath = $rootBox.Text.Trim()
    $reference = [DateTime]::Today
    foreach ($folder in Get-ChildItem -LiteralPath $businessRootPath -Directory -ErrorAction SilentlyContinue) {
        if ($folder.Name -notmatch '^(\d{1,2})月(\d{1,2})日$') { continue }
        $month = [int]$Matches[1]; $day = [int]$Matches[2]
        try { $date = [DateTime]::new($reference.Year,$month,$day) } catch { continue }
        if ($date -gt $reference.AddDays(31)) { $date = $date.AddYears(-1) }
        $inbox = Join-Path $folder.FullName '1'
        if (-not (Test-Path -LiteralPath $inbox -PathType Container)) { continue }
        # 自动发现只认真正的新增原图。纯数字福单和历史小数编号场景成品都不应把旧归档重新拉回待办。
        $hasRaw = Test-PhotoInboxHasNewRaw $inbox
        if ($hasRaw) { [void]$found.Add($date.ToString('yyyy-MM-dd')) }
    }
    $workdays = Join-Path $script:localStateRoot 'workdays'
    if (Test-Path -LiteralPath $workdays -PathType Container) {
        foreach ($workday in Get-ChildItem -LiteralPath $workdays -Directory -ErrorAction SilentlyContinue) {
            if ($workday.Name -notmatch '^\d{4}-\d{2}-\d{2}$') { continue }
            $photos = Join-Path $workday.FullName 'photos'
            if (-not (Test-Path -LiteralPath $photos -PathType Container)) { continue }
            $manifest = Read-JsonFile (Join-Path $photos 'photo-manifest.json')
            $checkpoint = Read-JsonFile (Join-Path $photos 'ui-workflow-state.json')
            $sceneReceipt = Read-JsonFile (Join-Path $photos 'scene-upload-receipt.json')
            $terminalComplete = $sceneReceipt -and $sceneReceipt.complete -eq $true -and $sceneReceipt.tabletCompletionVerified -eq $true
            $inbox = Get-PhotoInboxForBusinessDate $workday.Name
            $hasNewRaw = Test-PhotoInboxHasNewRaw $inbox
            $hasResumeEvidence = Test-PhotoRunHasResumeEvidence $photos $manifest $checkpoint
            # 旧版本曾把历史 2.3、4.5、5.6 等场景成品和超规格旧成品误报为 failed/photo-prepare。
            # 没有新增原图、待补编号或已提交阶段回执时，该失败断点不是可执行待办。
            if (-not $terminalComplete -and ($hasNewRaw -or $hasResumeEvidence)) { [void]$found.Add($workday.Name) }
        }
    }
    return @($found | Sort-Object)
}
function Refresh-PendingPhotoBar {
    $selected = [string]$pendingPhotoPicker.SelectedItem
    $pendingPhotoPicker.Items.Clear()
    foreach ($dateText in @($script:pendingPhotoDates)) { [void]$pendingPhotoPicker.Items.Add($dateText) }
    if (@($script:pendingPhotoDates).Count -eq 0) {
        $pendingStatus.Text = '没有发现尚未闭环的照片业务。'
        $pendingStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        $pendingProcessButton.Enabled = $false
        return
    }
    $target = if (@($script:pendingPhotoDates) -contains $selected) { $selected } else { [string]$script:pendingPhotoDates[0] }
    $pendingPhotoPicker.SelectedItem = $target
    $count = @($script:pendingPhotoDates).Count
    $preview = (@($script:pendingPhotoDates) | Select-Object -First 3) -join '、'
    if ($count -gt 3) { $preview += '……' }
    $pendingStatus.Text = "发现 $count 个未闭环日期：$preview；可独立处理未完成项"
    $pendingStatus.ForeColor = [System.Drawing.Color]::DarkOrange
    $pendingProcessButton.Enabled = -not $script:running
}
function Refresh-PendingPhotoDates {
    $script:pendingPhotoDates = @(Get-PendingPhotoBusinessDates)
    Refresh-PendingPhotoBar
    return @($script:pendingPhotoDates).Count
}
function Test-NeedAutomaticPdfInspect {
    if (-not (Validate-Root $false)) { return $false }
    $date = $pdfDate.Value.ToString('yyyy-MM-dd')
    $folder = Join-Path $rootBox.Text.Trim() ("{0}月{1}日" -f $pdfDate.Value.Month,$pdfDate.Value.Day)
    if (Test-Path -LiteralPath $folder) {
        if (@(Get-ChildItem -LiteralPath $folder -File -Filter '*.pdf' -ErrorAction SilentlyContinue).Count -gt 0) { return $true }
    }
    $runDir = Get-WorkdayRoot $date
    foreach ($name in @('run-state.json','pdf-receipt.json','online-verification.json')) {
        if (Test-Path -LiteralPath (Join-Path $runDir $name)) { return $true }
    }
    return $false
}
function Get-WorkflowStateFile([string]$branch) {
    $date = if ($branch -eq 'photo') { $photoDate.Value.ToString('yyyy-MM-dd') } else { $pdfDate.Value.ToString('yyyy-MM-dd') }
    $base = Get-WorkdayRoot $date
    if ($branch -eq 'photo') { $base = Join-Path $base 'photos' }
    return Join-Path $base 'ui-workflow-state.json'
}
function Write-WorkflowCheckpoint([string]$branch, [string]$state, [string]$action, [int]$exitCode = 0) {
    if (-not (Validate-Root $false)) { return }
    $file = Get-WorkflowStateFile $branch
    $folder = Split-Path -Parent $file
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $date = if ($branch -eq 'photo') { $photoDate.Value.ToString('yyyy-MM-dd') } else { $pdfDate.Value.ToString('yyyy-MM-dd') }
    [ordered]@{
        schemaVersion = 1
        branch = $branch
        businessDate = $date
        state = $state
        lastAction = $action
        lastExitCode = $exitCode
        updatedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $file -Encoding UTF8
}
function Get-ActionLabel([string]$action) {
    switch ($action) {
        'cleanup-local-state' { return '本机空间清理' }
        'photo-prepare' { return '照片处理与编号' }
        'photo-scan' { return '照片预检' }
        'photo-upload' { return '福单图上传' }
        'photo-scenes' { return '场景图与牌位批量完成' }
        'inspect' { return 'PDF 线上检查' }
        'export' { return 'PDF 导出、校验与状态完成' }
        'state-change' { return 'PDF 状态补处理' }
        'renewal-state-change' { return '续费改为代理已处理' }
        default { return $action }
    }
}
function Append-Log([string]$line) {
    if (-not [string]::IsNullOrWhiteSpace($line)) { $logBox.AppendText("$line`r`n") }
}
function Refresh-UiLog {
    if (-not (Test-Path -LiteralPath $script:uiLogPath)) { return }
    try {
        $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $script:uiLogPath
        if ($null -eq $content) { return }
        if ($content.Length -lt $script:uiLogLength) { $script:uiLogLength = 0 }
        if ($content.Length -gt $script:uiLogLength) {
            $newText = $content.Substring($script:uiLogLength)
            $logBox.AppendText($newText.Replace("`n","`r`n"))
            if ($newText -match '请在 Edge 窗口登录') {
                $globalStatus.Text = '等待平台登录：请在祈福专用 Edge 完成登录，软件会自动继续。'
                $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
            } elseif ($newText -match '登录成功') {
                $globalStatus.Text = '平台登录成功，正在继续当前业务……'
                $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
            }
            $script:uiLogLength = $content.Length
        }
    } catch {}
}
function Set-Running([bool]$value) {
    $script:running = $value
    $rootBox.Enabled = -not $value
    $browseButton.Enabled = -not $value
    $photoDate.Enabled = -not $value
    $pdfDate.Enabled = -not $value
    $pendingPhotoPicker.Enabled = -not $value
    $pendingProcessButton.Enabled = (-not $value -and @($script:pendingPhotoDates).Count -gt 0)
    $photoMainButton.Enabled = -not $value
    $pdfMainButton.Enabled = -not $value
    $photoRefreshButton.Enabled = -not $value
    $pdfRefreshButton.Enabled = -not $value
    $refreshAllButton.Enabled = -not $value
    foreach ($button in @($manualPhotoPrepare,$manualPhotoScan,$manualPhotoUpload,$manualSceneUpload,$manualPdfInspect,$manualPdfExport,$manualState)) { $button.Enabled = -not $value }
}
function Set-PhotoResult([string]$text, [System.Drawing.Color]$color, [int]$progress, [string]$buttonText, [bool]$enabled, [string]$nextAction) {
    $photoStatus.Text = $text
    $photoStatus.ForeColor = $color
    $photoProgress.Value = [Math]::Max(0,[Math]::Min(100,$progress))
    $photoMainButton.Text = $buttonText
    $photoMainButton.Enabled = ($enabled -and -not $script:running)
    $script:photoNextAction = $nextAction
}
function Get-LocalPageMatchStatus([string]$photoRunDir) {
    $plan = Read-JsonFile (Join-Path $photoRunDir 'photo-prepare-plan.json')
    if ($null -eq $plan -or $null -eq $plan.localPageMatch) { return '本地 PDF 页面匹配已启用（不使用 API）' }
    switch ([string]$plan.localPageMatch.status) {
        'completed' { return "已唯一确认 $([int]$plan.localPageMatch.resolved) 张，未决 $([int]$plan.localPageMatch.unresolved) 张" }
        'unavailable' { return '本地页面匹配异常（照片保持未改名）' }
        default { return '本地 PDF 页面匹配已启用（不使用 API）' }
    }
}
function Refresh-PhotoCard {
    if (-not (Validate-Root $false)) {
        Set-PhotoResult '业务目录无效。' ([System.Drawing.Color]::DarkRed) 0 '请先选择目录' $false $null
        return
    }
    $date = $photoDate.Value.ToString('yyyy-MM-dd')
    $photoRunDir = Join-Path (Get-WorkdayRoot $date) 'photos'
    $manifest = Read-JsonFile (Join-Path $photoRunDir 'photo-manifest.json')
    $checkpoint = Read-JsonFile (Join-Path $photoRunDir 'ui-workflow-state.json')
    if ($null -eq $manifest) {
        Set-PhotoResult '尚未完成照片初始化检测。' ([System.Drawing.Color]::DimGray) 0 '一键处理照片' $true 'photo-prepare'
        return
    }
    $allCount = [int]$manifest.counts.allImages
    $blessingCount = [int]$manifest.counts.blessing
    $sceneCount = [int]$manifest.counts.lampScene + [int]$manifest.counts.waterScene
    $blockingErrorCount = if ($null -ne $manifest.blockingErrors) { @($manifest.blockingErrors).Count } else { @($manifest.errors).Count }
    $manualIssueCount = if ($null -ne $manifest.manualIssues) { @($manifest.manualIssues).Count } else { 0 }
    $sceneManualIssueCount = if ($null -ne $manifest.sceneManualIssues) { @($manifest.sceneManualIssues).Count } else { 0 }
    if ($allCount -eq 0) {
        Set-PhotoResult "$date 未发现照片，等待照片进入日期目录的 1 文件夹。" ([System.Drawing.Color]::DarkOrange) 5 '等待照片' $false $null
        return
    }
    $currentInbox = Get-PhotoInboxForBusinessDate $date
    $hasNewRaw = Test-PhotoInboxHasNewRaw $currentInbox
    $hasResumeEvidence = Test-PhotoRunHasResumeEvidence $photoRunDir $manifest $checkpoint
    if ($blockingErrorCount -gt 0 -and $manifest.blessingReady -ne $true -and -not $hasNewRaw -and -not $hasResumeEvidence -and $blessingCount -gt 0 -and [int]$manifest.counts.missingBlessing -eq 0 -and [int]$manifest.counts.extraBlessing -eq 0) {
        Set-PhotoResult "$date 仅发现历史成品：福单图 $blessingCount 张；旧小数编号场景图和旧规格文件不作为新增待办，NAS 文件未修改。后续补图进入 1 文件夹后再重新检测。" ([System.Drawing.Color]::DimGray) 0 '历史成品目录' $false $null
        return
    }
    $manifestHash = [string]$manifest.fileSetHash
    $sceneReceipt = Read-JsonFile (Join-Path $photoRunDir 'scene-upload-receipt.json')
    $missingCount = [int]$manifest.counts.missingBlessing
    if ($sceneReceipt -and $sceneReceipt.complete -eq $true -and [string]$sceneReceipt.fileSetHash -eq $manifestHash -and $blockingErrorCount -eq 0 -and $manualIssueCount -eq 0) {
        Set-PhotoResult "$date 照片业务已完成：福单图 $blessingCount 张，场景图 $sceneCount 张。" ([System.Drawing.Color]::DarkGreen) 100 '照片业务已完成' $false $null
        return
    }
    if ($sceneReceipt -and $sceneReceipt.partialComplete -eq $true -and [string]$sceneReceipt.fileSetHash -eq $manifestHash -and ($missingCount -gt 0 -or $manualIssueCount -gt 0)) {
        $completedOrders = [int]$sceneReceipt.completedOrderCount
        Set-PhotoResult "$date 已确定福单图 $blessingCount 张及其 $completedOrders 条订单已分批完成；仍有 $missingCount 张待补、$manualIssueCount 项待人工确认。补图后只处理新增图片和剩余订单。" ([System.Drawing.Color]::DarkOrange) 78 '检测并处理补入照片' $true 'photo-prepare'
        return
    }
    if ($blockingErrorCount -gt 0 -or $manifest.blessingReady -ne $true) {
        $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
        $pageMatch = Get-LocalPageMatchStatus $photoRunDir
        Set-PhotoResult "$prefix 初始化发现 $blockingErrorCount 项硬性问题；本地编号兜底：$pageMatch。" ([System.Drawing.Color]::DarkOrange) 15 '一键处理照片' $true 'photo-prepare'
        return
    }
    $uploadReceipt = Read-JsonFile (Join-Path $photoRunDir 'photo-upload-receipt.json')
    if (-not ($uploadReceipt -and $uploadReceipt.complete -eq $true -and [string]$uploadReceipt.fileSetHash -eq $manifestHash -and [int]$uploadReceipt.uploadedCount -eq $blessingCount)) {
        $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
        $manualText = if ($manualIssueCount -gt 0) { "另有 $manualIssueCount 项待人工处理，但不阻断已确认福单。" } else { '' }
        Set-PhotoResult "$prefix 预检通过：福单图 $blessingCount 张、场景图 $sceneCount 张；下一步上传福单图。$manualText" ([System.Drawing.Color]::DarkBlue) 40 '继续照片：上传福单图' $true 'photo-upload'
        return
    }
    if ($sceneManualIssueCount -gt 0) {
        Set-PhotoResult "$date 已上传 $blessingCount 张已确认福单图；场景图仍有 $sceneManualIssueCount 项需人工补齐或确认。上方主按钮只续跑本日期断点；历史待办请使用中间的【继续处理未完成项】。" ([System.Drawing.Color]::DarkOrange) 62 '补齐场景后继续本日期' $true 'photo-prepare'
        return
    }
    if ($missingCount -gt 0) {
        Set-PhotoResult "$date 现有福单图 $blessingCount 张已上传，仍待补 $missingCount 张；下一步只处理福单已上传的订单状态，未上传订单继续保留待补。" ([System.Drawing.Color]::DarkBlue) 70 '处理已上传订单并继续待补' $true 'photo-scenes'
        return
    }
    $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
    Set-PhotoResult "$prefix 福单图 $blessingCount 张已上传；下一步处理供水、供灯场景图，并直接完成已上传牌位图的牌位订单。" ([System.Drawing.Color]::DarkBlue) 70 '继续照片：场景图/牌位并完成' $true 'photo-scenes'
}
function Get-BeijingHour {
    try { return [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow,'China Standard Time').Hour } catch { return (Get-Date).Hour }
}
function Refresh-PdfCard {
    $script:pdfWorkflowComplete = $false
    $script:pdfNextAction = 'export'
    $script:lastSummary = $null
    $copyButton.Enabled = $false
    if (-not (Validate-Root $false)) {
        $pdfStatus.Text = '业务目录无效。'; $pdfStatus.ForeColor = [System.Drawing.Color]::DarkRed
        $pdfProgress.Value = 0; $pdfMainButton.Text = '请先选择目录'; $pdfMainButton.Enabled = $false
        return
    }
    $date = $pdfDate.Value.ToString('yyyy-MM-dd')
    $runDir = Get-WorkdayRoot $date
    $folder = Join-Path $rootBox.Text.Trim() ("{0}月{1}日" -f $pdfDate.Value.Month,$pdfDate.Value.Day)
    $localPdfs = if (Test-Path -LiteralPath $folder) { @(Get-ChildItem -LiteralPath $folder -File -Filter '*.pdf' -ErrorAction SilentlyContinue) } else { @() }
    $state = Read-JsonFile (Join-Path $runDir 'run-state.json')
    $verification = Read-JsonFile (Join-Path $runDir 'online-verification.json')
    $renewalVerification = Read-JsonFile (Join-Path $runDir 'renewal-online-verification.json')
    $renewalState = Read-JsonFile (Join-Path $runDir 'renewal-state.json')
    $checkpoint = Read-JsonFile (Join-Path $runDir 'ui-workflow-state.json')
    $summaryFile = Join-Path $runDir 'quantity-message.txt'
    if (Test-Path -LiteralPath $summaryFile) { $script:lastSummary = Get-Content -Raw -Encoding UTF8 -LiteralPath $summaryFile; $copyButton.Enabled = -not $script:running }
    $complete = ($state -and $state.pdfVerified -eq $true -and ($state.stateChanged -eq $true -or $state.completionVerified -eq $true))
    $renewalAwaitingStatus = ($renewalState -and $renewalState.pdfVerified -eq $true -and $renewalState.stateChanged -ne $true -and [int]$renewalState.orderCount -gt 0)
    $renewalPending = if ($renewalVerification) { [int]$renewalVerification.pendingCount } else { 0 }
    $regularPending = if ($verification) { [int]$verification.blessingPendingCount + [int]$verification.tabletPendingCount } else { 0 }
    $renewalHasNewOrders = ($renewalPending -gt 0 -and ((-not $renewalState) -or [int]$renewalState.orderCount -ne $renewalPending -or ($renewalVerification.orderIdHash -and $renewalState.orderIdHash -ne $renewalVerification.orderIdHash)))
    if ($complete -and $regularPending -gt 0) {
        $script:pdfNextAction = 'export'
        $pdfStatus.Text = "$date 已有 PDF，但线上新增福单/牌位 $regularPending 条；将只导出新增订单并延续当天编号。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 85; $pdfMainButton.Text = '继续 PDF：处理同日补单'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete -and $renewalHasNewOrders) {
        $script:pdfNextAction = 'export'
        $pdfStatus.Text = "$date 续费清单较上次新增；将只导出尚未覆盖的订单并延续红/黄纸编号。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 85; $pdfMainButton.Text = '继续 PDF：处理续费补单'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete -and $renewalAwaitingStatus) {
        $script:pdfNextAction = 'renewal-state-change'
        $pdfStatus.Text = "$date 续费 PDF 已校验，但自动状态变更曾中断；可安全补做同一批代理已处理。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 95; $pdfMainButton.Text = '继续 PDF：补做续费状态'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete -and $renewalPending -gt 0) {
        $script:pdfNextAction = 'export'
        $pdfStatus.Text = "$date 常规 PDF 已完成；发现续费 $renewalPending 条未处理，将按红/黄纸顺延编号导出。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 85; $pdfMainButton.Text = '继续 PDF：处理续费'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete) {
        $script:pdfWorkflowComplete = $true
        $pdfStatus.Text = "$date PDF 业务已完成：本地 $($localPdfs.Count) 个 PDF，线上完成状态已确认。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        $pdfProgress.Value = 100; $pdfMainButton.Text = 'PDF 业务已完成'; $pdfMainButton.Enabled = $false
        return
    }
    if ((Get-BeijingHour) -lt 10) {
        $pdfStatus.Text = "$date PDF 尚未处理；还不到北京时间 10 点。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 10; $pdfMainButton.Text = '北京时间10点后可执行'; $pdfMainButton.Enabled = $false
        return
    }
    $pendingText = ''
    if ($verification) { $pendingText = "；线上福单 $([int]$verification.blessingPendingCount) 条、牌位 $([int]$verification.tabletPendingCount) 条待祈福" }
    $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
    if ($localPdfs.Count -gt 0) {
        $pdfStatus.Text = "$prefix 本地已有 $($localPdfs.Count) 个 PDF$pendingText；将校验凭据并从未完成环节续跑。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = if ($state -and $state.pdfVerified -eq $true) { 80 } else { 55 }
        $pdfMainButton.Text = '继续 PDF：校验并完成'
    } else {
        $pdfStatus.Text = "$prefix 初始化完成$pendingText；可以执行 PDF 导出闭环。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkBlue
        $pdfProgress.Value = 20
        $pdfMainButton.Text = '一键处理 PDF'
    }
    $pdfMainButton.Enabled = -not $script:running
}
function Refresh-AllCards { Refresh-PhotoCard; Refresh-PendingPhotoBar; Refresh-PdfCard }

function Test-ShouldAutoResumePhoto {
    if ([string]::IsNullOrWhiteSpace($script:photoNextAction)) { return $false }
    if (@('photo-upload','photo-scenes') -notcontains $script:photoNextAction) { return $false }
    $checkpoint = Read-JsonFile (Get-WorkflowStateFile 'photo')
    if ($null -eq $checkpoint) { return $false }
    return (($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running') -and
        (@('photo-upload','photo-scenes') -contains [string]$checkpoint.lastAction))
}

function Start-Runner([string]$action, [bool]$authorized, [string]$flow, [bool]$clearLog) {
    if ($script:running -or -not (Validate-Root)) { return }
    try { $runtime = Find-PrayerNodeRuntime } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message) | Out-Null; return }
    if ($runtime.NodePath) { $env:NODE_PATH = $runtime.NodePath }
    $script:activeAction = $action
    $script:activeFlow = $flow
    if (@('photo','backlog','backlog-photo') -contains $flow -or ($flow -eq 'manual' -and $action.StartsWith('photo-'))) { Write-WorkflowCheckpoint 'photo' 'running' $action }
    if ($flow -eq 'pdf' -or ($flow -eq 'manual' -and -not $action.StartsWith('photo-'))) { Write-WorkflowCheckpoint 'pdf' 'running' $action }
    $argsList = @(
        ('"' + (Join-Path $appRoot 'src\runner.mjs') + '"'),
        $action,
        '--root', ('"' + $rootBox.Text.Trim() + '"'),
        '--photo-date', $photoDate.Value.ToString('yyyy-MM-dd'),
        '--pdf-date', $pdfDate.Value.ToString('yyyy-MM-dd'),
        '--ui-log', ('"' + $script:uiLogPath + '"')
    )
    if ($authorized) { $argsList += @('--authorized','yes') }
    if ($flow -eq 'initialize') { $argsList += @('--login-timeout-ms','5000') }
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $runtime.Node
    $processInfo.Arguments = ($argsList -join ' ')
    $processInfo.WorkingDirectory = $appRoot
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.EnvironmentVariables['NODE_PATH'] = $env:NODE_PATH
    if ($clearLog) {
        [System.IO.File]::WriteAllText($script:uiLogPath,'',(New-Object System.Text.UTF8Encoding -ArgumentList $false))
        $script:uiLogLength = 0
        $logBox.Clear()
    } elseif (Test-Path -LiteralPath $script:uiLogPath) {
        $script:uiLogLength = (Get-Content -Raw -Encoding UTF8 -LiteralPath $script:uiLogPath).Length
    }
    $script:activeProcess = New-Object System.Diagnostics.Process
    $script:activeProcess.StartInfo = $processInfo
    Set-Running $true
    $globalStatus.Text = "正在执行：$(Get-ActionLabel $action)。已完成阶段会自动跳过。"
    $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
    Append-Log "[$(Get-Date -Format HH:mm:ss)] 开始：$(Get-ActionLabel $action)"
    if ($action -eq 'photo-prepare') {
        Append-Log "[$(Get-Date -Format HH:mm:ss)] 本轮仅使用本地 OCR 与 PDF 页面匹配；不会读取 API 密钥、不会上传图片。如仍未决将明确停止，不会改名或上传。"
    }
    [void]$script:activeProcess.Start()
    $script:processTimer.Start()
}
function Start-NextInitialization {
    if ($script:initQueue.Count -eq 0) {
        Refresh-AllCards
        if ($script:initFailures.Count -eq 0) {
            $pendingCount = @($script:pendingPhotoDates).Count
            $globalStatus.Text = if ($pendingCount -gt 0) {
                "初始化完成：发现 $pendingCount 个尚未闭环日期，已列入独立任务栏；主日期保持 $($photoDate.Value.ToString('yyyy-MM-dd'))。"
            } else {
                '初始化完成。照片和 PDF 是两个独立任务，请按需要点击对应的一键处理。'
            }
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        } else {
            $globalStatus.Text = "初始化完成，但有 $($script:initFailures.Count) 个检查未通过；对应卡片会显示可继续位置。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        }
        return
    }
    $item = $script:initQueue.Dequeue()
    Start-Runner $item $false 'initialize' $false
}
function Start-Initialization([string]$scope = 'all') {
    if ($script:running -or -not (Validate-Root)) { return }
    if ($scope -eq 'all' -or $scope -eq 'photo-backlog') { [void](Refresh-PendingPhotoDates) }
    $script:initQueue.Clear()
    $script:initFailures.Clear()
    if ($scope -eq 'all') { $script:initQueue.Enqueue('cleanup-local-state') }
    if ($scope -eq 'all' -or $scope -eq 'photo' -or $scope -eq 'photo-backlog') { $script:initQueue.Enqueue('photo-scan') }
    if ($scope -eq 'pdf') {
        $script:initQueue.Enqueue('inspect')
    } elseif ($scope -eq 'all' -and (Test-NeedAutomaticPdfInspect)) {
        # 没有本地 PDF 的新业务日不应为了 PDF 登录检查锁住照片按钮。
        $script:initQueue.Enqueue('inspect')
    }
    [System.IO.File]::WriteAllText($script:uiLogPath,'',(New-Object System.Text.UTF8Encoding -ArgumentList $false))
    $script:uiLogLength = 0
    $logBox.Clear()
    $globalStatus.Text = '正在初始化：先按保留期清理本机缓存，再读取本地与线上状态；不触碰 NAS 业务文件。'
    $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
    Start-NextInitialization
}
function Continue-PhotoFlow([bool]$clearLog = $false) {
    Refresh-PhotoCard
    if ([string]::IsNullOrWhiteSpace($script:photoNextAction)) {
        Write-WorkflowCheckpoint 'photo' 'completed' 'photo-scenes' 0
        [void](Refresh-PendingPhotoDates)
        $globalStatus.Text = '照片一键流程完成。'
        $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        return
    }
    Start-Runner $script:photoNextAction $true 'photo' $clearLog
}
function Restore-BacklogPhotoDate {
    if ($null -eq $script:backlogOriginalPhotoDate) { return }
    $returnDate = [DateTime]$script:backlogOriginalPhotoDate
    $script:running = $true
    try { $photoDate.Value = $returnDate } finally { $script:running = $false }
    $script:backlogOriginalPhotoDate = $null
    $script:backlogBusinessDate = $null
    Save-Settings
    Refresh-PhotoCard
    Refresh-PendingPhotoBar
}
function Continue-BacklogPhotoFlow([bool]$clearLog = $false) {
    Refresh-PhotoCard
    if ([string]::IsNullOrWhiteSpace($script:photoNextAction)) {
        Write-WorkflowCheckpoint 'photo' 'completed' 'photo-scenes' 0
        [void](Refresh-PendingPhotoDates)
        Restore-BacklogPhotoDate
        $globalStatus.Text = '历史未完成项已重新核对并全部处理完成。'
        $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        return
    }
    Start-Runner $script:photoNextAction $true 'backlog-photo' $clearLog
}
function Complete-Runner([int]$code) {
    $completedAction = $script:activeAction
    $completedFlow = $script:activeFlow
    Set-Running $false
    Refresh-AllCards
    if ($completedFlow -eq 'initialize') {
        if ($code -ne 0) { $script:initFailures.Add($completedAction) }
        if ($code -eq 0 -and $completedAction -eq 'photo-scan' -and (Test-ShouldAutoResumePhoto)) {
            # 上次照片流程已获得按钮授权并留下明确断点。照片预检重新通过后，
            # 立即从该断点续跑；不要继续等待独立的 PDF 初始化，也不要再让用户点一次。
            $script:initQueue.Clear()
            $globalStatus.Text = "照片预检通过，正在自动续跑【$(Get-ActionLabel $script:photoNextAction)】。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
            Continue-PhotoFlow $false
            return
        }
        Start-NextInitialization
        return
    }
    if ($completedFlow -eq 'backlog') {
        if ($code -ne 0) {
            $failedDate = $script:backlogBusinessDate
            Restore-BacklogPhotoDate
            $globalStatus.Text = "历史未完成日期 $failedDate 重新预检失败，已停在【$(Get-ActionLabel $completedAction)】；修复后再次点击【继续处理未完成项】。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
            return
        }
        Refresh-PhotoCard
        $globalStatus.Text = "历史未完成日期 $($script:backlogBusinessDate) 已重新预检；正在依据当前本地清单和线上未完成状态处理，不沿用旧步骤结论。"
        $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
        Continue-BacklogPhotoFlow $false
        return
    }
    if ($completedFlow -eq 'backlog-photo') {
        if ($code -ne 0) {
            Write-WorkflowCheckpoint 'photo' 'failed' $completedAction $code
            $failedDate = $script:backlogBusinessDate
            Restore-BacklogPhotoDate
            $globalStatus.Text = "历史未完成日期 $failedDate 停在【$(Get-ActionLabel $completedAction)】；已保留确定完成的阶段，处理提示项后再次点击【继续处理未完成项】。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
            return
        }
        Write-WorkflowCheckpoint 'photo' 'stage-completed' $completedAction 0
        Refresh-PhotoCard
        if ($script:photoNextAction -eq 'photo-prepare') {
            Write-WorkflowCheckpoint 'photo' 'waiting-supplement' $completedAction 0
            $waitingDate = $script:backlogBusinessDate
            Restore-BacklogPhotoDate
            $globalStatus.Text = "历史未完成日期 $waitingDate 的确定项目已处理；仍有缺图或场景图需补齐/确认，完成后再次点击【继续处理未完成项】。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
            return
        }
        if ($script:photoNextAction) {
            Continue-BacklogPhotoFlow $false
        } else {
            Write-WorkflowCheckpoint 'photo' 'completed' $completedAction 0
            [void](Refresh-PendingPhotoDates)
            Restore-BacklogPhotoDate
            $globalStatus.Text = '历史未完成项已重新核对并全部处理完成。'
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        }
        return
    }
    if ($completedFlow -eq 'photo') {
        if ($code -ne 0) {
            Write-WorkflowCheckpoint 'photo' 'failed' $completedAction $code
            Refresh-PhotoCard
            $globalStatus.Text = "照片流程中断在【$(Get-ActionLabel $completedAction)】。已完成阶段已保存，修复问题后点击照片主按钮即可续跑。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
            return
        }
        Write-WorkflowCheckpoint 'photo' 'stage-completed' $completedAction 0
        Refresh-PhotoCard
        if ($script:photoNextAction -eq 'photo-prepare') {
            Write-WorkflowCheckpoint 'photo' 'waiting-supplement' $completedAction 0
            $globalStatus.Text = '现有照片及其已上传订单已分批完成，当前等待补图；补入原图后再次点击照片主按钮只处理新增图片和剩余订单。'
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
            return
        }
        if ($script:photoNextAction) { Continue-PhotoFlow $false } else {
            Write-WorkflowCheckpoint 'photo' 'completed' $completedAction 0
            [void](Refresh-PendingPhotoDates)
            Refresh-PhotoCard
            $globalStatus.Text = '照片一键流程全部完成。'
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        }
        return
    }
    if ($completedFlow -eq 'pdf') {
        if ($code -eq 0) {
            Write-WorkflowCheckpoint 'pdf' 'completed' $completedAction 0
            Refresh-PdfCard
            $globalStatus.Text = 'PDF 一键流程完成。PDF 已校验后才执行状态变更。'
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        } else {
            Write-WorkflowCheckpoint 'pdf' 'failed' $completedAction $code
            Refresh-PdfCard
            $globalStatus.Text = "PDF 流程中断在【$(Get-ActionLabel $completedAction)】。再次点击 PDF 主按钮会从真实线上/本地状态续跑。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
        }
        return
    }
    $checkpointState = if ($code -eq 0) { 'stage-completed' } else { 'failed' }
    if ($completedAction.StartsWith('photo-')) {
        Write-WorkflowCheckpoint 'photo' $checkpointState $completedAction $code
    } else {
        Write-WorkflowCheckpoint 'pdf' $checkpointState $completedAction $code
    }
    Refresh-AllCards
    $globalStatus.Text = if ($code -eq 0) { '高级工具操作完成；状态已重新计算。' } else { "高级工具停止在【$(Get-ActionLabel $completedAction)】，请查看日志。" }
    $globalStatus.ForeColor = if ($code -eq 0) { [System.Drawing.Color]::DarkGreen } else { [System.Drawing.Color]::DarkRed }
}
$script:processTimer.Add_Tick({
    Refresh-UiLog
    if ($script:activeProcess -and $script:activeProcess.HasExited) {
        $exitCode = $script:activeProcess.ExitCode
        $script:processTimer.Stop()
        Refresh-UiLog
        $script:activeProcess.Dispose()
        $script:activeProcess = $null
        Complete-Runner $exitCode
    }
})

$photoMainButton.Add_Click({
    if (-not $script:running) {
        [System.IO.File]::WriteAllText($script:uiLogPath,'',(New-Object System.Text.UTF8Encoding -ArgumentList $false))
        $script:uiLogLength = 0; $logBox.Clear()
        Continue-PhotoFlow $false
    }
})
$pendingProcessButton.Add_Click({
    if ($script:running -or $null -eq $pendingPhotoPicker.SelectedItem) { return }
    $selectedDate = [DateTime]::ParseExact([string]$pendingPhotoPicker.SelectedItem,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $script:backlogOriginalPhotoDate = $photoDate.Value
    $script:backlogBusinessDate = $selectedDate.ToString('yyyy-MM-dd')
    $script:running = $true
    try { $photoDate.Value = $selectedDate } finally { $script:running = $false }
    $globalStatus.Text = "正在独立重新核对历史未完成日期 $($script:backlogBusinessDate)，不会覆盖上方默认日期。"
    $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
    Start-Runner 'photo-scan' $false 'backlog' $true
})
$pdfMainButton.Add_Click({
    if (-not $script:running) {
        Start-Runner $script:pdfNextAction $true 'pdf' $true
    }
})
$photoRefreshButton.Add_Click({ Start-Initialization 'photo-backlog' })
$pdfRefreshButton.Add_Click({ Start-Initialization 'pdf' })
$refreshAllButton.Add_Click({ Start-Initialization 'all' })

$browseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '请选择 @@圣堂祈福2026 或其中的 @每日福单 文件夹'
    if ($dialog.ShowDialog() -eq 'OK') {
        $selected = $dialog.SelectedPath
        if ((Split-Path -Leaf $selected) -ne '@每日福单' -and (Test-Path -LiteralPath (Join-Path $selected '@每日福单'))) { $selected = Join-Path $selected '@每日福单' }
        $rootBox.Text = $selected
        Save-Settings
        Start-Initialization 'all'
    }
})
$openPhotoButton.Add_Click({
    if (Validate-Root) {
        $folder = Join-Path (Join-Path $rootBox.Text.Trim() ("{0}月{1}日" -f $photoDate.Value.Month,$photoDate.Value.Day)) '1'
        if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
        Start-Process explorer.exe -ArgumentList ('"' + $folder + '"')
    }
})
$openPdfButton.Add_Click({
    if (Validate-Root) {
        $folder = Join-Path $rootBox.Text.Trim() ("{0}月{1}日" -f $pdfDate.Value.Month,$pdfDate.Value.Day)
        if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
        Start-Process explorer.exe -ArgumentList ('"' + $folder + '"')
    }
})
$copyButton.Add_Click({ if ($script:lastSummary) { [System.Windows.Forms.Clipboard]::SetText($script:lastSummary); $globalStatus.Text = '数量通知已复制。' } })
$advancedToggle.Add_Click({
    $advancedPanel.Visible = -not $advancedPanel.Visible
    if ($advancedPanel.Visible) {
        $advancedToggle.Text = '收起高级/故障工具 ▲'
    } else {
        $advancedToggle.Text = '展开高级/故障工具 ▼'
    }
    Update-ResponsiveLayout
})

$manualPhotoPrepare.Add_Click({ Start-Runner 'photo-prepare' $true 'manual' $true })
$manualPhotoScan.Add_Click({ Start-Runner 'photo-scan' $false 'manual' $true })
$manualPhotoUpload.Add_Click({ Start-Runner 'photo-upload' $true 'manual' $true })
$manualSceneUpload.Add_Click({ Start-Runner 'photo-scenes' $true 'manual' $true })
$manualPdfInspect.Add_Click({ Start-Runner 'inspect' $false 'manual' $true })
$manualPdfExport.Add_Click({ Start-Runner 'export' $true 'manual' $true })
$manualState.Add_Click({ Start-Runner 'state-change' $true 'manual' $true })

$photoDate.Add_ValueChanged({
    if (-not $script:running) {
        $script:hasRememberedPhotoDate = $true
        Save-Settings
        Start-Initialization 'photo'
    }
})
$pdfDate.Add_ValueChanged({
    if (-not $script:running) {
        $script:hasRememberedPdfDate = $true
        Save-Settings
        Start-Initialization 'pdf'
    }
})
$form.Add_FormClosing({
    param($sender,$eventArgs)
    if ($script:running) {
        $answer = [System.Windows.Forms.MessageBox]::Show('任务仍在运行。关闭窗口会中断当前步骤，但已完成阶段仍可续跑。确定关闭吗？','任务运行中','YesNo','Warning')
        if ($answer -ne 'Yes') { $eventArgs.Cancel = $true }
    }
    if (-not $eventArgs.Cancel) { Save-Settings }
})
$form.Add_Shown({
    if ($env:PRAYER_UI_SMOKE_TEST -eq 'yes') { $form.Close() }
    else { Start-Initialization 'all' }
})
try {
    [void]$form.ShowDialog()
} finally {
    Exit-PrayerSingleInstance $script:singleInstance
}
