@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================
echo   同等学力英语刷题助手 PWA
echo ====================================
python serve.py
pause
