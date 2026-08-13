<#
  竞品调研 Agent —— 一键启动脚本（Windows PowerShell）

  功能：
    1. 检查/创建后端 Python 虚拟环境并安装依赖
    2. 首次运行自动从 .env.example 复制 .env（随后提示填写密钥）
    3. 检查/安装前端 npm 依赖
    4. 分别在独立窗口启动后端（uvicorn:8000）与前端（vite:5173）
    5. 启动完成后自动打开浏览器

  用法：
    powershell -ExecutionPolicy Bypass -File .\start.ps1          # 正常启动
    powershell -ExecutionPolicy Bypass -File .\start.ps1 -Reinstall  # 强制重装依赖
    powershell -ExecutionPolicy Bypass -File .\start.ps1 -NoBrowser  # 不自动打开浏览器
#>

param(
    [switch]$Reinstall,   # 强制重新安装前后端依赖
    [switch]$NoBrowser    # 不自动打开浏览器
)

$ErrorActionPreference = "Stop"

# 以脚本所在目录为项目根，保证任意位置调用都能定位
$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$VenvDir = Join-Path $Backend ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# 0. 前置检查：Python 与 Node.js 是否可用
# ---------------------------------------------------------------------------
Write-Step "检查运行环境"
$SystemPython = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
    $SystemPython = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $SystemPython = "py"
} else {
    throw "未找到 Python，请先安装 Python 3.12+（python 或 py 命令需可用）"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "未找到 npm，请先安装 Node.js 20.19+ 并加入 PATH"
}
Write-Ok ("python: " + (& $SystemPython --version 2>&1))
Write-Ok ("node:   " + (node --version 2>&1))
$nodeParts = (node --version).TrimStart('v').Split('.')
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 19) -or ($nodeMajor -eq 22 -and $nodeMinor -lt 12)) {
    throw "Node.js 版本过低；Vite 7 需要 Node.js 20.19+ 或 22.12+"
}

# ---------------------------------------------------------------------------
# 1. 后端虚拟环境与依赖
# ---------------------------------------------------------------------------
Write-Step "准备后端虚拟环境"
$venvCreated = $false
if (Test-Path $VenvPython) {
    # venv 中的启动器会记录创建时的基础 Python 路径；移动项目或卸载 Python 后文件仍在但无法执行。
    & $VenvPython -c "import sys; print(sys.executable)" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $resolvedBackend = [System.IO.Path]::GetFullPath($Backend)
        $resolvedVenv = [System.IO.Path]::GetFullPath($VenvDir)
        if (-not $resolvedVenv.StartsWith($resolvedBackend + [System.IO.Path]::DirectorySeparatorChar)) {
            throw "虚拟环境路径不在 backend 目录内，拒绝自动处理：$resolvedVenv"
        }
        $backupVenv = "$VenvDir.invalid.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Write-Warn "检测到失效的虚拟环境，保留为 $backupVenv"
        Move-Item -LiteralPath $VenvDir -Destination $backupVenv
    }
}

if (-not (Test-Path $VenvPython)) {
    Write-Warn "未检测到虚拟环境，正在创建 .venv ..."
    & $SystemPython -m venv $VenvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
        throw "创建 Python 虚拟环境失败"
    }
    $venvCreated = $true
    Write-Ok "虚拟环境创建完成"
} else {
    Write-Ok "已存在虚拟环境"
}

if ($venvCreated -or $Reinstall) {
    Write-Step "安装后端依赖（首次或 -Reinstall）"
    & $VenvPython -m pip install --upgrade pip
    & $VenvPython -m pip install -r (Join-Path $Backend "requirements.txt")
    Write-Ok "后端依赖安装完成"
} else {
    Write-Ok "跳过后端依赖安装（如需重装请加 -Reinstall）"
}

# ---------------------------------------------------------------------------
# 2. 后端 .env 配置
# ---------------------------------------------------------------------------
Write-Step "检查后端 .env 配置"
$envFile = Join-Path $Backend ".env"
$envExample = Join-Path $Backend ".env.example"
if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Write-Warn ".env 不存在，已从 .env.example 生成"
    Write-Warn "请编辑 backend\.env 填写 LLM_API_KEY / TAVILY_API_KEY（否则无法真正调研）"
    Write-Warn "如需真实发送邮件，还需填写 SMTP_* 与 FRONTEND_BASE"
} else {
    Write-Ok ".env 已存在"
}

# ---------------------------------------------------------------------------
# 3. 前端依赖
# ---------------------------------------------------------------------------
Write-Step "检查前端依赖"
$nodeModules = Join-Path $Frontend "node_modules"
if ((-not (Test-Path $nodeModules)) -or $Reinstall) {
    Write-Warn "正在按锁文件安装前端依赖（npm ci）..."
    Push-Location $Frontend
    npm ci
    Pop-Location
    Write-Ok "前端依赖安装完成"
} else {
    Write-Ok "前端依赖已就绪"
}

# ---------------------------------------------------------------------------
# 4. 启动后端与前端（各自独立窗口，便于查看日志与单独停止）
# ---------------------------------------------------------------------------
Write-Step "启动后端服务 (http://127.0.0.1:8000)"
$backendCmd = "cd '$Backend'; & '$VenvPython' -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd | Out-Null
Write-Ok "后端已在新窗口启动"

Write-Step "启动前端服务 (http://localhost:5173)"
$frontendCmd = "cd '$Frontend'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd | Out-Null
Write-Ok "前端已在新窗口启动"

# ---------------------------------------------------------------------------
# 5. 打开浏览器
# ---------------------------------------------------------------------------
if (-not $NoBrowser) {
    Write-Step "等待前端就绪后打开浏览器"
    Start-Sleep -Seconds 5
    Start-Process "http://localhost:5173"
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " 启动完成" -ForegroundColor Green
Write-Host "   前端： http://localhost:5173" -ForegroundColor Green
Write-Host "   后端： http://127.0.0.1:8000   (接口文档 /docs)" -ForegroundColor Green
Write-Host "   管理员：通过 backend\.env 的 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD 显式初始化" -ForegroundColor Green
Write-Host " 关闭对应窗口即可停止各自服务" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
