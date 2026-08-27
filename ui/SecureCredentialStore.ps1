$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Get-PrayerCredentialEntropy {
    return [Text.Encoding]::UTF8.GetBytes('stqifu-prayer-dailywork-v1')
}

function Protect-PrayerCredentialFile([string]$Path) {
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
        # DPAPI already binds ciphertext to the current Windows user.
    }
}

function Save-PrayerCredential([string]$Path, [string]$Username, [string]$Password) {
    if ([string]::IsNullOrWhiteSpace($Username)) { throw 'Username is required.' }
    if ([string]::IsNullOrWhiteSpace($Password)) { throw 'Password is required.' }
    $folder = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $plain = [ordered]@{
        schemaVersion = 1
        username = $Username.Trim()
        password = $Password
    } | ConvertTo-Json -Compress
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($plain)
    try {
        $cipherBytes = [Security.Cryptography.ProtectedData]::Protect(
            $plainBytes,
            (Get-PrayerCredentialEntropy),
            [Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $encoded = [Convert]::ToBase64String($cipherBytes)
        $temp = Join-Path $folder ('.' + [IO.Path]::GetFileName($Path) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::WriteAllText($temp,$encoded,(New-Object Text.UTF8Encoding -ArgumentList $false))
        try { Move-Item -LiteralPath $temp -Destination $Path -Force }
        finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
        Protect-PrayerCredentialFile -Path $Path
    } finally {
        if ($plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length) }
        $plain = $null
        $Password = $null
    }
}

function Read-PrayerCredential([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $cipherBytes = [Convert]::FromBase64String(([IO.File]::ReadAllText($Path)).Trim())
    $plainBytes = $null
    try {
        $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $cipherBytes,
            (Get-PrayerCredentialEntropy),
            [Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $value = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace([string]$value.username) -or [string]::IsNullOrWhiteSpace([string]$value.password)) {
            throw 'Stored credential is incomplete.'
        }
        return [pscustomobject]@{ Username=[string]$value.username; Password=[string]$value.password }
    } catch {
        throw 'Stored credential cannot be decrypted for the current Windows user.'
    } finally {
        if ($plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length) }
        if ($cipherBytes) { [Array]::Clear($cipherBytes,0,$cipherBytes.Length) }
    }
}

function Test-PrayerCredential([string]$Path) {
    try {
        $credential = Read-PrayerCredential -Path $Path
        return $null -ne $credential
    } catch {
        return $false
    } finally {
        $credential = $null
    }
}

function Remove-PrayerCredential([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Remove-Item -LiteralPath $Path -Force
    }
}
