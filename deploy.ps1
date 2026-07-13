# 一键上传网页到 GitHub（备份）+ Gitee（国内镜像）
# 用法：.\deploy.ps1
# 可选：.\deploy.ps1 -Message "修复搜索问题"
# 可选：设置环境变量 GITEE_TOKEN 后，推送成功会自动触发 Gitee Pages 更新

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

function Invoke-GiteePagesBuild {
  param(
    [string]$Owner,
    [string]$Repo,
    [string]$Token
  )

  if (-not $Token) { return $false }

  $uri = "https://gitee.com/api/v5/repos/$Owner/$Repo/pages/build"
  try {
    Invoke-RestMethod -Method Post -Uri $uri -Body @{ access_token = $Token } | Out-Null
    return $true
  } catch {
    Write-Host "Gitee Pages 自动更新请求失败：$($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "请到 Gitee 仓库 → 服务 → Gitee Pages → 手动点「更新」。" -ForegroundColor Yellow
    return $false
  }
}

Ensure-Git
Update-SiteVersion

git add .

$status = git status --porcelain
if (-not $status) {
  Write-Host "没有需要上传的改动。" -ForegroundColor Yellow
  exit 0
}

git commit -m $Message

$remotes = @(git remote)
$pushedAny = $false

if ($remotes -contains "origin") {
  Write-Host "正在推送到 GitHub（代码备份）…" -ForegroundColor Cyan
  git push origin main
  $pushedAny = $true
} else {
  Write-Host ""
  Write-Host "尚未配置 GitHub 远程仓库。请按 在线部署.html 里的步骤执行：" -ForegroundColor Yellow
  Write-Host "  git remote add origin https://github.com/你的用户名/hebing-pingfen.git" -ForegroundColor Yellow
  Write-Host "  git push -u origin main" -ForegroundColor Yellow
  Write-Host ""
}

if ($remotes -contains "gitee") {
  Write-Host "正在推送到 Gitee（国内镜像）…" -ForegroundColor Cyan
  git push gitee main
  $pushedAny = $true

  $giteeUser = Get-SiteConfigValue "giteeUser:\s*'([^']*)'"
  $repoName = Get-SiteConfigValue "repoName:\s*'([^']*)'"
  if ($env:GITEE_TOKEN -and $giteeUser -and $repoName) {
    Write-Host "正在触发 Gitee Pages 更新…" -ForegroundColor Cyan
    if (Invoke-GiteePagesBuild -Owner $giteeUser -Repo $repoName -Token $env:GITEE_TOKEN) {
      Write-Host "Gitee Pages 更新已提交，约 1 分钟后生效。" -ForegroundColor Green
    }
  } else {
    Write-Host "提示：设置环境变量 GITEE_TOKEN 可自动触发 Gitee Pages 更新。" -ForegroundColor Yellow
  }
} else {
  Write-Host ""
  Write-Host "尚未配置 Gitee 远程。国内镜像请按 在线部署.html「方案 B」添加：" -ForegroundColor Yellow
  Write-Host "  git remote add gitee https://gitee.com/你的用户名/hebing-pingfen.git" -ForegroundColor Yellow
  Write-Host "  git push -u gitee main" -ForegroundColor Yellow
  Write-Host ""
}

if (-not $pushedAny) {
  Write-Host "本地提交已完成，配置 remote 后再运行 .\deploy.ps1 即可上传。" -ForegroundColor Green
  exit 0
}

$githubUser = Get-SiteConfigValue "githubUser:\s*'([^']*)'"
$giteeUser = Get-SiteConfigValue "giteeUser:\s*'([^']*)'"
$repoName = Get-SiteConfigValue "repoName:\s*'([^']*)'"

Write-Host ""
Write-Host "上传成功。约 1 分钟后访问：" -ForegroundColor Green
if ($giteeUser -and $repoName) {
  Write-Host "  国内推荐：https://$giteeUser.gitee.io/$repoName/" -ForegroundColor Green
}
if ($githubUser -and $repoName) {
  Write-Host "  GitHub 备份：https://$githubUser.github.io/$repoName/" -ForegroundColor Green
}
if ($remotes -contains "origin") {
  Write-Host "GitHub Actions 会自动发布到 Pages。" -ForegroundColor Green
}
