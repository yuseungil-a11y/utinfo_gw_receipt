# UTHub 카드영수증 도우미 - 제거 (자동 업데이트 작업과 설치 폴더 삭제)
# 크롬 확장 목록에서의 삭제는 chrome://extensions 에서 직접 "삭제"를 누르세요.
$TaskName = "UTGwReceipt-AutoUpdate"
$InstallRoot = Join-Path $env:LOCALAPPDATA "UTGwReceipt"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
Write-Host "제거 완료: 작업 '$TaskName', 폴더 $InstallRoot"
