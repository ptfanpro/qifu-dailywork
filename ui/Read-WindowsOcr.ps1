param(
    [Parameter(Mandatory = $true)]
    [string]$InputListPath
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$InputPaths = @(Get-Content -LiteralPath $InputListPath -Encoding utf8 | Where-Object { $_.Trim() })
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.ToString() -match 'IAsyncOperation'
    } |
    Select-Object -First 1

function Await-WinRt($operation, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}

$storageFileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$streamType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$bitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$resultType = [Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'Windows OCR engine is unavailable.' }

foreach ($inputPath in $InputPaths) {
    $file = $null
    $stream = $null
    try {
        $fullPath = [IO.Path]::GetFullPath($inputPath)
        $file = Await-WinRt ($storageFileType::GetFileFromPathAsync($fullPath)) $storageFileType
        $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) $streamType
        $decoder = Await-WinRt ($decoderType::CreateAsync($stream)) $decoderType
        $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) $bitmapType
        $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) $resultType
        [PSCustomObject]@{ path = $fullPath; text = [string]$result.Text } | ConvertTo-Json -Compress
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}
