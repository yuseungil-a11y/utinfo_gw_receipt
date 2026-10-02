# UTHub 카드영수증 도우미 - 제거 (자동 업데이트 작업, 업데이트 버튼용 프로토콜, 설치 폴더 삭제)
# 위치: %LOCALAPPDATA%\UTGwReceipt\uninstall.ps1 (설치 시 복사됨) - 우클릭 → PowerShell에서 실행
# 크롬 확장 목록에서의 삭제는 chrome://extensions 에서 직접 "삭제"를 누르세요.
$TaskName = "UTGwReceipt-AutoUpdate"
$InstallRoot = Join-Path $env:LOCALAPPDATA "UTGwReceipt"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -Path "HKCU:\Software\Classes\utgwr-update" -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "제거 완료: 작업 '$TaskName', 프로토콜 utgwr-update, 폴더 $InstallRoot"
Write-Host "크롬에서 chrome://extensions 를 열어 'UTHub 카드영수증 도우미'를 삭제하세요."
Write-Host ""
Read-Host "Enter 키를 누르면 창이 닫힙니다"
