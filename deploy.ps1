# 一键上传网页到 GitHub Pages
# 用法：.\deploy.ps1
# 可选：.\deploy.ps1 -Message "修复搜索问题"
#
# 代理说明：会自动检测 127.0.0.1:33210
# - 开着代理 → 走代理推送
# - 没开代理 → 临时关闭 Git 里写死的 GitHub 代理再直连
# 这样代理开/关都能方便部署（直连不通时仍需打开代理）

param(
  [string]$Message = "更新在线版网页",
  [string]$ProxyHost = "127.0.0.1",
  [int]$ProxyPort = 33210
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Set-Location $Root

function Ensure-Git {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "未找到 git，请先安装 Git：https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
  }

  if (-not (Test-Path (Join-Path $Root ".git"))) {
    Write-Host "正在初始化 git 仓库…" -ForegroundColor Cyan
    git init
    git branch -M main
  }
}

function Test-LocalProxyPort {
  param(
    [string]$HostName = "127.0.0.1",
    [int]$Port = 33210,
    [int]$TimeoutMs = 400
  )

  $client = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) {
      return $false
    }
    $client.EndConnect($async)
    return $client.Connected
  } catch {
    return $false
  } finally {
    if ($client) { $client.Close() }
  }
}

function Invoke-GitHubPush {
  param(
    [string]$Remote = "origin",
    [string]$Branch = "main"
  )

  $proxyUrl = "http://${ProxyHost}:${ProxyPort}"
  if (Test-LocalProxyPort -HostName $ProxyHost -Port $ProxyPort) {
    Write-Host "检测到本地代理 ${ProxyHost}:${ProxyPort}，经代理推送…" -ForegroundColor Cyan
    & git `
      -c "http.https://github.com.proxy=$proxyUrl" `
      -c "https.https://github.com.proxy=$proxyUrl" `
      push $Remote $Branch
    return $LASTEXITCODE
  }

  Write-Host "未检测到本地代理，直连推送（忽略 Git 里写死的 GitHub 代理）…" -ForegroundColor Cyan
  & git `
    -c "http.https://github.com.proxy=" `
    -c "https.https://github.com.proxy=" `
    -c "http.proxy=" `
    -c "https.proxy=" `
    push $Remote $Branch
  return $LASTEXITCODE
}

function Get-CommitsAheadOfOrigin {
  try {
    $count = git rev-list --count "origin/main..HEAD" 2>$null
    if ($LASTEXITCODE -ne 0) { return 0 }
    return [int]$count
  } catch {
    return 0
  }
}

function Update-SiteVersion {
  $configPath = Join-Path $Root "site-config.js"
  if (-not (Test-Path $configPath)) { return }

  $today = Get-Date -Format "yyyy-MM-dd"
  $buildId = Get-Date -Format "yyyyMMdd-HHmmss"
  $content = Get-Content $configPath -Raw -Encoding UTF8
  $content = [regex]::Replace($content, "updatedAt:\s*'[^']*'", "updatedAt: '$today'")

  $versionMatch = [regex]::Match($content, "version:\s*'(\d+)\.(\d+)\.(\d+)'")
  if ($versionMatch.Success) {
    $major = [int]$versionMatch.Groups[1].Value
    $minor = [int]$versionMatch.Groups[2].Value
    $patch = [int]$versionMatch.Groups[3].Value + 1
    $newVersion = "$major.$minor.$patch"
    $content = [regex]::Replace($content, "version:\s*'[^']*'", "version: '$newVersion'")
    Write-Host "版本号已更新为 v$newVersion" -ForegroundColor Cyan
  }

  if ($content -match "buildId:\s*'") {
    $content = [regex]::Replace($content, "buildId:\s*'[^']*'", "buildId: '$buildId'")
  } else {
    $content = [regex]::Replace($content, "(updatedAt:\s*'[^']*',)", "`$1`n    buildId: '$buildId',")
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($configPath, $content, $utf8NoBom)
  Write-Host "构建标识：$buildId（APP 将据此检测更新）" -ForegroundColor Cyan
}

function Get-SiteConfigValue {
  param([string]$Pattern)

  $configPath = Join-Path $Root "site-config.js"
  if (-not (Test-Path $configPath)) { return $null }

  $content = Get-Content $configPath -Raw -Encoding UTF8
  $match = [regex]::Match($content, $Pattern)
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}

function Update-CloudDataFile {
  $scriptPath = Join-Path $Root "update-cloud-data.js"
  if (-not (Test-Path $scriptPath)) { return }

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "未找到 node，跳过 cloud-data.json 更新。" -ForegroundColor Yellow
    return
  }

  Write-Host "正在从 jsonblob 更新 cloud-data.json（UTF-8）…" -ForegroundColor Cyan
  & node $scriptPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host "cloud-data.json 更新失败，将保留现有文件。" -ForegroundColor Yellow
  }
}

Ensure-Git

$remotes = @(git remote)
$hasOrigin = $remotes -contains "origin"

Update-SiteVersion
Update-CloudDataFile

git add .

$status = git status --porcelain
if ($status) {
  git commit -m $Message
} else {
  $aheadOnly = if ($hasOrigin) { Get-CommitsAheadOfOrigin } else { 0 }
  if ($aheadOnly -le 0) {
    Write-Host "没有需要上传的改动。" -ForegroundColor Yellow
    exit 0
  }
  Write-Host "工作区无新改动，但本地还有 $aheadOnly 个提交未推送，继续上传…" -ForegroundColor Cyan
}

$pushed = $false

if ($hasOrigin) {
  Write-Host "正在推送到 GitHub…" -ForegroundColor Cyan
  $pushCode = Invoke-GitHubPush -Remote "origin" -Branch "main"
  if ($pushCode -ne 0) {
    Write-Host ""
    Write-Host "推送到 GitHub 失败。" -ForegroundColor Yellow
    Write-Host "若直连失败：先打开代理（端口 $ProxyPort）再运行 .\deploy.ps1" -ForegroundColor Yellow
    Write-Host "本地提交已保存，不会丢。" -ForegroundColor Yellow
    Write-Host ""
    exit 1
  }
  $pushed = $true
} else {
  Write-Host ""
  Write-Host "尚未配置 GitHub 远程仓库。请按 在线部署.html 里的步骤执行：" -ForegroundColor Yellow
  Write-Host "  git remote add origin https://github.com/你的用户名/hebing-pingfen.git" -ForegroundColor Yellow
  Write-Host "  git push -u origin main" -ForegroundColor Yellow
  Write-Host ""
}

if (-not $pushed) {
  Write-Host "本地提交已完成，配置 origin 后再运行 .\deploy.ps1 即可上传。" -ForegroundColor Green
  exit 0
}

$githubUser = Get-SiteConfigValue "githubUser:\s*'([^']*)'"
$repoName = Get-SiteConfigValue "repoName:\s*'([^']*)'"
$siteUrl = Get-SiteConfigValue "siteUrl:\s*'([^']*)'"

Write-Host ""
Write-Host "上传成功。约 1～2 分钟后访问：" -ForegroundColor Green
if ($siteUrl) {
  Write-Host "  $siteUrl" -ForegroundColor Green
} elseif ($githubUser -and $repoName) {
  Write-Host "  https://$githubUser.github.io/$repoName/" -ForegroundColor Green
}
Write-Host "GitHub Actions 会自动发布到 Pages。" -ForegroundColor Green
Write-Host "电脑与手机 APP 会在打开时自动刷新到最新版（无需重装 APK）。" -ForegroundColor Green
