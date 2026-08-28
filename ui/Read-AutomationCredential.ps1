param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'AutomationCredentialStore.ps1')

try {
    $credential = Read-AutomationCredential -Path $Path
    if ($null -eq $credential) { exit 3 }
    [ordered]@{
        baseUrlBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential.BaseUrl))
        clientIdBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential.ClientId))
        secretBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential.Secret))
    } | ConvertTo-Json -Compress
} finally {
    $credential = $null
}

