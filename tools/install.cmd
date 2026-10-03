@echo off
rem UTHub 카드영수증 도우미 - 더블클릭 설치 (설치 exe가 이 파일을 실행)
rem PowerShell 실행 정책과 관계없이 install.ps1 실행 (관리자 권한 불필요)
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
