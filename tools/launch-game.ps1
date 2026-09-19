param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$gameUrl = 'http://127.0.0.1:4173/'
$runtimeDir = Join-Path $projectRoot 'runtime'

function Test-GameReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $gameUrl -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match '<title>'
  } catch {
    return $false
  }
}

if (-not (Test-GameReady)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js was not found. Install Node.js 20 or newer.'
  }

  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  $stdout = Join-Path $runtimeDir 'server.stdout.log'
  $stderr = Join-Path $runtimeDir 'server.stderr.log'
  $process = Start-Process -FilePath $node.Source -ArgumentList 'server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Set-Content -LiteralPath (Join-Path $runtimeDir 'server.pid') -Value $process.Id -Encoding ascii

  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-GameReady) { $ready = $true; break }
    if ($process.HasExited) { break }
  }
  if (-not $ready) {
    throw "The local game server did not start. Check $stderr"
  }
}

if (-not $NoBrowser) {
  Start-Process $gameUrl
}

Write-Host 'Mist Lantern is ready.' -ForegroundColor Green
