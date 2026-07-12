# 一键上传网页到 GitHub Pages
# 用法：在 PowerShell 中运行 .\deploy.ps1
# 可选参数：.\deploy.ps1 -Message "修复搜索问题"

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
  Set-Content -Path $configPath -Value $content -Encoding UTF8 -NoNewline
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

$remotes = git remote
if ($remotes -notcontains "origin") {
  Write-Host ""
  Write-Host "尚未配置 GitHub 远程仓库。请按 在线部署.html 里的步骤执行：" -ForegroundColor Yellow
  Write-Host "  git remote add origin https://github.com/你的用户名/hebing-pingfen.git" -ForegroundColor Yellow
  Write-Host "  git push -u origin main" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "本地提交已完成，配置 remote 后再运行 .\deploy.ps1 即可上传。" -ForegroundColor Green
  exit 0
}

Write-Host "正在推送到 GitHub…" -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "上传成功。约 1 分钟后访问：" -ForegroundColor Green
Write-Host "  https://你的GitHub用户名.github.io/hebing-pingfen/" -ForegroundColor Green
Write-Host "GitHub Actions 会自动发布到 Pages。" -ForegroundColor Green
