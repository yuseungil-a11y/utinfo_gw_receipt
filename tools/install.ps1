# UTHub 카드영수증 도우미 - 설치 (PC당 1회, 관리자 권한 불필요)
# 게시판에서 받은 설치 ZIP을 풀고 이 파일을 실행한다.
# 1) 같은 폴더의 gw-receipt-helper 를 %LOCALAPPDATA%\UTGwReceipt\gw-receipt-helper 로 복사
#    (같은 폴더에 없으면 GitHub 최신 Release에서 받음)
# 2) 1시간마다 + 로그인 시 GitHub를 확인해 자동 업데이트하는 작업 스케줄러 등록
# 실행: 우클릭 → PowerShell에서 실행  또는  powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "yuseungil-a11y/utinfo_gw_receipt"
$InstallRoot = Join-Path $env:LOCALAPPDATA "UTGwReceipt"
$ExtDir = Join-Path $InstallRoot "gw-receipt-helper"
$TaskName = "UTGwReceipt-AutoUpdate"
$Here = $PSScriptRoot
New-Item -ItemType Directory -Force $InstallRoot | Out-Null

try {
    $UpdateScript = Join-Path $InstallRoot "update.ps1"
    $bundledExt = Join-Path $Here "gw-receipt-helper"
    $bundledUpdate = Join-Path $Here "update.ps1"

    if ((Test-Path (Join-Path $bundledExt "manifest.json")) -and (Test-Path $bundledUpdate)) {
        # 게시판 설치 ZIP: 함께 들어 있는 파일로 설치 (GitHub 접속 불필요)
        New-Item -ItemType Directory -Force $ExtDir | Out-Null
        robocopy $bundledExt $ExtDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "파일 복사 실패 (robocopy $LASTEXITCODE)" }
        Copy-Item $bundledUpdate $UpdateScript -Force
        $m = [IO.File]::ReadAllText((Join-Path $ExtDir "manifest.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
        Write-Host "설치 파일에서 v$($m.version) 설치"
    } else {
        # 스크립트만 받은 경우: GitHub 최신 Release에서 설치
        $headers = @{ "User-Agent" = "UTGwReceipt-Installer"; "Accept" = "application/vnd.github+json" }
        $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 30
        $asset = $rel.assets | Where-Object { $_.name -eq "update.ps1" } | Select-Object -First 1
        if (-not $asset) { throw "최신 Release($($rel.tag_name))에 update.ps1 이 없습니다." }
        Invoke-WebRequest $asset.browser_download_url -OutFile $UpdateScript -UseBasicParsing -TimeoutSec 60
        & powershell -NoProfile -ExecutionPolicy Bypass -File $UpdateScript
        if ($LASTEXITCODE -ne 0) { throw "설치 실패 - $InstallRoot\update.log 를 확인하세요." }
    }

    # 자동 업데이트 작업 등록 (현재 사용자, 창 없이 실행) — 업데이트는 GitHub Release에서 받음
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$UpdateScript`""
    $hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
    $logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($hourly, $logon) -Settings $settings `
        -Description "UTHub 카드영수증 도우미 자동 업데이트 (GitHub Release 확인)" -Force | Out-Null

    Set-Clipboard -Value $ExtDir
    Write-Host ""
    Write-Host "설치 완료: $ExtDir"
    Write-Host "자동 업데이트: 작업 스케줄러 '$TaskName' (1시간마다, 로그인 시 GitHub 확인)"
    Write-Host ""
    Write-Host "마지막으로 크롬에서 한 번만 해주세요:"
    Write-Host "  1. 주소창에 chrome://extensions 입력"
    Write-Host "  2. 오른쪽 위 '개발자 모드' 켜기"
    Write-Host "  3. '압축해제된 확장 프로그램을 로드합니다' -> 위 폴더 선택 (경로는 클립보드에 복사됨)"
} catch {
    Write-Host "설치 실패: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""
Read-Host "Enter 키를 누르면 창이 닫힙니다"
