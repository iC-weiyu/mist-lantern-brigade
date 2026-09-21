param(
  [switch]$NoBrowser,
  [switch]$NoShortcut,
  [string]$ShortcutDir
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$gameUrl = 'http://127.0.0.1:4173/'
$runtimeDir = Join-Path $projectRoot 'runtime'
$minNodeMajor = 20
$launcher = Join-Path $projectRoot '【双击启动】雾灯旅团.cmd'
$iconFile = Join-Path $projectRoot 'public\favicon.ico'

function Test-GameReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $gameUrl -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match '<title>'
  } catch {
    return $false
  }
}

function Show-Problem {
  param([string]$Message, [string[]]$Details)
  Write-Host ''
  Write-Host $Message -ForegroundColor Red
  foreach ($line in $Details) { Write-Host ('  ' + $line) -ForegroundColor Yellow }
  Write-Host ''
  exit 1
}

# 从网上下载的 ZIP 会给文件打上“来自其他计算机”的标记，双击时可能被系统拦下。
# 这里先把运行需要的文件解除锁定，别人下载解压后就能直接双击进来。
Get-ChildItem -LiteralPath $projectRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Extension -in '.cmd', '.ps1', '.mjs', '.js', '.css', '.html', '.json', '.jpg', '.mp3' } |
  Unblock-File -ErrorAction SilentlyContinue

if (-not (Test-GameReady)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Show-Problem '没有找到 Node.js，游戏无法启动。' @(
      '请先安装 Node.js 20 或更高版本：https://nodejs.org/zh-cn/download',
      '安装时保持默认选项即可，装完重新双击本文件。'
    )
  }

  $nodeVersion = (& $node.Source --version 2>$null)
  if ($nodeVersion) {
    $nodeVersion = $nodeVersion.Trim() -replace '^v', ''
    $nodeMajor = 0
    [void][int]::TryParse(($nodeVersion -split '\.')[0], [ref]$nodeMajor)
    if ($nodeMajor -gt 0 -and $nodeMajor -lt $minNodeMajor) {
      Show-Problem ('Node.js 版本过低：当前 ' + $nodeVersion + '，需要 ' + $minNodeMajor + ' 或更高。') @(
        '请到 https://nodejs.org/zh-cn/download 安装新版本后重新双击本文件。'
      )
    }
  }

  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  $stdout = Join-Path $runtimeDir 'server.stdout.log'
  $stderr = Join-Path $runtimeDir 'server.stderr.log'
  $process = Start-Process -FilePath $node.Source -ArgumentList 'server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Set-Content -LiteralPath (Join-Path $runtimeDir 'server.pid') -Value $process.Id -Encoding ascii

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-GameReady) { $ready = $true; break }
    if ($process.HasExited) { break }
  }

  if (-not $ready) {
    $tail = @('日志文件：' + $stderr)
    if (Test-Path $stderr) {
      $lines = Get-Content -LiteralPath $stderr -Tail 8 -ErrorAction SilentlyContinue
      if ($lines) { $tail += $lines }
    }
    Show-Problem '本地服务没有启动成功。' $tail
  }
}

if (-not $NoBrowser) { Start-Process $gameUrl }

# 桌面快捷方式：带游戏图标，双击即进。
# · 没有同名快捷方式 → 建一个；
# · 已有且指向本启动器 → 只刷新图标；
# · 已有但指向别的程序 → 一律不动，只提示。
# 不想要可以删掉，或加 -NoShortcut 参数跳过。
$shortcutCreated = $false
$shortcutKept = $false
if (-not $NoShortcut) {
  try {
    $desktop = $ShortcutDir
    if (-not $desktop) { $desktop = [Environment]::GetFolderPath('Desktop') }
    if ($desktop -and (Test-Path -LiteralPath $desktop) -and (Test-Path -LiteralPath $launcher)) {
      $link = Join-Path $desktop '雾灯旅团.lnk'
      $shell = New-Object -ComObject WScript.Shell
      $existingTarget = ''
      if (Test-Path -LiteralPath $link) {
        try { $existingTarget = $shell.CreateShortcut($link).TargetPath } catch { $existingTarget = '' }
      }
      if ($existingTarget -and ($existingTarget -ne $launcher)) {
        $shortcutKept = $true
      } else {
        $shortcut = $shell.CreateShortcut($link)
        $shortcut.TargetPath = $launcher
        $shortcut.WorkingDirectory = $projectRoot
        $shortcut.Description = '雾灯旅团 · 双击启动本地游戏'
        if (Test-Path -LiteralPath $iconFile) { $shortcut.IconLocation = $iconFile + ',0' }
        $shortcut.Save()
        $shortcutCreated = $true
      }
    }
  } catch {
    Write-Host ('桌面快捷方式创建失败（不影响游戏）：' + $_.Exception.Message) -ForegroundColor DarkYellow
  }
}

Write-Host '雾灯旅团已就绪，浏览器会自动打开游戏页面。' -ForegroundColor Green
Write-Host '再次双击本文件不会重复启动服务，只会打开页面。' -ForegroundColor DarkGray
Write-Host '关闭这个窗口不会停止游戏；要停止服务请在任务管理器里结束 node.exe。' -ForegroundColor DarkGray
if ($shortcutCreated) {
  Write-Host '桌面「雾灯旅团」快捷方式已就绪（带游戏图标），不喜欢可以直接删掉。' -ForegroundColor DarkGray
}
if ($shortcutKept) {
  Write-Host '桌面已有指向其他程序的「雾灯旅团」快捷方式，本次没有改动它。' -ForegroundColor DarkYellow
}
Start-Sleep -Seconds 2
