# UTHub 카드영수증 도우미 - 제거 (자동 업데이트 작업, 업데이트 버튼용 프로토콜, 설치 폴더 삭제)
# 위치: 설치 폴더(C:\UTGwReceipt, 예전 설치는 %LOCALAPPDATA%\UTGwReceipt)의 uninstall.ps1 — 같은 폴더의 '제거.cmd' 더블클릭으로도 실행
# 크롬 확장 목록에서의 삭제는 chrome://extensions 에서 직접 "삭제"를 누르세요.
$TaskName = "UTGwReceipt-AutoUpdate"

# 지울 후보: 이 사용자의 예전 위치, 이 사용자의 자동 업데이트 작업이 가리키는 위치, 이 스크립트가 있는 폴더.
# 안전장치: 이름이 정확히 UTGwReceipt 이고 gw-receipt-helper\manifest.json 이 있는 폴더만 지운다
# (압축을 푼 다운로드 폴더나 다른 사용자의 설치 폴더를 지우지 않도록).
$candidates = @(Join-Path $env:LOCALAPPDATA "UTGwReceipt")
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    foreach ($a in $task.Actions) {
        if ($a.Arguments -match '-InstallRoot\s+"([^"]+)"') { $candidates += $Matches[1] }
        # v0.6.2부터 작업은 wscript "<설치폴더>\update-hidden.vbs" 를 실행
        if ($a.Arguments -match '"([^"]+)\\update-hidden\.vbs"') { $candidates += $Matches[1] }
    }
}
if ($PSScriptRoot) { $candidates += $PSScriptRoot }
$Roots = $candidates | Where-Object {
    $_ -and ((Split-Path $_ -Leaf) -eq "UTGwReceipt") -and (Test-Path (Join-Path $_ "gw-receipt-helper\manifest.json"))
} | Select-Object -Unique

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item -Path "HKCU:\Software\Classes\utgwr-update" -Recurse -Force -ErrorAction SilentlyContinue
# 설치 폴더 안에서 실행 중이어도 폴더째 지울 수 있도록 프로세스 작업 폴더를 바깥으로 옮김
Set-Location $env:TEMP
[Environment]::CurrentDirectory = $env:TEMP
$removed = @()
foreach ($r in $Roots) {
    Remove-Item $r -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $r)) { $removed += $r } else { Write-Host "일부 파일을 지우지 못했습니다: $r (크롬을 닫고 다시 실행하세요)" -ForegroundColor Yellow }
}
$done = "제거 완료: 자동 업데이트 작업 '$TaskName', 업데이트 버튼 등록"
if ($removed) { $done += ", 폴더 $($removed -join ', ')" }
Write-Host $done
Write-Host "크롬에서 chrome://extensions 를 열어 'UTHub 카드영수증 도우미'를 삭제하세요."
Write-Host ""
Read-Host "Enter 키를 누르면 창이 닫힙니다"
