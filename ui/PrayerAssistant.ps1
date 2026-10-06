$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'SingleInstance.ps1')
. (Join-Path $PSScriptRoot 'SettingsStore.ps1')
. (Join-Path $PSScriptRoot 'RuntimePaths.ps1')
. (Join-Path $PSScriptRoot 'Find-Runtime.ps1')
. (Join-Path $PSScriptRoot 'SecureCredentialStore.ps1')

$script:singleInstance = if ($env:PRAYER_UI_SMOKE_TEST -eq 'yes') {
    [pscustomobject]@{ Name='smoke-test'; Mutex=$null; OwnsLock=$true }
} else {
    Enter-PrayerSingleInstance
}
if (-not $script:singleInstance.OwnsLock) {
    [System.Windows.Forms.MessageBox]::Show(
        '祈福本地执行器已经在运行。请切换到现有窗口，不要重复启动。',
        '祈福本地执行器 V9.6.8-rc.5',
        'OK',
        'Information'
    ) | Out-Null
    Exit-PrayerSingleInstance $script:singleInstance
    return
}

$appRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $appRoot 'data'
# 祈福运行数据只保存在本机；不自动导入其他电脑同步来的断点/凭据。
$script:isUiSmokeTest = $env:PRAYER_UI_SMOKE_TEST -eq 'yes'
if ($script:isUiSmokeTest) {
    if ([string]::IsNullOrWhiteSpace($env:PRAYER_UI_SMOKE_ROOT)) { throw 'UI test requires an isolated temporary state directory.' }
    $script:localStateRoot = [IO.Path]::GetFullPath($env:PRAYER_UI_SMOKE_ROOT)
    $smokeTempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $script:localStateRoot.StartsWith($smokeTempPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'UI test state must be under the temporary directory.' }
} else {
    $script:localStateRoot = Get-PrayerLocalStateRoot
}
$settingsPath = Join-Path $script:localStateRoot 'settings.json'
$script:credentialPath = Join-Path $script:localStateRoot 'secure-login.dat'
$legacySettingsPath = if ($script:isUiSmokeTest) { Join-Path $script:localStateRoot 'legacy-settings.json' } else { Join-Path $dataDir 'settings.json' }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $script:localStateRoot | Out-Null

$settings = @{}
if (Test-Path -LiteralPath $settingsPath) {
    try { $settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath | ConvertFrom-Json } catch { $settings = @{} }
} elseif (Test-Path -LiteralPath $legacySettingsPath) {
    try { $settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $legacySettingsPath | ConvertFrom-Json } catch { $settings = @{} }
}
$businessRoot = if ($script:isUiSmokeTest) { '' } else { Find-PrayerBusinessRoot -SavedRoot $settings.businessRoot }
$beijingTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById('China Standard Time')
$today = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow,$beijingTimeZone).Date

# 启动默认值是固定业务约定，不读取上次手动选择，也不读取历史断点：
# 照片默认昨天，PDF 默认今天。历史未闭环日期只在独立任务栏提示。
$photoDateDefault = $today.AddDays(-1)
$pdfDateDefault = $today

$form = New-Object System.Windows.Forms.Form
$form.Text = '祈福本地执行器 V9.6.8-rc.5 · 2026-10-06.2（人工编号·自动压缩上传）'
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
$photoGroup.Text = '照片业务（人工编号后，软件压缩并上传）'
$photoGroup.Location = New-Object System.Drawing.Point(20,62)
$photoGroup.Size = New-Object System.Drawing.Size(840,145)
$form.Controls.Add($photoGroup)
Add-Label $photoGroup '业务日期' 18 30 75 | Out-Null
$photoDate = New-Object System.Windows.Forms.DateTimePicker
$photoDate.Format = 'Custom'
$photoDate.CustomFormat = 'yyyy-MM-dd'
$photoDate.Value = $photoDateDefault
$photoDate.Location = New-Object System.Drawing.Point(92,27)
$photoDate.Size = New-Object System.Drawing.Size(150,30)
$photoGroup.Controls.Add($photoDate)
$photoMainButton = Add-Button $photoGroup '一键处理照片' 255 24 390 42
$openPhotoButton = Add-Button $photoGroup '打开照片目录' 655 24 165 42
$photoStatus = Add-Label $photoGroup '尚未初始化。' 18 76 800 28
$photoStatus.ForeColor = [System.Drawing.Color]::DimGray
$photoStatus.AutoEllipsis = $true
$photoStatusToolTip = New-Object System.Windows.Forms.ToolTip
$photoProgress = New-Object System.Windows.Forms.ProgressBar
$photoProgress.Location = New-Object System.Drawing.Point(18,108)
$photoProgress.Size = New-Object System.Drawing.Size(802,18)
$photoGroup.Controls.Add($photoProgress)

$pendingGroup = New-Object System.Windows.Forms.GroupBox
$pendingGroup.Text = '历史未解决业务（线上查询，不含今天）'
$pendingGroup.Location = New-Object System.Drawing.Point(20,218)
$pendingGroup.Size = New-Object System.Drawing.Size(840,68)
$form.Controls.Add($pendingGroup)
$pendingStatus = Add-Label $pendingGroup '点击按钮查询今天以前的待祈福及祈福中未上传照片业务。' 18 28 530 28
$pendingStatus.ForeColor = [System.Drawing.Color]::DimGray
$pendingProcessButton = Add-Button $pendingGroup '检查历史未解决业务' 575 20 245 36

$pdfGroup = New-Object System.Windows.Forms.GroupBox
$pdfGroup.Text = 'PDF 业务（独立执行，不会自动关联照片日期）'
$pdfGroup.Location = New-Object System.Drawing.Point(20,297)
$pdfGroup.Size = New-Object System.Drawing.Size(840,145)
$form.Controls.Add($pdfGroup)
Add-Label $pdfGroup '业务日期' 18 30 75 | Out-Null
$pdfDate = New-Object System.Windows.Forms.DateTimePicker
$pdfDate.Format = 'Custom'
$pdfDate.CustomFormat = 'yyyy-MM-dd'
$pdfDate.Value = $pdfDateDefault
$pdfDate.Location = New-Object System.Drawing.Point(92,27)
$pdfDate.Size = New-Object System.Drawing.Size(150,30)
$pdfGroup.Controls.Add($pdfDate)
$pdfMainButton = Add-Button $pdfGroup '一键处理 PDF' 255 24 390 42
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
$refreshLocalButton = Add-Button $form '刷新照片和PDF状态' 385 457 205 38
$advancedToggle = Add-Button $form '展开高级/故障工具 ▼' 600 457 260 38

$advancedPanel = New-Object System.Windows.Forms.Panel
$advancedPanel.Location = New-Object System.Drawing.Point(20,501)
$advancedPanel.Size = New-Object System.Drawing.Size(840,92)
$advancedPanel.BorderStyle = 'FixedSingle'
$advancedPanel.Visible = $false
$form.Controls.Add($advancedPanel)
$manualPhotoPrepare = Add-Button $advancedPanel '人工编号照片压缩' 8 8 180 34
$manualPhotoScan = Add-Button $advancedPanel '照片：检查人工编号' 198 8 155 34
$manualPhotoUpload = Add-Button $advancedPanel '照片：只上传福单' 363 8 175 34
$manualSceneUpload = Add-Button $advancedPanel '照片：只处理场景' 548 8 180 34
$manualPdfInspect = Add-Button $advancedPanel 'PDF：只检查' 8 49 180 34
$manualPdfExport = Add-Button $advancedPanel 'PDF：导出并完成' 198 49 195 34
$manualState = Add-Button $advancedPanel 'PDF：只补状态' 403 49 175 34
$credentialButton = Add-Button $advancedPanel '设置登录账号' 588 49 120 34
$clearCredentialButton = Add-Button $advancedPanel '清除登录账号' 718 49 105 34

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
$script:activeStartedAtUtc = $null
$script:activePhotoBusinessDate = $null
$script:activeBusinessRoot = $null
$script:activeCorrectionSubmitted = $false
$script:initQueue = New-Object System.Collections.Queue
$script:initFailures = New-Object System.Collections.Generic.List[string]
$script:photoNextAction = $null
$script:photoAutoStepCount = 0
$script:backlogAutoStepCount = 0
$script:pdfWorkflowComplete = $false
$script:pdfNextAction = 'export'
$script:lastSummary = $null
New-Item -ItemType Directory -Force -Path (Join-Path $script:localStateRoot 'logs') | Out-Null
$script:uiLogPath = Join-Path $script:localStateRoot ('logs\ui-{0}-{1}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'),$PID)
$script:uiLogLength = 0
$script:processTimer = New-Object System.Windows.Forms.Timer
$script:processTimer.Interval = 250
$script:availabilityTimer = New-Object System.Windows.Forms.Timer
$script:availabilityTimer.Interval = 15000
$script:lastPhotoInboxSnapshot = $null
$script:lastPdfDateSnapshot = $null

function Save-Settings {
    Write-PrayerAtomicJson -Path $settingsPath -Value @{
        businessRoot = $rootBox.Text.Trim()
    }
}
function Clear-PrayerUiLog {
    # Keep the previous failure evidence before clearing the visible log.
    if ((Test-Path -LiteralPath $script:uiLogPath) -and (Get-Item -LiteralPath $script:uiLogPath).Length -gt 0) {
        $archive = Join-Path (Split-Path -Parent $script:uiLogPath) ('history-{0}-{1}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'),[Guid]::NewGuid().ToString('N'))
        Copy-Item -LiteralPath $script:uiLogPath -Destination $archive -ErrorAction Stop
    }
    [System.IO.File]::WriteAllText($script:uiLogPath,'',(New-Object System.Text.UTF8Encoding -ArgumentList $false))
}
function Update-CredentialButtons {
    $credentialFileExists = Test-Path -LiteralPath $script:credentialPath -PathType Leaf
    $configured = Test-PrayerCredential -Path $script:credentialPath
    $credentialButton.Text = if ($configured) { '登录账号：已配置' } elseif ($credentialFileExists) { '登录账号需重设' } else { '设置登录账号' }
    $clearCredentialButton.Enabled = ($credentialFileExists -and -not $script:running)
}
function Show-PrayerCredentialDialog {
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = '设置祈福平台登录账号'
    $dialog.ClientSize = New-Object System.Drawing.Size(430,220)
    $dialog.StartPosition = 'CenterParent'
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $dialog.Font = New-Object System.Drawing.Font('Microsoft YaHei UI',10)
    Add-Label $dialog '账号' 25 25 70 28 | Out-Null
    $usernameBox = New-Object System.Windows.Forms.TextBox
    $usernameBox.Location = New-Object System.Drawing.Point(100,22)
    $usernameBox.Size = New-Object System.Drawing.Size(295,30)
    $dialog.Controls.Add($usernameBox)
    Add-Label $dialog '密码' 25 70 70 28 | Out-Null
    $passwordBox = New-Object System.Windows.Forms.TextBox
    $passwordBox.Location = New-Object System.Drawing.Point(100,67)
    $passwordBox.Size = New-Object System.Drawing.Size(295,30)
    $passwordBox.UseSystemPasswordChar = $true
    $dialog.Controls.Add($passwordBox)
    $note = Add-Label $dialog '凭据将由 Windows 当前用户加密，仅本机当前 Windows 用户可解密；不会写入日志、NAS、Git 或迁移包。' 25 112 370 52
    $note.ForeColor = [System.Drawing.Color]::DimGray
    $save = Add-Button $dialog '加密保存' 205 170 90 34
    $cancel = Add-Button $dialog '取消' 305 170 90 34
    $cancel.Add_Click({ $dialog.DialogResult = 'Cancel'; $dialog.Close() })
    $save.Add_Click({
        try {
            Save-PrayerCredential -Path $script:credentialPath -Username $usernameBox.Text -Password $passwordBox.Text
            $passwordBox.Clear()
            $dialog.DialogResult = 'OK'
            $dialog.Close()
        } catch {
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'无法保存','OK','Warning') | Out-Null
        }
    })
    $dialog.AcceptButton = $save
    $dialog.CancelButton = $cancel
    [void]$dialog.ShowDialog($form)
    $passwordBox.Clear()
    Update-CredentialButtons
    if ($dialog.DialogResult -eq 'OK') {
        $globalStatus.Text = '登录账号已用 Windows 当前用户密钥加密保存；验证码始终由你在 Edge 登录页手动输入。'
        $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
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
function Test-PhotoInboxHasPendingWork([string]$inbox, $manifest) {
    if ([string]::IsNullOrWhiteSpace($inbox) -or -not (Test-Path -LiteralPath $inbox -PathType Container)) { return $false }
    if ($manifest -and $manifest.manualNumberedMode -eq $true -and $null -ne $manifest.inputFileHashes) {
        if ($manifest.localMirror -eq $true -and [string]$manifest.sourcePhotoDir -ne [string]$inbox) { return $true }
        $expectedHashes = if ($manifest.localMirror -eq $true) { $manifest.sourceInputFileHashes } else { $manifest.inputFileHashes }
        if ($null -eq $expectedHashes) { return $true }
        $current = @(Get-ChildItem -LiteralPath $inbox -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' })
        $savedNames = @($expectedHashes.PSObject.Properties.Name)
        if ($current.Count -ne $savedNames.Count) { return $true }
        foreach ($file in $current) {
            $property = $expectedHashes.PSObject.Properties[$file.Name]
            if ($null -eq $property) { return $true }
            if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$property.Value).ToLowerInvariant()) { return $true }
        }
        return $false
    }
    return Test-PhotoInboxHasNewRaw $inbox
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
function Refresh-PendingPhotoBar {
    $receipt = Read-JsonFile (Join-Path (Join-Path $script:localStateRoot 'historical-backlog') 'latest.json')
    if ($null -eq $receipt) {
        $pendingStatus.Text = '点击按钮查询今天以前的待祈福及祈福中未上传照片业务。'
        $pendingStatus.ForeColor = [System.Drawing.Color]::DimGray
        $pendingProcessButton.Enabled = -not $script:running
        return
    }
    $checkedAt = if ($receipt.checkedAt) { ([DateTime]$receipt.checkedAt).ToLocalTime().ToString('MM-dd HH:mm') } else { '最近一次' }
    if ($receipt.complete -eq $true) {
        $pendingStatus.Text = "$checkedAt 线上检查：今天以前没有历史未解决业务。"
        $pendingStatus.ForeColor = [System.Drawing.Color]::DarkGreen
    } else {
        $dates = @($receipt.businessDates)
        $preview = ($dates | Select-Object -First 3) -join '、'
        if ($dates.Count -gt 3) { $preview += '……' }
        $dateText = if ($preview) { "；涉及 $preview" } else { '' }
        $pendingStatus.Text = "$checkedAt 发现 $([int]$receipt.totalCount) 条：待祈福 $([int]$receipt.pendingPrayerCount) 条，祈福中未上传照片 $([int]$receipt.prayingWithoutPhotoCount) 条$dateText。"
        $pendingStatus.ForeColor = [System.Drawing.Color]::DarkOrange
    }
    $pendingProcessButton.Enabled = -not $script:running
}
function Refresh-PendingPhotoDates {
    Refresh-PendingPhotoBar
    return 0
}
function Test-NeedAutomaticPdfInspect {
    if (-not (Validate-Root $false)) { return $false }
    $date = $pdfDate.Value.ToString('yyyy-MM-dd')
    $runDir = Get-WorkdayRoot $date
    $state = Read-JsonFile (Join-Path $runDir 'run-state.json')
    if ($state -and $state.pdfVerified -eq $true -and ($state.stateChanged -eq $true -or $state.completionVerified -eq $true)) { return $false }
    $folder = Join-Path $rootBox.Text.Trim() ("{0}月{1}日" -f $pdfDate.Value.Month,$pdfDate.Value.Day)
    if (Test-Path -LiteralPath $folder) {
        if (@(Get-ChildItem -LiteralPath $folder -File -Filter '*.pdf' -ErrorAction SilentlyContinue).Count -gt 0) { return $true }
    }
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
        'photo-manual-prepare' { return '人工编号照片压缩' }
        'photo-recheck' { return '照片编号只读复核' }
        'photo-online-recheck' { return '照片线上闭环只读复核' }
        'historical-backlog-check' { return '历史未解决业务线上检查' }
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
            } elseif ($newText -match '账号和密码已从 Windows 加密凭据安全填入') {
                $globalStatus.Text = '账号密码已安全填入：请在 Edge 输入验证码并点击登录，软件会自动继续。'
                $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
            } elseif ($newText -match '已使用 Windows 加密凭据提交登录') {
                $globalStatus.Text = '已安全提交自动登录，正在验证平台登录状态……'
                $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
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
    $pendingProcessButton.Enabled = -not $value
    $photoMainButton.Enabled = -not $value
    $pdfMainButton.Enabled = -not $value
    $refreshAllButton.Enabled = -not $value
    $refreshLocalButton.Enabled = -not $value
    foreach ($button in @($manualPhotoPrepare,$manualPhotoScan,$manualPhotoUpload,$manualSceneUpload,$manualPdfInspect,$manualPdfExport,$manualState,$credentialButton)) { $button.Enabled = -not $value }
    Update-CredentialButtons
}
function Set-PhotoResult([string]$text, [System.Drawing.Color]$color, [int]$progress, [string]$buttonText, [bool]$enabled, [string]$nextAction) {
    $script:photoProblemDetails = $text
    $photoLines = @($text -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $photoStatus.Text = if ($photoLines.Count -gt 1 -and $photoLines[0] -match '[：:]$') { "$($photoLines[0])$($photoLines[1])" } else { $photoLines[0] }
    $photoStatusToolTip.SetToolTip($photoStatus,$text)
    $photoStatus.ForeColor = $color
    $photoProgress.Value = [Math]::Max(0,[Math]::Min(100,$progress))
    $photoMainButton.Text = '一键处理照片'
    $photoMainButton.Enabled = ($enabled -and -not $script:running)
    $script:photoNextAction = $nextAction
}
function Get-CurrentPhotoError {
    if (-not (Test-Path -LiteralPath $script:uiLogPath)) { return $null }
    $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $script:uiLogPath
    $offset = [int]$script:activeUiLogOffset
    if ($null -eq $content -or $offset -gt $content.Length) { return $null }
    $match = [regex]::Match($content.Substring($offset),'(?ms)^错误：(.+?)(?=^(?:\[\d{2}:\d{2}:\d{2}\]|错误：)|\z)')
    if ($match.Success) { return $match.Groups[1].Value.Trim() }
    return $null
}
function Show-PhotoProblemDetails {
    if ([string]::IsNullOrWhiteSpace($script:photoProblemDetails)) { return }
    if ($env:PRAYER_UI_SMOKE_TEST -eq 'yes') {
        $script:lastPhotoProblemDialog = $script:photoProblemDetails
        return
    }
    [System.Windows.Forms.MessageBox]::Show($form,$script:photoProblemDetails,'照片处理提示（文件名和编号）',
        [System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
}
$photoStatus.Cursor = [System.Windows.Forms.Cursors]::Hand
$photoStatus.Add_Click({ Show-PhotoProblemDetails })
function Get-SavedPhotoProblem($manifest, [string]$photoRunDir) {
    $problem = Read-JsonFile (Join-Path $photoRunDir 'photo-problem.json')
    if ($problem -and -not $problem.resolvedAt -and $manifest.fileSetHash -and
        [string]$problem.fileSetHash -eq [string]$manifest.fileSetHash -and
        [string]$problem.businessDate -eq $photoDate.Value.ToString('yyyy-MM-dd') -and
        [string]$problem.sourceRoot -eq $rootBox.Text.Trim() -and $problem.message) { return $problem }
    return $null
}
function Get-FirstPhotoIssue($manifest) {
    foreach ($property in @('blockingErrors','sceneManualIssues','manualIssues')) {
        if ($null -ne $manifest.$property) {
            $issue = @($manifest.$property) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1
            if ($null -ne $issue) { return [string]$issue }
        }
    }
    if ($manifest.photoAvailability -and $manifest.photoAvailability.summary) { return [string]$manifest.photoAvailability.summary }
    return '请查看下方运行日志中的具体文件名和处理建议。'
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
    $currentInbox = Get-PhotoInboxForBusinessDate $date
    if ($null -eq $manifest) {
        $newImageCount = if (Test-Path -LiteralPath $currentInbox -PathType Container) { @(Get-ChildItem -LiteralPath $currentInbox -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' }).Count } else { 0 }
        if ($newImageCount -gt 0) {
            Set-PhotoResult "$date 发现 $newImageCount 张照片；点击【一键处理照片】检查人工编号和规格。" ([System.Drawing.Color]::DarkBlue) 10 '检查并压缩照片' $true 'photo-manual-prepare'
        } else {
            Set-PhotoResult "$date 未发现照片，等待照片进入日期目录的 1 文件夹。" ([System.Drawing.Color]::DarkOrange) 5 '等待照片' $false $null
        }
        return
    }
    $allCount = [int]$manifest.counts.allImages
    $blessingCount = [int]$manifest.counts.blessing
    $sceneCount = [int]$manifest.counts.lampScene + [int]$manifest.counts.waterScene
    $blockingErrorCount = if ($null -ne $manifest.blockingErrors) { @($manifest.blockingErrors).Count } else { @($manifest.errors).Count }
    $manualIssueCount = if ($null -ne $manifest.manualIssues) { @($manifest.manualIssues).Count } else { 0 }
    $sceneManualIssueCount = if ($null -ne $manifest.sceneManualIssues) { @($manifest.sceneManualIssues).Count } else { 0 }
    if ($allCount -eq 0) {
        $newImageCount = if (Test-Path -LiteralPath $currentInbox -PathType Container) { @(Get-ChildItem -LiteralPath $currentInbox -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' }).Count } else { 0 }
        if ($newImageCount -gt 0) {
            Set-PhotoResult "$date 新放入 $newImageCount 张照片；点击【一键处理照片】重新检查并压缩。" ([System.Drawing.Color]::DarkBlue) 10 '检查并压缩照片' $true 'photo-manual-prepare'
        } else {
            Set-PhotoResult "$date 未发现照片，等待照片进入日期目录的 1 文件夹。" ([System.Drawing.Color]::DarkOrange) 5 '等待照片' $false $null
        }
        return
    }
    $hasNewRaw = Test-PhotoInboxHasPendingWork $currentInbox $manifest
    if ($hasNewRaw) {
        Set-PhotoResult "$date 照片目录有新增或改动；点击【一键处理照片】重新检查人工编号和规格。" ([System.Drawing.Color]::DarkBlue) 10 '重新检查照片' $true 'photo-manual-prepare'
        return
    }
    $hasResumeEvidence = Test-PhotoRunHasResumeEvidence $photoRunDir $manifest $checkpoint
    $sourceCommit = Read-JsonFile (Join-Path $photoRunDir 'source-photo-commit.json')
    $sourceSaveInterrupted = $sourceCommit -and [string]$sourceCommit.businessDate -eq $date -and -not $sourceCommit.completedAt
    if ($manifest.manualNumberedMode -eq $true -and ([int]$manifest.sourceNormalizationPending -gt 0 -or $sourceSaveInterrupted)) {
        Set-PhotoResult "$date 原目录压缩尚未核验完成；点击【一键处理照片】检查并保存压缩图，已有上传回执会保留。" ([System.Drawing.Color]::DarkOrange) 30 '压缩原目录照片' $true 'photo-manual-prepare'
        return
    }
    $onlineClosure = Read-JsonFile (Join-Path $photoRunDir 'photo-online-closure.json')
    if ($onlineClosure -and $onlineClosure.complete -eq $true -and [string]$onlineClosure.businessDate -eq $date -and
        [int]$onlineClosure.onlineScopeCount -gt 0 -and [int]$onlineClosure.onlineUnfinishedCount -eq 0 -and -not $hasNewRaw) {
        $checkedAtText = if ($onlineClosure.checkedAt) { ([DateTime]$onlineClosure.checkedAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm') } else { '最近一次复核' }
        Set-PhotoResult "$date 线上闭环已复核（$checkedAtText）：福单未上传 0、供灯待祈福 0、牌位待祈福 0。本地旧断点或旧规格提醒不再列为未闭环。" ([System.Drawing.Color]::DarkGreen) 100 '线上已确认闭环' $false $null
        return
    }
    if ($manifest.manualNumberedMode -ne $true -and $blockingErrorCount -gt 0 -and $manifest.blessingReady -ne $true -and -not $hasNewRaw -and -not $hasResumeEvidence -and $blessingCount -gt 0 -and [int]$manifest.counts.missingBlessing -eq 0 -and [int]$manifest.counts.extraBlessing -eq 0) {
        Set-PhotoResult "$date 仅发现历史成品：福单图 $blessingCount 张；旧小数编号场景图和旧规格文件不作为新增待办，NAS 文件未修改。后续补图进入 1 文件夹后再重新检测。" ([System.Drawing.Color]::DimGray) 0 '历史成品目录' $false $null
        return
    }
    $manifestHash = [string]$manifest.fileSetHash
    $sceneReceipt = Read-JsonFile (Join-Path $photoRunDir 'scene-upload-receipt.json')
    $missingCount = [int]$manifest.counts.missingBlessing
    $pendingPhotoText = if ($manifest.photoAvailability -and $manifest.photoAvailability.summary) {
        [string]$manifest.photoAvailability.summary
    } elseif ($missingCount -gt 0) {
        if ([int]$manifest.counts.unexpected -gt 0) {
            "$missingCount 个 PDF 页面尚未匹配已确认福单图；目录另有 $([int]$manifest.counts.unexpected) 张待识别或确认图片，不能直接判定缺图"
        } else { "$missingCount 个 PDF 页面尚未匹配已确认福单图，请核对原图与 PDF 批次" }
    } else { '请核对尚未确认的图片及场景类别' }
    $firstPhotoIssue = Get-FirstPhotoIssue $manifest
    $savedProblem = Get-SavedPhotoProblem $manifest $photoRunDir
    if ($sceneReceipt -and $sceneReceipt.complete -eq $true -and [string]$sceneReceipt.fileSetHash -eq $manifestHash -and $blockingErrorCount -eq 0 -and $manualIssueCount -eq 0) {
        if ($sceneReceipt.onlineVerifiedAt -and [int]$sceneReceipt.completedOrderCount -gt 0 -and [int]$sceneReceipt.onlineNotUploadedCount -eq 0) {
            Set-PhotoResult "$date 照片业务线上完成：福单图 $blessingCount 张，场景图 $sceneCount 张，已完成 $([int]$sceneReceipt.completedOrderCount) 条订单。" ([System.Drawing.Color]::DarkGreen) 100 '照片业务已完成' $false $null
            return
        }
        if ($onlineClosure -and [string]$onlineClosure.businessDate -eq $date -and [int]$onlineClosure.onlineUnfinishedCount -gt 0) {
            Set-PhotoResult "$date 本地照片有上传回执，但线上仍有 $([int]$onlineClosure.onlineUnfinishedCount) 条祈福未完成；继续按线上状态处理。" ([System.Drawing.Color]::DarkOrange) 75 '继续处理线上照片业务' $true 'photo-scenes'
            return
        }
        if ($onlineClosure -and [string]$onlineClosure.businessDate -eq $date -and [int]$onlineClosure.onlineScopeCount -eq 0 -and [int]$onlineClosure.historicalOrderCount -gt 0) {
            Set-PhotoResult "$date 本地旧清单有 $([int]$onlineClosure.historicalOrderCount) 条订单，但线上当前日期筛选为 0；线上未核实完成，需先核对后台业务日期。" ([System.Drawing.Color]::DarkOrange) 75 '重新核实线上状态' $true 'photo-online-recheck'
            return
        }
        Set-PhotoResult "$date 本地照片有上传回执，线上未核实完成；先只读复核对应日期订单，再决定是否继续处理。" ([System.Drawing.Color]::DarkOrange) 75 '核实线上照片状态' $true 'photo-online-recheck'
        return
    }
    if ($sceneReceipt -and $sceneReceipt.partialComplete -eq $true -and [string]$sceneReceipt.fileSetHash -eq $manifestHash) {
        $completedOrders = [int]$sceneReceipt.completedOrderCount
        $onlinePending = [int]$sceneReceipt.onlineNotUploadedCount
        if ($onlineClosure -and [string]$onlineClosure.businessDate -eq $date -and $null -ne $onlineClosure.onlineNotUploadedCount) {
            $onlinePending = [int]$onlineClosure.onlineNotUploadedCount
        }
        if ($manifest.manualNumberedMode -eq $true -and $missingCount -eq 0 -and $manualIssueCount -eq 0) {
            $onlinePendingText = if ($onlinePending -gt 0) { "线上还有 $onlinePending 条福单未上传" } else { '最近复核显示福单未上传 0 条，但线上闭环尚未确认' }
            Set-PhotoResult "$date 已上传照片对应 $completedOrders 条订单已分批完成；$onlinePendingText。点击按钮只读复核线上状态一次；新增照片后会自动切换为压缩上传。" ([System.Drawing.Color]::DarkOrange) 78 '只读复核线上状态' $true 'photo-online-recheck'
            return
        }
        if ($missingCount -eq 0 -and $manualIssueCount -eq 0) {
            Set-PhotoResult "$date 已完成现有 $completedOrders 条订单，但照片业务仍未闭环；自动续跑已停止，请核对线上缺图状态。" ([System.Drawing.Color]::DarkOrange) 78 '重新检查照片' $true 'photo-manual-prepare'
            return
        }
        Set-PhotoResult "$date 已确定福单图 $blessingCount 张及其 $completedOrders 条订单已分批完成。具体问题：$pendingPhotoText" ([System.Drawing.Color]::DarkOrange) 78 '检查人工编号照片' $true 'photo-manual-prepare'
        return
    }
    if ($blockingErrorCount -gt 0 -or $manifest.blessingReady -ne $true) {
        $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
        $nextStep = if ($manifest.manualNumberedMode -eq $true -and [int]$manifest.counts.unexpected -eq 0) { '点击“一键处理照片”统一规格，然后继续上传；不会读取 PDF。' } else { '请先人工完成编号，软件只负责压缩和上传，不读取 PDF。' }
        $allPhotoIssues = @($manifest.blockingErrors) + @($manifest.sceneManualIssues) + @($manifest.manualIssues)
        $allPhotoIssues = @($allPhotoIssues | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
        if ($allPhotoIssues.Count -eq 0) { $allPhotoIssues = @($firstPhotoIssue) }
        if (($allPhotoIssues -join ' ') -match '编号.*重复|内容完全相同') {
            $nextStep = '请对照纸面右上角末号修改文件名，改好后再点击“一键处理照片”。'
        }
        $details = "请检查照片：$($allPhotoIssues -join "`r`n")`r`n$nextStep"
        Set-PhotoResult $details ([System.Drawing.Color]::DarkOrange) 15 '检查并压缩照片' $true 'photo-manual-prepare'
        return
    }
    $uploadReceipt = Read-JsonFile (Join-Path $photoRunDir 'photo-upload-receipt.json')
    if (-not ($uploadReceipt -and $uploadReceipt.complete -eq $true -and [string]$uploadReceipt.fileSetHash -eq $manifestHash -and [int]$uploadReceipt.uploadedCount -eq $blessingCount)) {
        if ($savedProblem -and [string]$savedProblem.action -eq 'photo-upload') {
            Set-PhotoResult ([string]$savedProblem.message) ([System.Drawing.Color]::DarkRed) 40 '查看照片问题' $true 'photo-upload'
            return
        }
        $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
        $manualText = if ($manualIssueCount -gt 0) { "待人工处理：$firstPhotoIssue" } else { '' }
        $preparedText = if ($manifest.manualNumberedMode) { '照片预检通过（上传前核验原目录压缩）' } else { '预检通过' }
        Set-PhotoResult "$prefix ${preparedText}：福单图 $blessingCount 张、场景图 $sceneCount 张；下一步上传福单图。$manualText" ([System.Drawing.Color]::DarkBlue) 40 '继续照片：上传福单图' $true 'photo-upload'
        return
    }
    if ($sceneManualIssueCount -gt 0) {
        Set-PhotoResult "$date 已上传 $blessingCount 张人工编号福单图。具体问题：$firstPhotoIssue" ([System.Drawing.Color]::DarkOrange) 62 '补齐并检查照片' $true 'photo-manual-prepare'
        return
    }
    if ($missingCount -gt 0) {
        Set-PhotoResult "$date 现有福单图 $blessingCount 张已上传；$pendingPhotoText。下一步只处理福单已上传的订单状态，未上传订单保留待处理。" ([System.Drawing.Color]::DarkBlue) 70 '处理已上传订单并继续核对' $true 'photo-scenes'
        return
    }
    $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
    if ($savedProblem -and [string]$savedProblem.action -eq 'photo-scenes') {
        Set-PhotoResult ([string]$savedProblem.message) ([System.Drawing.Color]::DarkRed) 70 '继续处理照片' $true 'photo-scenes'
        return
    }
    Set-PhotoResult "$prefix 福单图 $blessingCount 张已上传；下一步处理供水、供灯场景图，并直接完成已上传牌位图的牌位订单。" ([System.Drawing.Color]::DarkBlue) 70 '继续照片：场景图/牌位并完成' $true 'photo-scenes'
}
function Refresh-PdfCard {
    $script:pdfWorkflowComplete = $false
    $script:pdfNextAction = 'export'
    $script:lastSummary = $null
    $copyButton.Enabled = $false
    if (-not (Validate-Root $false)) {
        $pdfStatus.Text = '业务目录无效。'; $pdfStatus.ForeColor = [System.Drawing.Color]::DarkRed
        $pdfProgress.Value = 0; $pdfMainButton.Text = '一键处理 PDF'; $pdfMainButton.Enabled = $false
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
        $pdfProgress.Value = 85; $pdfMainButton.Text = '一键处理 PDF'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete -and $renewalHasNewOrders) {
        $script:pdfNextAction = 'export'
        $pdfStatus.Text = "$date 续费清单较上次新增；将只导出尚未覆盖的订单并延续红/黄纸编号。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 85; $pdfMainButton.Text = '一键处理 PDF'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete -and $renewalAwaitingStatus) {
        $script:pdfNextAction = 'renewal-state-change'
        $pdfStatus.Text = "$date 续费 PDF 已校验，但自动状态变更曾中断；可安全补做同一批代理已处理。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 95; $pdfMainButton.Text = '一键处理 PDF'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete -and $renewalPending -gt 0) {
        $script:pdfNextAction = 'export'
        $pdfStatus.Text = "$date 常规 PDF 已完成；发现续费 $renewalPending 条未处理，将按红/黄纸顺延编号导出。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = 85; $pdfMainButton.Text = '一键处理 PDF'; $pdfMainButton.Enabled = -not $script:running
        return
    }
    if ($complete) {
        $script:pdfWorkflowComplete = $true
        $pdfStatus.Text = "$date PDF 业务已完成：本地 $($localPdfs.Count) 个 PDF，线上完成状态已确认。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkGreen
        $pdfProgress.Value = 100; $pdfMainButton.Text = '一键处理 PDF'; $pdfMainButton.Enabled = $false
        return
    }
    $pendingText = ''
    if ($verification) { $pendingText = "；线上福单 $([int]$verification.blessingPendingCount) 条、牌位 $([int]$verification.tabletPendingCount) 条待祈福" }
    $prefix = if ($checkpoint -and ($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running')) { "上次中断在$(Get-ActionLabel $checkpoint.lastAction)；" } else { '' }
    if ($localPdfs.Count -gt 0) {
        $pdfStatus.Text = "$prefix 本地已有 $($localPdfs.Count) 个 PDF$pendingText；将校验凭据并从未完成环节续跑。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkOrange
        $pdfProgress.Value = if ($state -and $state.pdfVerified -eq $true) { 80 } else { 55 }
        $pdfMainButton.Text = '一键处理 PDF'
    } else {
        $pdfStatus.Text = "$prefix 初始化完成$pendingText；可以执行 PDF 导出闭环。"
        $pdfStatus.ForeColor = [System.Drawing.Color]::DarkBlue
        $pdfProgress.Value = 20
        $pdfMainButton.Text = '一键处理 PDF'
    }
    $pdfMainButton.Enabled = -not $script:running
}
function Refresh-AllCards { Refresh-PhotoCard; Refresh-PendingPhotoBar; Refresh-PdfCard }
function Get-PhotoInboxSnapshot {
    $date = $photoDate.Value.ToString('yyyy-MM-dd')
    $inbox = Get-PhotoInboxForBusinessDate $date
    if (-not (Test-Path -LiteralPath $inbox -PathType Container)) { return "$date|missing" }
    $files = @(Get-ChildItem -LiteralPath $inbox -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' } | Sort-Object Name)
    return "$date|" + (($files | ForEach-Object { "$($_.Name)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join ';')
}
function Refresh-LocalAvailability([bool]$force = $false) {
    if ($script:running) { return }
    $photoSnapshot = Get-PhotoInboxSnapshot
    if ($force -or $photoSnapshot -ne $script:lastPhotoInboxSnapshot) {
        $script:lastPhotoInboxSnapshot = $photoSnapshot
        Refresh-PhotoCard
    }
    $pdfDateSnapshot = $pdfDate.Value.ToString('yyyy-MM-dd')
    if ($force -or $pdfDateSnapshot -ne $script:lastPdfDateSnapshot) {
        $script:lastPdfDateSnapshot = $pdfDateSnapshot
        Refresh-PdfCard
    }
}

function Test-ShouldAutoResumePhoto {
    if ([string]::IsNullOrWhiteSpace($script:photoNextAction)) { return $false }
    if (@('photo-upload','photo-scenes') -notcontains $script:photoNextAction) { return $false }
    $checkpoint = Read-JsonFile (Get-WorkflowStateFile 'photo')
    if ($null -eq $checkpoint) { return $false }
    return (($checkpoint.state -eq 'failed' -or $checkpoint.state -eq 'running') -and
        (@('photo-upload','photo-scenes') -contains [string]$checkpoint.lastAction))
}

function Get-UploadCorrectionArguments([string]$action, [bool]$authorized, [string]$token = '') {
    if ([string]::IsNullOrWhiteSpace($token)) { return @() }
    if ($action -ne 'photo-upload' -or -not $authorized -or $token -cnotmatch '^[a-f0-9]{64}$') {
        throw '照片修正确认仅适用于本次已授权的照片上传。'
    }
    return @('--confirm-upload-correction', $token)
}
function Get-PendingUploadCorrectionReview {
    if ($null -eq $script:activeStartedAtUtc -or [string]::IsNullOrWhiteSpace($script:activePhotoBusinessDate)) { return $null }
    if ($photoDate.Value.ToString('yyyy-MM-dd') -ne $script:activePhotoBusinessDate -or
        $rootBox.Text.Trim() -ne $script:activeBusinessRoot) { return $null }
    try {
        $runDir = Join-Path (Get-WorkdayRoot $script:activePhotoBusinessDate) 'photos'
        $review = Read-JsonFile (Join-Path $runDir 'photo-upload-correction-review.json')
        $manifest = Read-JsonFile (Join-Path $runDir 'photo-manifest.json')
        if ($null -eq $review -or $null -eq $manifest -or $review.schemaVersion -ne 1 -or
            $review.kind -ne 'duplicate-content-correction' -or $review.eligible -isnot [bool] -or $review.eligible -ne $true -or
            $review.businessDate -ne $script:activePhotoBusinessDate -or $manifest.businessDate -ne $review.businessDate -or
            $manifest.manualNumberedMode -ne $true -or [string]::IsNullOrWhiteSpace([string]$review.fileSetHash) -or
            [string]$review.fileSetHash -cne [string]$manifest.fileSetHash -or
            [string]$review.confirmationToken -cnotmatch '^[a-f0-9]{64}$') { return $null }
        $created = [DateTimeOffset]::Parse([string]$review.createdAt, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime
        if ($created -lt $script:activeStartedAtUtc -or $created -gt [DateTime]::UtcNow.AddSeconds(5)) { return $null }
        $oldNames = @($review.oldAttempt.files)
        $currentNames = @($review.currentFiles)
        $removed = @($review.removedFiles)
        $renamed = @($review.renamedFiles | Where-Object { $null -ne $_ })
        if ($currentNames.Count -lt 1 -or $currentNames.Count -gt 50 -or $oldNames.Count -lt $currentNames.Count -or
            ($oldNames.Count -eq $currentNames.Count -and $renamed.Count -lt 1) -or
            $removed.Count -ne ($oldNames.Count - $currentNames.Count) -or [int]$review.pendingOrderCount -lt 1) { return $null }
        $manifestNames = @($manifest.files.blessing | ForEach-Object { [IO.Path]::GetFileName([string]$_) })
        if ($manifestNames.Count -ne $currentNames.Count -or @($currentNames | Select-Object -Unique).Count -ne $currentNames.Count) { return $null }
        foreach ($name in $currentNames) {
            if ($manifestNames -notcontains $name -or [string]$review.currentFileHashes.$name -cnotmatch '^[a-f0-9]{64}$' -or
                [string]$review.currentFileHashes.$name -cne [string]$manifest.fileHashes.$name) { return $null }
        }
        foreach ($item in $removed) {
            if ([string]$item.name -notmatch '^\d+\.jpg$' -or [string]$item.duplicateOf -notmatch '^\d+\.jpg$' -or
                $oldNames -notcontains $item.name -or $currentNames -contains $item.name -or
                $currentNames -notcontains $item.duplicateOf) { return $null }
        }
        foreach ($item in $renamed) {
            if ([string]$item.name -notmatch '^\d+\.jpg$' -or [string]$item.renamedTo -notmatch '^\d+\.jpg$' -or
                $oldNames -notcontains $item.name -or $currentNames -contains $item.name -or
                $currentNames -notcontains $item.renamedTo -or $oldNames -contains $item.renamedTo -or
                [string]$item.sha256 -cne [string]$review.oldFileHashes.($item.name) -or
                [string]$item.sha256 -cne [string]$review.currentFileHashes.($item.renamedTo)) { return $null }
        }
        if ($renamed.Count -gt 0 -and ($removed.Count -gt 0 -or
            @($renamed.name | Select-Object -Unique).Count -ne $renamed.Count -or
            @($renamed.renamedTo | Select-Object -Unique).Count -ne $renamed.Count -or
            @($currentNames | Where-Object { $oldNames -notcontains $_ }).Count -ne $renamed.Count)) { return $null }
        $inbox = Get-PhotoInboxForBusinessDate $review.businessDate
        if (-not (Test-Path -LiteralPath $inbox -PathType Container) -or (Test-PhotoInboxHasPendingWork $inbox $manifest)) { return $null }
        return $review
    } catch { return $null }
}
function Show-UploadCorrectionConfirmation($review) {
    $removedText = (@($review.removedFiles | ForEach-Object { "$($_.name) 与 $($_.duplicateOf) 内容相同，当前清单已移除 $($_.name)" }) -join "`r`n")
    if (@($review.renamedFiles | Where-Object { $null -ne $_ }).Count -gt 0) {
        $removedText = (@($review.renamedFiles | ForEach-Object { "$($_.name) → $($_.renamedTo)，图片内容未变；请核对新文件名与您手工编号一致" }) -join "`r`n")
    }
    $message = "业务日期：$($review.businessDate)`r`n旧批次：$(@($review.oldAttempt.files).Count) 张；当前修正后：$(@($review.currentFiles).Count) 张。`r`n$removedText`r`n`r`n线上仍有 $($review.pendingOrderCount) 条未上传订单。旧批次的提交结果仍未确认，后台可能已保存部分图片但尚未关联订单。`r`n`r`n选择【是】将重新提交当前修正后的照片清单一次；不会删除原照片。提交前会再次核对清单和线上状态。选择【否】保持暂停。`r`n`r`n是否确认重新提交？"
    return [System.Windows.Forms.MessageBox]::Show($form, $message, '确认修正后的照片重新提交',
        [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
}
function Try-ConfirmUploadCorrection([string]$completedAction, [string]$completedFlow, [int]$code) {
    if ($code -eq 0 -or $completedAction -ne 'photo-upload' -or $script:activeCorrectionSubmitted -or
        @('photo','backlog-photo','manual') -notcontains $completedFlow) { return $false }
    $review = Get-PendingUploadCorrectionReview
    if ($null -eq $review) { return $false }
    # This flag belongs only to the completed process. The token is passed
    # explicitly to one new process and never stored as a reusable setting.
    $script:activeCorrectionSubmitted = $true
    Set-Running $true
    try { $answer = Show-UploadCorrectionConfirmation $review } finally { Set-Running $false }
    if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
        $fresh = Get-PendingUploadCorrectionReview
        if ($null -ne $fresh -and [string]$fresh.confirmationToken -ceq [string]$review.confirmationToken) {
            Append-Log "[$(Get-Date -Format HH:mm:ss)] 已确认 $($review.businessDate) 修正后的 $(@($review.currentFiles).Count) 张照片重新提交一次；正在重新核对。"
            Start-Runner 'photo-upload' $true $completedFlow $false ([string]$review.confirmationToken)
            return $true
        }
        $message = '确认期间照片清单或核对结果发生变化；本次没有重新提交，请再次点击一键处理照片检查。'
    } else {
        $message = '已取消修正照片重新提交；没有再次上传，原照片和旧记录均保留。'
    }
    Write-WorkflowCheckpoint 'photo' 'waiting-review' 'photo-upload' $code
    if ($completedFlow -eq 'backlog-photo') { Restore-BacklogPhotoDate }
    Refresh-AllCards
    $globalStatus.Text = $message
    $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
    return $true
}
function Start-Runner([string]$action, [bool]$authorized, [string]$flow, [bool]$clearLog, [string]$uploadCorrectionToken = '') {
    if ($script:running -or -not (Validate-Root)) { return }
    $correctionArguments = @(Get-UploadCorrectionArguments $action $authorized $uploadCorrectionToken)
    try { $runtime = Find-PrayerNodeRuntime } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message) | Out-Null; return }
    if ($runtime.NodePath) { $env:NODE_PATH = $runtime.NodePath }
    $script:activeAction = $action
    $script:activeFlow = $flow
    $script:activeStartedAtUtc = [DateTime]::UtcNow
    $script:activePhotoBusinessDate = $photoDate.Value.ToString('yyyy-MM-dd')
    $script:activeBusinessRoot = $rootBox.Text.Trim()
    $script:activeCorrectionSubmitted = -not [string]::IsNullOrWhiteSpace($uploadCorrectionToken)
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
    $argsList += $correctionArguments
    if ($flow -eq 'initialize') {
        # 初始化也允许本人完整输入账号、密码和验证码；失效 DPAPI 凭据会
        # 自动降级为手动登录，不再因旧版 5 秒窗口直接终止。
        $argsList += @('--login-timeout-ms','600000')
    }
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $runtime.Node
    $processInfo.Arguments = ($argsList -join ' ')
    $processInfo.WorkingDirectory = $appRoot
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.EnvironmentVariables['NODE_PATH'] = $env:NODE_PATH
    if ($clearLog) {
        Clear-PrayerUiLog
        $script:uiLogLength = 0
        $logBox.Clear()
    } elseif (Test-Path -LiteralPath $script:uiLogPath) {
        $script:uiLogLength = (Get-Content -Raw -Encoding UTF8 -LiteralPath $script:uiLogPath).Length
    }
    $script:activeUiLogOffset = $script:uiLogLength
    $script:activeProcess = New-Object System.Diagnostics.Process
    $script:activeProcess.StartInfo = $processInfo
    Set-Running $true
    $globalStatus.Text = "正在执行：$(Get-ActionLabel $action)。已完成阶段会自动跳过。"
    $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
    Append-Log "[$(Get-Date -Format HH:mm:ss)] 开始：$(Get-ActionLabel $action)"
    if ($action -eq 'photo-manual-prepare') {
        Append-Log "[$(Get-Date -Format HH:mm:ss)] 人工编号模式：不运行 OCR，不读取或比对 PDF；只校验文件名、压缩规格并进入后台上传。"
    } elseif ($action -eq 'photo-prepare' -or $action -eq 'photo-recheck') {
        Append-Log "[$(Get-Date -Format HH:mm:ss)] 本轮仅使用本地 OCR 与 PDF 页面匹配；不会读取 API 密钥、不会上传图片。如仍未决将明确停止，不会改名或上传。"
    }
    [void]$script:activeProcess.Start()
    $script:processTimer.Start()
}
function Start-NextInitialization {
    if ($script:initQueue.Count -eq 0) {
        Refresh-AllCards
        if ($script:initFailures.Count -eq 0) {
            $globalStatus.Text = '初始化完成。照片和 PDF 是两个独立任务；历史未解决业务只在点击检查按钮时查询线上。'
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
    $script:photoAutoStepCount = 0
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
    Clear-PrayerUiLog
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
    $script:photoAutoStepCount += 1
    Start-Runner $script:photoNextAction $true 'photo' $clearLog
}
function Test-PhotoAutoAdvance([string]$completedAction, [string]$nextAction, [int]$stepsCompleted) {
    return (-not [string]::IsNullOrWhiteSpace($nextAction) -and
        $completedAction -ne $nextAction -and $stepsCompleted -lt 4)
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
    $script:backlogAutoStepCount += 1
    Start-Runner $script:photoNextAction $true 'backlog-photo' $clearLog
}
function Complete-Runner([int]$code) {
    $completedAction = $script:activeAction
    $completedFlow = $script:activeFlow
    Set-Running $false
    Refresh-AllCards
    if (Try-ConfirmUploadCorrection $completedAction $completedFlow $code) { return }
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
    if ($completedFlow -eq 'historical-backlog') {
        Refresh-PendingPhotoBar
        if ($code -eq 0) {
            $globalStatus.Text = $pendingStatus.Text
            $globalStatus.ForeColor = $pendingStatus.ForeColor
        } else {
            $globalStatus.Text = '历史未解决业务线上检查失败；没有修改平台，请检查登录或网络后重试。'
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
        }
        return
    }
    if ($completedFlow -eq 'backlog') {
        if ($code -ne 0) {
            $failedDate = $script:backlogBusinessDate
            Restore-BacklogPhotoDate
            $globalStatus.Text = "历史待复核日期 $failedDate 的线上复核失败，已停在【$(Get-ActionLabel $completedAction)】；请检查登录或网络后再次点击复核按钮。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
            return
        }
        if ($completedAction -eq 'photo-online-recheck') {
            $checkedDate = $script:backlogBusinessDate
            $closurePath = Join-Path (Join-Path (Get-WorkdayRoot $checkedDate) 'photos') 'photo-online-closure.json'
            $closure = Read-JsonFile $closurePath
            if ($closure -and $closure.complete -eq $true -and [string]$closure.businessDate -eq $checkedDate) {
                Write-WorkflowCheckpoint 'photo' 'completed' 'photo-online-recheck' 0
                [void](Refresh-PendingPhotoDates)
                Restore-BacklogPhotoDate
                $globalStatus.Text = "历史日期 $checkedDate 已重新核对线上状态：福单、供灯、牌位待办均为 0，已确认闭环并移出待复核列表。"
                $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
                return
            }
            $globalStatus.Text = "历史日期 $checkedDate 线上仍有待办，正在按当前本地清单重新检测并处理；不会沿用旧步骤结论。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
            Start-Runner 'photo-scan' $false 'backlog' $false
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
            $globalStatus.Text = "历史未完成日期 $failedDate 停在【$(Get-ActionLabel $completedAction)】；已保留确定完成的阶段，处理提示项后再次点击【复核线上并处理未完成项】。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
            return
        }
        Write-WorkflowCheckpoint 'photo' 'stage-completed' $completedAction 0
        Refresh-PhotoCard
        if ($script:photoNextAction -eq 'photo-manual-prepare') {
            Write-WorkflowCheckpoint 'photo' 'waiting-supplement' $completedAction 0
            $waitingDate = $script:backlogBusinessDate
            $specificPhotoProblem = $photoStatus.Text
            Restore-BacklogPhotoDate
            $globalStatus.Text = "历史未完成日期 $waitingDate 的确定项目已处理。$specificPhotoProblem 完成后再次点击【复核线上并处理未完成项】。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
            return
        }
        if ($script:photoNextAction -and -not (Test-PhotoAutoAdvance $completedAction $script:photoNextAction $script:backlogAutoStepCount)) {
            Write-WorkflowCheckpoint 'photo' 'waiting-review' $completedAction 0
            $globalStatus.Text = '历史照片步骤没有前进或达到自动续跑上限，已停止重复执行；请核对当前日期状态。'
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
            $currentError = Get-CurrentPhotoError
            if ($currentError) {
                Set-PhotoResult $currentError ([System.Drawing.Color]::DarkRed) $photoProgress.Value '检查照片问题' $photoMainButton.Enabled $script:photoNextAction
            }
            $globalStatus.Text = $photoStatus.Text
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkRed
            Show-PhotoProblemDetails
            return
        }
        Write-WorkflowCheckpoint 'photo' 'stage-completed' $completedAction 0
        Refresh-PhotoCard
        if ($completedAction -eq 'photo-online-recheck') {
            $globalStatus.Text = $photoStatus.Text
            $globalStatus.ForeColor = $photoStatus.ForeColor
            return
        }
        if ($completedAction -eq 'photo-scenes' -and $script:photoNextAction -eq 'photo-online-recheck') {
            Write-WorkflowCheckpoint 'photo' 'waiting-review' $completedAction 0
            $globalStatus.Text = $photoStatus.Text
            $globalStatus.ForeColor = $photoStatus.ForeColor
            return
        }
        if ($script:photoNextAction -eq 'photo-manual-prepare') {
            Write-WorkflowCheckpoint 'photo' 'waiting-supplement' $completedAction 0
            $globalStatus.Text = "现有照片及其已上传订单已分批完成。$($photoStatus.Text)再次点击照片主按钮只处理新增图片和剩余订单。"
            $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
            return
        }
        if ($script:photoNextAction -and -not (Test-PhotoAutoAdvance $completedAction $script:photoNextAction $script:photoAutoStepCount)) {
            Write-WorkflowCheckpoint 'photo' 'waiting-review' $completedAction 0
            $globalStatus.Text = "照片步骤【$(Get-ActionLabel $completedAction)】没有前进或达到自动续跑上限，已停止重复执行。$($photoStatus.Text)"
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
        $script:photoAutoStepCount = 0
        Clear-PrayerUiLog
        $script:uiLogLength = 0; $logBox.Clear()
        Continue-PhotoFlow $false
    }
})
$pendingProcessButton.Add_Click({
    if ($script:running) { return }
    $globalStatus.Text = '正在查询今天以前的历史未解决业务：待祈福，以及祈福中但尚未上传照片；今天的数据不计入。'
    $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
    Start-Runner 'historical-backlog-check' $false 'historical-backlog' $true
})
$script:availabilityTimer.Add_Tick({
    try { Refresh-LocalAvailability } catch {
        $globalStatus.Text = "本地状态自动刷新失败：$($_.Exception.Message)；可点击【刷新照片和PDF状态】重试。"
        $globalStatus.ForeColor = [System.Drawing.Color]::DarkOrange
    }
})
$pdfMainButton.Add_Click({
    if (-not $script:running) {
        Start-Runner $script:pdfNextAction $true 'pdf' $true
    }
})
$refreshAllButton.Add_Click({ Start-Initialization 'all' })
$refreshLocalButton.Add_Click({
    Refresh-LocalAvailability $true
    $globalStatus.Text = '已重新检查照片目录和北京时间；照片与 PDF 按钮状态已更新。'
    $globalStatus.ForeColor = [System.Drawing.Color]::DarkBlue
})

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

$manualPhotoPrepare.Add_Click({ Start-Runner 'photo-manual-prepare' $true 'manual' $true })
$manualPhotoScan.Add_Click({ Start-Runner 'photo-scan' $false 'manual' $true })
$manualPhotoUpload.Add_Click({ Start-Runner 'photo-upload' $true 'manual' $true })
$manualSceneUpload.Add_Click({ Start-Runner 'photo-scenes' $true 'manual' $true })
$manualPdfInspect.Add_Click({ Start-Runner 'inspect' $false 'manual' $true })
$manualPdfExport.Add_Click({ Start-Runner 'export' $true 'manual' $true })
$manualState.Add_Click({ Start-Runner 'state-change' $true 'manual' $true })
$credentialButton.Add_Click({ if (-not $script:running) { Show-PrayerCredentialDialog } })
$clearCredentialButton.Add_Click({
    if ($script:running -or -not (Test-Path -LiteralPath $script:credentialPath -PathType Leaf)) { return }
    $answer = [System.Windows.Forms.MessageBox]::Show('确定清除本机自动登录凭据吗？清除后需要手动登录或重新设置。','清除自动登录凭据','YesNo','Warning')
    if ($answer -eq 'Yes') {
        Remove-PrayerCredential -Path $script:credentialPath
        Update-CredentialButtons
        $globalStatus.Text = '本机自动登录凭据已清除。'
        $globalStatus.ForeColor = [System.Drawing.Color]::DarkGreen
    }
})

$photoDate.Add_ValueChanged({
    if (-not $script:running) {
        Save-Settings
        Start-Initialization 'photo'
    }
})
$pdfDate.Add_ValueChanged({
    if (-not $script:running) {
        Save-Settings
        Start-Initialization 'pdf'
    }
})
$form.Add_FormClosing({
    param($sender,$eventArgs)
    $script:availabilityTimer.Stop()
    if ($script:running) {
        $answer = [System.Windows.Forms.MessageBox]::Show('任务仍在运行。关闭窗口会中断当前步骤，但已完成阶段仍可续跑。确定关闭吗？','任务运行中','YesNo','Warning')
        if ($answer -ne 'Yes') { $eventArgs.Cancel = $true }
    }
    if (-not $eventArgs.Cancel) { Save-Settings }
})
$form.Add_Shown({
    Update-CredentialButtons
    if ($env:PRAYER_UI_SMOKE_TEST -eq 'yes') { $form.Close() }
    else { $script:availabilityTimer.Start(); Start-Initialization 'all' }
})
try {
    # State tests exercise the constructed controls without a desktop message
    # loop, credential dialogs, real initialization or writes to user settings.
    if (-not $script:isUiSmokeTest) { [void]$form.ShowDialog() }
} finally {
    Exit-PrayerSingleInstance $script:singleInstance
}
