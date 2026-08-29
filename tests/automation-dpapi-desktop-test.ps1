$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ui\AutomationCredentialStore.ps1')

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('prayer-automation-dpapi-' + [Guid]::NewGuid().ToString('N'))
$credentialPath = Join-Path $testRoot 'secure-automation.dat'
$baseUrl = 'https://automation.example.test'
$clientId = 'prayer-local-test'
$secret = '0123456789abcdef0123456789abcdef'

try {
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    Save-AutomationCredential -Path $credentialPath -BaseUrl $baseUrl -ClientId $clientId -Secret $secret
    $raw = Get-Content -Raw -LiteralPath $credentialPath
    if ($raw.Contains($baseUrl) -or $raw.Contains($clientId) -or $raw.Contains($secret)) {
        throw 'Automation credential file contains plaintext.'
    }
    $roundTrip = Read-AutomationCredential -Path $credentialPath
    if ($roundTrip.BaseUrl -ne $baseUrl -or $roundTrip.ClientId -ne $clientId -or $roundTrip.Secret -ne $secret) {
        throw 'Automation DPAPI round-trip mismatch.'
    }
    Remove-AutomationCredential -Path $credentialPath
    if (Test-Path -LiteralPath $credentialPath) { throw 'Automation credential file was not removed.' }
    Write-Output 'Automation DPAPI desktop round-trip passed.'
} finally {
    $roundTrip = $null
    $secret = $null
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

