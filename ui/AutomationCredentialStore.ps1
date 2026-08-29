$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Get-AutomationCredentialEntropy {
    return [Text.Encoding]::UTF8.GetBytes('stqifu-prayer-dailywork-automation-v1')
}

function Protect-AutomationCredentialFile([string]$Path) {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $acl = New-Object Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true,$false)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $identity,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.SetAccessRule($rule)
        Set-Acl -LiteralPath $Path -AclObject $acl
    } catch {
        # DPAPI still binds the ciphertext to the current Windows user.
    }
}

function Assert-AutomationBaseUrl([string]$BaseUrl) {
    $uri = $null
    if (-not [Uri]::TryCreate($BaseUrl,[UriKind]::Absolute,[ref]$uri)) { throw 'Service URL is invalid.' }
    $local = $uri.Host -in @('127.0.0.1','localhost','::1')
    if ($uri.Scheme -ne 'https' -and -not ($local -and $uri.Scheme -eq 'http')) { throw 'Service URL must use HTTPS.' }
    if (-not [string]::IsNullOrEmpty($uri.UserInfo) -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) { throw 'Service URL contains unsupported fields.' }
}

function Save-AutomationCredential([string]$Path, [string]$BaseUrl, [string]$ClientId, [string]$Secret) {
    Assert-AutomationBaseUrl $BaseUrl
    if ($ClientId -notmatch '^[A-Za-z0-9_-]{3,64}$') { throw 'Client ID is invalid.' }
    $secretLength = [Text.Encoding]::UTF8.GetByteCount($Secret)
    if ($secretLength -lt 32 -or $secretLength -gt 256) { throw 'Machine secret is invalid.' }
    $folder = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $plain = [ordered]@{ schemaVersion=1; baseUrl=$BaseUrl.TrimEnd('/'); clientId=$ClientId; secret=$Secret } | ConvertTo-Json -Compress
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($plain)
    try {
        $cipherBytes = [Security.Cryptography.ProtectedData]::Protect($plainBytes,(Get-AutomationCredentialEntropy),[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $encoded = [Convert]::ToBase64String($cipherBytes)
        $temp = Join-Path $folder ('.' + [IO.Path]::GetFileName($Path) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::WriteAllText($temp,$encoded,(New-Object Text.UTF8Encoding -ArgumentList $false))
        try { Move-Item -LiteralPath $temp -Destination $Path -Force }
        finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
        Protect-AutomationCredentialFile $Path
    } finally {
        if ($plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length) }
        if ($cipherBytes) { [Array]::Clear($cipherBytes,0,$cipherBytes.Length) }
        $plain = $null
        $Secret = $null
    }
}

function Read-AutomationCredential([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $cipherBytes = [Convert]::FromBase64String(([IO.File]::ReadAllText($Path)).Trim())
    $plainBytes = $null
    try {
        $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect($cipherBytes,(Get-AutomationCredentialEntropy),[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $value = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
        Assert-AutomationBaseUrl ([string]$value.baseUrl)
        if ([string]$value.clientId -notmatch '^[A-Za-z0-9_-]{3,64}$') { throw 'Stored client ID is invalid.' }
        $secretLength = [Text.Encoding]::UTF8.GetByteCount([string]$value.secret)
        if ($secretLength -lt 32 -or $secretLength -gt 256) { throw 'Stored machine secret is invalid.' }
        return [pscustomobject]@{ BaseUrl=[string]$value.baseUrl; ClientId=[string]$value.clientId; Secret=[string]$value.secret }
    } catch {
        throw 'Stored automation credential cannot be decrypted for the current Windows user.'
    } finally {
        if ($plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length) }
        if ($cipherBytes) { [Array]::Clear($cipherBytes,0,$cipherBytes.Length) }
    }
}

function Test-AutomationCredential([string]$Path) {
    try { return $null -ne (Read-AutomationCredential -Path $Path) }
    catch { return $false }
}

function Remove-AutomationCredential([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { Remove-Item -LiteralPath $Path -Force }
}

