@echo off
rem 竞品调研 Agent —— 双击启动入口（自动绕过 PowerShell 执行策略调用 start.ps1）
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1" %*
