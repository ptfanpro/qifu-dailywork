param(
    [Parameter(Mandatory = $true)]
    [string]$InputListPath,
    [switch]$IncludeRegions
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
    $bitmap = $null
    $fullPath = [string]$inputPath
    try {
        $fullPath = [IO.Path]::GetFullPath($inputPath)
        $file = Await-WinRt ($storageFileType::GetFileFromPathAsync($fullPath)) $storageFileType
        $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) $streamType
        $decoder = Await-WinRt ($decoderType::CreateAsync($stream)) $decoderType
        $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) $bitmapType
        $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) $resultType
        $record = [ordered]@{ path = $fullPath; text = [string]$result.Text; status = 'ok' }
        if ($IncludeRegions) {
            $record.width = $bitmap.PixelWidth
            $record.height = $bitmap.PixelHeight
            $record.lines = @($result.Lines | ForEach-Object {
                [PSCustomObject]@{
                    text = [string]$_.Text
                    words = @($_.Words | ForEach-Object {
                        [PSCustomObject]@{ text = [string]$_.Text; x = $_.BoundingRect.X; y = $_.BoundingRect.Y; width = $_.BoundingRect.Width; height = $_.BoundingRect.Height }
                    })
                }
            })
        }
        [PSCustomObject]$record | ConvertTo-Json -Depth 6 -Compress
    } catch {
        # A corrupt/locked image must not erase successful OCR for other files.
        # No exception text: it may contain user paths or recognized content.
        [PSCustomObject]@{ path = $fullPath; text = ''; status = 'error'; reason = 'image-ocr-failed' } | ConvertTo-Json -Compress
    } finally {
        if ($bitmap) { $bitmap.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
}
