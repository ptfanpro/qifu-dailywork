$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ui\SecureCredentialStore.ps1')

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('prayer-dpapi-' + [Guid]::NewGuid().ToString('N'))
$credentialPath = Join-Path $testRoot 'secure-login.dat'
$username = 'dpapi-test-user'
$password = 'dpapi-test-password'

try {
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    Save-PrayerCredential -Path $credentialPath -Username $username -Password $password
    $raw = Get-Content -Raw -LiteralPath $credentialPath
    if ($raw.Contains($username) -or $raw.Contains($password)) {
        throw 'Credential file contains plaintext.'
    }
    $roundTrip = Read-PrayerCredential -Path $credentialPath
    if ($roundTrip.Username -ne $username -or $roundTrip.Password -ne $password) {
        throw 'DPAPI round-trip mismatch.'
    }
    Remove-PrayerCredential -Path $credentialPath
    if (Test-Path -LiteralPath $credentialPath) {
        throw 'Credential file was not removed.'
    }
    Write-Output 'DPAPI desktop round-trip passed.'
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
