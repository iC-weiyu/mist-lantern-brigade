# 维护者专用：把本地提交推送到 GitHub（雾灯旅团）。
# 依次尝试「默认设置 → OpenSSL 加密后端 → OpenSSL + 不走本机代理」三种连接方式，
# 推送成功后，若远程 main 还是本次提交的祖先，就把 main 一起快进更新（绝不做强制覆盖）。
# 用法：双击同目录下的「【维护者】推送更新到GitHub.cmd」，或在 PowerShell 里执行本文件。

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$repoUrl = 'https://github.com/iC-weiyu/mist-lantern-brigade'
$branch = 'feature/title-screen-and-audio'

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
git rev-parse --verify --quiet $branch *> $null
if ($LASTEXITCODE -ne 0) { $branch = $current }
Say ('当前分支：' + $current)
Say ('待推送分支：' + $branch)
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
Say '检查是否可以把远程 main 快进到本次提交……'
& git fetch origin
if ($LASTEXITCODE -ne 0) {
  Say '获取远程状态失败，已跳过 main 更新；分支已推送成功。' 'Yellow'
  exit 0
}

& git merge-base --is-ancestor 'origin/main' 'HEAD'
if ($LASTEXITCODE -ne 0) {
  Say '远程 main 上还有本地没有的提交，为免覆盖，本次不更新 main。' 'Yellow'
  Say ('请到 GitHub 打开 Pull Request 合并：' + $repoUrl + '/compare/main...' + $branch + '?expand=1') 'Cyan'
  exit 0
}

Say '远程 main 落后于本次提交，执行快进更新（不会覆盖任何已有内容）……'
& git push origin ('HEAD:' + 'main')
if ($LASTEXITCODE -ne 0) {
  Say 'main 更新失败，分支已推送成功；可稍后重试或改用 Pull Request。' 'Yellow'
  Say ($repoUrl + '/compare/main...' + $branch + '?expand=1') 'Cyan'
  exit 0
}

# 让本地 main 也跟上，并把工作区切回 main，避免以后 checkout main 时把新功能"变没"。
& git branch -f main HEAD
& git checkout main
Say ''
Say '全部完成：分支与 main 都已更新，本地也已切回 main。' 'Green'
Say ('仓库地址：' + $repoUrl) 'Cyan'
Say '别人现在从 Code → Download ZIP 下载到的就是带初始界面的版本。' 'Cyan'
