param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'SecureCredentialStore.ps1')

try {
    $credential = Read-PrayerCredential -Path $Path
    if ($null -eq $credential) { exit 3 }
    [ordered]@{
        usernameBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential.Username))
        passwordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential.Password))
    } | ConvertTo-Json -Compress
} finally {
    $credential = $null
}
