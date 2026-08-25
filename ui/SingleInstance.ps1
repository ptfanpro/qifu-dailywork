function Enter-PrayerSingleInstance {
    [CmdletBinding()]
    param(
        [string]$Name = 'Local\PrayerDailyWorkflowV9'
    )

    $mutex = New-Object System.Threading.Mutex($false, $Name)
    $ownsLock = $false
    try {
        $ownsLock = $mutex.WaitOne(0, $false)
    } catch [System.Threading.AbandonedMutexException] {
        $ownsLock = $true
    }

    [pscustomobject]@{
        Name = $Name
        Mutex = $mutex
        OwnsLock = $ownsLock
    }
}

function Exit-PrayerSingleInstance($instance) {
    if ($null -eq $instance) { return }
    if ($instance.OwnsLock -and $null -ne $instance.Mutex) {
        try { $instance.Mutex.ReleaseMutex() } catch [System.ApplicationException] {}
    }
    if ($null -ne $instance.Mutex) {
        try { $instance.Mutex.Dispose() } catch {}
    }
}
