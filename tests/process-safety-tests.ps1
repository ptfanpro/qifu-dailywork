$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$singleInstanceHelper = Join-Path $root 'ui\SingleInstance.ps1'
$settingsHelper = Join-Path $root 'ui\SettingsStore.ps1'
$credentialHelper = Join-Path $root 'ui\SecureCredentialStore.ps1'
$automationCredentialHelper = Join-Path $root 'ui\AutomationCredentialStore.ps1'
. $singleInstanceHelper
. $settingsHelper
. $credentialHelper
. $automationCredentialHelper

function Assert-True($value, [string]$message) {
    if (-not $value) { throw $message }
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('prayer-process-safety-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
try {
    $mutexName = 'Local\PrayerDailyWorkflowV9-Test-' + [Guid]::NewGuid().ToString('N')
    $owner = Enter-PrayerSingleInstance -Name $mutexName
    Assert-True $owner.OwnsLock '第一个进程必须取得单实例锁'

    $mutexResult = Join-Path $testRoot 'mutex-result.txt'
    $mutexProbe = Join-Path $testRoot 'mutex-probe.ps1'
    $escapedHelper = $singleInstanceHelper
    $escapedResult = $mutexResult
    $escapedName = $mutexName
    $mutexProbeText = @(
        '$ErrorActionPreference = ''Stop'''
        '. ''__HELPER__'''
        '$probe = Enter-PrayerSingleInstance -Name ''__NAME__'''
        '[System.IO.File]::WriteAllText(''__RESULT__'', [string]$probe.OwnsLock)'
        'Exit-PrayerSingleInstance $probe'
    ) -join [Environment]::NewLine
    $mutexProbeText = $mutexProbeText.Replace('__HELPER__',$escapedHelper).Replace('__NAME__',$escapedName).Replace('__RESULT__',$escapedResult)
    $mutexProbeText | Set-Content -LiteralPath $mutexProbe -Encoding UTF8
    $mutexProbeEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($mutexProbeText))
    $probeProcess = Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $mutexProbeEncoded" -WindowStyle Hidden -Wait -PassThru
    Assert-True ($probeProcess.ExitCode -eq 0) '单实例探针进程执行失败'
    Assert-True ((Get-Content -LiteralPath $mutexResult -Raw).Trim() -eq 'False') '第二个进程不应取得单实例锁'
    Exit-PrayerSingleInstance $owner
    $owner = $null

    $settingsPath = Join-Path $testRoot 'settings.json'
    [System.IO.File]::WriteAllText($settingsPath, '{"businessRoot":"old"}')
    $lock = [System.IO.File]::Open($settingsPath,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
    $writeResult = Join-Path $testRoot 'settings-result.txt'
    $writeReady = Join-Path $testRoot 'settings-ready.txt'
    $writeProbe = Join-Path $testRoot 'settings-probe.ps1'
    $escapedSettingsHelper = $settingsHelper
    $escapedSettingsPath = $settingsPath
    $escapedWriteResult = $writeResult
    $escapedWriteReady = $writeReady
    $writeProbeText = @(
        '$ErrorActionPreference = ''Stop'''
        '. ''__HELPER__'''
        '[System.IO.File]::WriteAllText(''__READY__'', ''ready'')'
        'try {'
        '    Write-PrayerAtomicJson -Path ''__SETTINGS__'' -Value @{ businessRoot = ''new'' } -MaxAttempts 40 -RetryDelayMilliseconds 50'
        '    [System.IO.File]::WriteAllText(''__RESULT__'', ''success'')'
        '} catch {'
        '    [System.IO.File]::WriteAllText(''__RESULT__'', ''failed:'' + $_.Exception.Message)'
        '    exit 1'
        '}'
    ) -join [Environment]::NewLine
    $writeProbeText = $writeProbeText.Replace('__HELPER__',$escapedSettingsHelper).Replace('__READY__',$escapedWriteReady).Replace('__SETTINGS__',$escapedSettingsPath).Replace('__RESULT__',$escapedWriteResult)
    $writeProbeText | Set-Content -LiteralPath $writeProbe -Encoding UTF8
    $writeProbeEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($writeProbeText))
    $writer = Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $writeProbeEncoded" -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $writeReady)) {
        if ([DateTime]::UtcNow -ge $deadline) { throw '配置写入探针未及时启动' }
        Start-Sleep -Milliseconds 50
    }
    Start-Sleep -Milliseconds 250
    $lock.Dispose()
    $lock = $null
    $writer.WaitForExit()
    $writerResult = if (Test-Path -LiteralPath $writeResult) { (Get-Content -LiteralPath $writeResult -Raw).Trim() } else { 'missing-result' }
    Assert-True ($writer.ExitCode -eq 0) "配置文件重试写入进程失败：$writerResult"
    Assert-True ($writerResult -eq 'success') '配置文件占用释放后没有写入成功'
    $saved = Get-Content -LiteralPath $settingsPath -Encoding UTF8 -Raw | ConvertFrom-Json
    Assert-True ($saved.businessRoot -eq 'new') '原子写入后的配置内容错误'
    Assert-True (@(Get-ChildItem -LiteralPath $testRoot -Filter '.settings.json.*.tmp' -File).Count -eq 0) '配置临时文件没有清理'

    $credentialPath = Join-Path $testRoot 'secure-login.dat'
    try {
        Save-PrayerCredential -Path $credentialPath -Username 'regression-user' -Password 'regression-password'
        Assert-True (Test-Path -LiteralPath $credentialPath -PathType Leaf) '加密凭据文件没有建立'
        $rawCredential = Get-Content -Raw -LiteralPath $credentialPath
        Assert-True ($rawCredential -notmatch 'regression-user|regression-password') '凭据文件泄漏了账号或密码明文'
        $roundTrip = Read-PrayerCredential -Path $credentialPath
        Assert-True ($roundTrip.Username -eq 'regression-user') '加密凭据账号回读错误'
        Assert-True ($roundTrip.Password -eq 'regression-password') '加密凭据密码回读错误'
        Remove-PrayerCredential -Path $credentialPath
        Assert-True (-not (Test-Path -LiteralPath $credentialPath)) '清除凭据后文件仍存在'
    } catch {
        if ($_.Exception.Message -match 'user profile loaded|data protection operation was unsuccessful') {
            Write-Output 'DPAPI round-trip skipped in impersonated test sandbox; elevated desktop test is still required.'
        } else { throw }
    } finally {
        $roundTrip = $null
    }

    $automationCredentialPath = Join-Path $testRoot 'secure-automation.dat'
    $automationSecret = 'regression-machine-secret-at-least-32-bytes'
    try {
        Save-AutomationCredential -Path $automationCredentialPath -BaseUrl 'https://automation.example.test' -ClientId 'prayer-test' -Secret $automationSecret
        Assert-True (Test-Path -LiteralPath $automationCredentialPath -PathType Leaf) '机器接口加密凭据文件没有建立'
        $rawAutomationCredential = Get-Content -Raw -LiteralPath $automationCredentialPath
        Assert-True ($rawAutomationCredential -notmatch 'automation\.example|prayer-test|regression-machine') '机器接口凭据文件泄漏了明文'
        $automationRoundTrip = Read-AutomationCredential -Path $automationCredentialPath
        Assert-True ($automationRoundTrip.BaseUrl -eq 'https://automation.example.test') '机器接口地址回读错误'
        Assert-True ($automationRoundTrip.ClientId -eq 'prayer-test') '机器接口客户端编号回读错误'
        Assert-True ($automationRoundTrip.Secret -eq $automationSecret) '机器接口密钥回读错误'
        Remove-AutomationCredential -Path $automationCredentialPath
        Assert-True (-not (Test-Path -LiteralPath $automationCredentialPath)) '清除机器接口凭据后文件仍存在'
    } catch {
        if ($_.Exception.Message -match 'user profile loaded|data protection operation was unsuccessful|current Windows user') {
            Write-Output 'Automation DPAPI round-trip skipped in impersonated test sandbox.'
        } else { throw }
    } finally {
        $automationRoundTrip = $null
        $automationSecret = $null
    }

    'Process safety tests passed'
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
    if ($null -ne $owner) { Exit-PrayerSingleInstance $owner }
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
