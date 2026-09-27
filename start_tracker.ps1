# Starts the hand tracker and AI service with the settings in .env.
#   .\start_tracker.ps1                   run src/main.py
#   .\start_tracker.ps1 -Check            test the Gemini key with one camera frame
#   .\start_tracker.ps1 -Check photo.jpg  test the Gemini key with a photo
# Values from .env apply only to the program started here, not to the terminal or Windows.
param(
    [switch]$Check,
    [string]$Photo
)

$root = $PSScriptRoot
$envFile = Join-Path $root ".env"
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $envFile)) {
    Write-Host "No .env file. Copy .env.example to .env and add your GEMINI_API_KEY." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $python)) {
    Write-Host "No .venv found. Create it and run: .venv\Scripts\python -m pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}

# The script runs inside the terminal's own process, so earlier values are restored on exit.
$previous = @{}
foreach ($line in Get-Content $envFile) {
    $text = $line.Trim()
    if (-not $text -or $text.StartsWith("#") -or -not $text.Contains("=")) { continue }
    $name, $value = $text.Split("=", 2)
    $name = $name.Trim()
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $value.Trim().Trim('"').Trim("'"), "Process")
}

if (-not $env:GEMINI_API_KEY -or $env:GEMINI_API_KEY -eq "paste-your-key-here") {
    # The placeholder is treated as no key, so nothing is sent to Google with it.
    $env:GEMINI_API_KEY = $null
    Write-Host "GEMINI_API_KEY in .env is still the placeholder. Explore Object will show 'not configured'." -ForegroundColor Yellow
}

Push-Location $root
try {
    if ($Check) {
        if ($Photo) { & $python tools\gemini_check.py $Photo } else { & $python tools\gemini_check.py }
    } else {
        & $python src\main.py
    }
} finally {
    Pop-Location
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process") }
}
