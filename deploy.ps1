# 一键上传网页到 GitHub Pages
# 用法：.\deploy.ps1
# 可选：.\deploy.ps1 -Message "修复搜索问题"

param(
  [string]$Message = "更新在线版网页"
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

function Update-SiteVersion {
  $configPath = Join-Path $Root "site-config.js"
  if (-not (Test-Path $configPath)) { return }

  $today = Get-Date -Format "yyyy-MM-dd"
  $content = Get-Content $configPath -Raw -Encoding UTF8
  $content = [regex]::Replace($content, "updatedAt:\s*'[^']*'", "updatedAt: '$today'")
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($configPath, $content, $utf8NoBom)
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
  $syncCode = Get-SiteConfigValue "defaultSyncCode:\s*'([^']*)'"
  if (-not $syncCode) { return }

  $outPath = Join-Path $Root "cloud-data.json"
  $uri = "https://jsonblob.com/api/jsonBlob/$syncCode"
  try {
    $response = Invoke-RestMethod -Uri $uri -Headers @{ Accept = "application/json" } -TimeoutSec 30
    if (-not $response) { return }
    $payload = [ordered]@{
      products = @($response.products)
      shops    = @($response.shops)
      syncedAt = if ($response.syncedAt) { $response.syncedAt } else { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
    }
    $json = $payload | ConvertTo-Json -Depth 20
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($outPath, $json, $utf8NoBom)
    Write-Host "已更新 cloud-data.json（供手机读取的网页备份）。" -ForegroundColor Green
  } catch {
    Write-Host "未能从 jsonblob 更新 cloud-data.json：$($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "手机仍可能通过 cloud-data.json 读取上次部署时的数据。" -ForegroundColor Yellow
  }
}

Ensure-Git
Update-SiteVersion
Update-CloudDataFile

git add .

$status = git status --porcelain
if (-not $status) {
  Write-Host "没有需要上传的改动。" -ForegroundColor Yellow
  exit 0
}

git commit -m $Message

$remotes = @(git remote)
$pushed = $false

if ($remotes -contains "origin") {
  Write-Host "正在推送到 GitHub…" -ForegroundColor Cyan
  git push origin main
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
