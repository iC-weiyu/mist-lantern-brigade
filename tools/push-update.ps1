# 维护者专用：把本地提交推送到 GitHub（雾灯旅团）。
# 依次尝试「默认设置 → OpenSSL 加密后端 → OpenSSL + 不走本机代理」三种连接方式。
# 只推送当前分支；功能分支通过 Pull Request 合入 main，不在脚本中移动本地或远端 main。
# 用法：双击同目录下的「【维护者】推送更新到GitHub.cmd」，或在 PowerShell 里执行本文件。

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$repoUrl = 'https://github.com/iC-weiyu/mist-lantern-brigade'

function Say { param([string]$Text, [string]$Color = 'Gray') Write-Host $Text -ForegroundColor $Color }

Set-Location -LiteralPath $projectRoot
Say '雾灯旅团 · 维护者推送工具' 'Cyan'
Say ''

git rev-parse --verify HEAD *> $null
if ($LASTEXITCODE -ne 0) {
  Say '当前目录不是 Git 仓库，无法推送。' 'Red'
  exit 1
}

$current = (git rev-parse --abbrev-ref HEAD).Trim()
if (-not $current -or $current -eq 'HEAD') {
  Say '当前处于 detached HEAD，请先切换到明确分支。' 'Red'
  exit 1
}
$branch = $current
$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0) {
  Say '工作区仍有未提交改动，为避免漏传或错传，本次停止。' 'Red'
  $dirty | ForEach-Object { Say ('  ' + $_) 'Yellow' }
  exit 1
}
Say ('当前分支：' + $current)
Say ''

$attempts = @(
  @{ Name = '默认设置'; Options = @() },
  @{ Name = 'OpenSSL 加密后端'; Options = @('-c', 'http.sslBackend=openssl') },
  @{ Name = 'OpenSSL + 直连（不走本机代理）'; Options = @('-c', 'http.sslBackend=openssl', '-c', 'http.proxy=') }
)

$pushed = $false
foreach ($attempt in $attempts) {
  Say ('尝试推送（' + $attempt.Name + '）……')
  $arguments = @()
  $arguments += $attempt.Options
  $arguments += @('push', '-u', 'origin', $branch)
  & git @arguments
  if ($LASTEXITCODE -eq 0) { $pushed = $true; Say ('推送成功（' + $attempt.Name + '）。') 'Green'; break }
  Say '这一种没成功，换下一种。' 'DarkYellow'
}

if (-not $pushed) {
  Say ''
  Say '三种方式都没能推送成功。' 'Red'
  Say '· 若弹出 GitHub 登录窗口，请先完成登录再重试。' 'Yellow'
  Say '· 若提示网络错误，请确认代理软件正在运行，或换一种网络后重试。' 'Yellow'
  Say ('· 也可以手动执行：git push -u origin ' + $branch) 'Yellow'
  exit 1
}

Say ''
Say ('分支已推送：' + $branch) 'Green'
if ($branch -ne 'main') {
  Say '下一步请通过 Pull Request 检查并合入 main：' 'Cyan'
  Say ($repoUrl + '/compare/main...' + $branch + '?expand=1') 'Cyan'
}
Say ('仓库地址：' + $repoUrl) 'Cyan'
