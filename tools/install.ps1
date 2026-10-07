# UTHub 카드영수증 도우미 - 설치 (PC당 1회, 관리자 권한 불필요)
# 게시판에서 받은 설치 ZIP을 풀고 이 파일을 실행한다.
# 1) 같은 폴더의 gw-receipt-helper 를 C:\UTGwReceipt\gw-receipt-helper 로 복사
#    (같은 폴더에 없으면 GitHub 최신 Release에서 받음 — 설치 exe는 이 방식)
#    C:\ 에 폴더를 만들 수 없는 PC(회사 보안 정책 등)는 %LOCALAPPDATA%\UTGwReceipt 에 설치
# 2) 1시간마다 + 로그인 시 GitHub를 확인해 자동 업데이트하는 작업 스케줄러 등록
# 실행: 설치 exe 더블클릭  또는  powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "yuseungil-a11y/utinfo_gw_receipt"
$TaskName = "UTGwReceipt-AutoUpdate"
$Here = $PSScriptRoot
$OldRoot = Join-Path $env:LOCALAPPDATA "UTGwReceipt"
if (Test-Path (Join-Path $OldRoot "gw-receipt-helper\manifest.json")) {
    # 예전 위치에 이미 설치된 PC는 그 자리에서 갱신한다. 위치를 옮기면 크롬이 다른 확장으로 인식해
    # API 키·결재선 설정이 사라지고 크롬에서 다시 불러와야 하기 때문.
    $InstallRoot = $OldRoot
} else {
    # 직원이 찾기 쉬운 C:\UTGwReceipt 를 기본으로 (C:\ 아래 폴더 생성은 일반 사용자 권한으로 가능)
    $InstallRoot = "C:\UTGwReceipt"
    try {
        $isNew = -not (Test-Path $InstallRoot)
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        if (-not $isNew) {
            # 이미 있는 폴더가 다른 계정 소유면 쓰지 않는다(그 계정이 update.ps1 을 바꿀 수 있으므로)
            $owner = (Get-Acl $InstallRoot).GetOwner([Security.Principal.SecurityIdentifier]).Value
            if ($owner -ne $sid) { throw "C:\UTGwReceipt 는 다른 계정 소유" }
        }
        New-Item -ItemType Directory -Force $InstallRoot | Out-Null
        if ($isNew) {
            # C:\ 아래 새 폴더는 이 PC의 다른 계정도 수정할 수 있게 상속되므로, 본인·SYSTEM·관리자만 쓰도록 권한을 좁힌다
            # (매시간 이 폴더의 update.ps1 이 본인 권한으로 실행되므로)
            & icacls $InstallRoot /inheritance:r /grant:r "*${sid}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
            if ($LASTEXITCODE -ne 0) { Write-Host "경고: 설치 폴더 권한 조정 실패(icacls $LASTEXITCODE) - 설치는 계속합니다." -ForegroundColor Yellow }
        }
        [IO.File]::WriteAllText((Join-Path $InstallRoot ".write-test"), "")
        Remove-Item (Join-Path $InstallRoot ".write-test") -Force
    } catch {
        # 회사 보안 정책 등으로 C:\ 에 쓸 수 없거나, 다른 사용자가 이미 C:\UTGwReceipt 를 쓰는 PC
        $InstallRoot = $OldRoot
        New-Item -ItemType Directory -Force $InstallRoot | Out-Null
    }
}
$ExtDir = Join-Path $InstallRoot "gw-receipt-helper"

try {
    $UpdateScript = Join-Path $InstallRoot "update.ps1"
    $bundledExt = Join-Path $Here "gw-receipt-helper"
    $bundledUpdate = Join-Path $Here "update.ps1"

    if ((Test-Path (Join-Path $bundledExt "manifest.json")) -and (Test-Path $bundledUpdate)) {
        # 게시판 설치 ZIP: 함께 들어 있는 파일로 설치 (GitHub 접속 불필요)
        New-Item -ItemType Directory -Force $ExtDir | Out-Null
        # portable.json = "압축 푼 폴더" 표시 파일(게시판 zip에만 있음) — 설치 폴더에는 넣지 않음
        robocopy $bundledExt $ExtDir /MIR /XF portable.json /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "파일 복사 실패 (robocopy $LASTEXITCODE)" }
        Remove-Item (Join-Path $ExtDir "portable.json") -Force -ErrorAction SilentlyContinue
        Copy-Item $bundledUpdate $UpdateScript -Force
        # 제거 스크립트도 설치 폴더에 둔다 (내려받은 압축 폴더를 지워도 제거 가능)
        $bundledUninstall = Join-Path $Here "uninstall.ps1"
        if (Test-Path $bundledUninstall) { Copy-Item $bundledUninstall (Join-Path $InstallRoot "uninstall.ps1") -Force }
        $m = [IO.File]::ReadAllText((Join-Path $ExtDir "manifest.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
        Write-Host "설치 파일에서 v$($m.version) 설치"
        # 게시판 파일이 예전 버전일 수 있으므로 설치 직후 GitHub 최신 버전을 한 번 확인 (실패해도 설치는 계속)
        Write-Host "최신 버전 확인 중..."
        & powershell -NoProfile -ExecutionPolicy Bypass -File $UpdateScript -InstallRoot $InstallRoot
        if ($LASTEXITCODE -ne 0) { Write-Host "최신 버전 확인 실패 - 1시간 안에 자동으로 다시 확인합니다." }
    } else {
        # 스크립트만 받은 경우: GitHub 최신 Release에서 설치
        $headers = @{ "User-Agent" = "UTGwReceipt-Installer"; "Accept" = "application/vnd.github+json" }
        $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 30
        $asset = $rel.assets | Where-Object { $_.name -eq "update.ps1" } | Select-Object -First 1
        if (-not $asset) { throw "최신 Release($($rel.tag_name))에 update.ps1 이 없습니다." }
        Invoke-WebRequest $asset.browser_download_url -OutFile $UpdateScript -UseBasicParsing -TimeoutSec 60
        # 옛 update.ps1(기본 위치가 %LOCALAPPDATA%)이 받아져도 이 위치에 설치되도록 -InstallRoot 를 명시
        & powershell -NoProfile -ExecutionPolicy Bypass -File $UpdateScript -InstallRoot $InstallRoot
        if ($LASTEXITCODE -ne 0) { throw "설치 실패 - $InstallRoot\update.log 를 확인하세요." }
    }

    # 창 없는 실행기(update-hidden.vbs): powershell.exe 를 작업 스케줄러가 직접 띄우면 콘솔 창이 잠깐 깜빡이므로
    # wscript 가 창 없이 실행하게 한다. (update.ps1 도 매번 같은 파일을 만들지만, 옛 update.ps1 을 받은 경우를 위해 여기서도 만듦)
    $Launcher = Join-Path $InstallRoot "update-hidden.vbs"
    $psCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """"$UpdateScript"""" -InstallRoot """"$InstallRoot"""""
    [IO.File]::WriteAllText($Launcher, "' UTHub 카드영수증 도우미 - 자동 업데이트를 창 없이 실행`r`nCreateObject(""WScript.Shell"").Run ""$psCmd"", 0, False`r`n", [Text.Encoding]::Unicode)
    # 회사 정책으로 VBScript(wscript)가 꺼진 PC는 PowerShell 직접 실행(창이 잠깐 보임)으로 — 업데이트가 멈추지 않게
    $wshOk = Test-Path "$env:WINDIR\System32\vbscript.dll"
    foreach ($k in "HKLM:\Software\Microsoft\Windows Script Host\Settings", "HKCU:\Software\Microsoft\Windows Script Host\Settings") {
        $v = (Get-ItemProperty $k -Name Enabled -ErrorAction SilentlyContinue).Enabled
        if ($null -ne $v -and "$v" -eq "0") { $wshOk = $false }
    }
    $psDirect = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$UpdateScript`" -InstallRoot `"$InstallRoot`""

    # 확장 프로그램 "지금 업데이트" 버튼용 URL 프로토콜(utgwr-update://) 등록 — 현재 사용자, 관리자 권한 불필요
    $proto = "HKCU:\Software\Classes\utgwr-update"
    New-Item -Path "$proto\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path $proto -Name "(default)" -Value "URL:UTGwReceipt Update"
    Set-ItemProperty -Path $proto -Name "URL Protocol" -Value ""
    Set-ItemProperty -Path "$proto\shell\open\command" -Name "(default)" `
        -Value $(if ($wshOk) { "wscript.exe `"$Launcher`"" } else { "powershell.exe $psDirect" })

    # 자동 업데이트 작업 등록 (현재 사용자, 창 없이 실행) — 업데이트는 GitHub Release에서 받음
    $action = if ($wshOk) { New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$Launcher`"" }
              else { New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psDirect }
    $hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
    $logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($hourly, $logon) -Settings $settings `
        -Description "UTHub 카드영수증 도우미 자동 업데이트 (GitHub Release 확인)" -Force | Out-Null

    # 설치 폴더에 더블클릭용 제거 파일을 둔다 (PowerShell을 몰라도 제거 가능)
    # 한 줄로 실행 후 종료: 제거 중 이 cmd 파일 자체가 지워져도 다음 줄을 읽으려다 오류 나지 않게, 작업 폴더도 바깥(%TEMP%)으로
    $unCmd = "@echo off`r`ncd /d `"%TEMP%`" & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0uninstall.ps1`" & exit /b`r`n"
    [IO.File]::WriteAllText((Join-Path $InstallRoot "제거.cmd"), $unCmd, [Text.Encoding]::Default)
    if (-not (Test-Path (Join-Path $InstallRoot "uninstall.ps1"))) {
        try {
            Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/uninstall.ps1" `
                -OutFile (Join-Path $InstallRoot "uninstall.ps1") -UseBasicParsing -TimeoutSec 60
        } catch { }
    }

    Set-Clipboard -Value $ExtDir
    Write-Host ""
    Write-Host "설치 완료: $ExtDir"
    Write-Host "자동 업데이트: 작업 스케줄러 '$TaskName' (1시간마다, 로그인 시 GitHub 확인)"
    Write-Host ""
    Write-Host "마지막으로 크롬에서 한 번만 해주세요 (크롬 확장 프로그램 화면을 지금 열어 드립니다):"
    Write-Host "  1. 오른쪽 위 '개발자 모드' 켜기"
    Write-Host "  2. 왼쪽 위 '압축해제된 확장 프로그램을 로드합니다' 클릭"
    Write-Host "  3. 폴더 선택 창 위쪽 주소창에 Ctrl+V (경로가 복사되어 있음) -> Enter -> '폴더 선택'"
    Write-Host "  ※ 예전에 다른 폴더로 불러온 도우미가 있으면 먼저 '삭제'하세요."
    Write-Host "  ※ 크롬 화면이 열리지 않으면 크롬 주소창에 chrome://extensions 를 입력하세요."
    Write-Host "  ※ 이미 이 폴더로 불러와 쓰고 있었다면 크롬에서 다시 할 일은 없습니다(설정 유지)."
    # 크롬 확장 프로그램 화면 열기 (크롬 경로는 레지스트리 App Paths에서 찾음, 실패해도 무시)
    try {
        $chrome = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue).'(default)'
        if (-not $chrome) { $chrome = (Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue).'(default)' }
        if ($chrome -and (Test-Path $chrome)) { Start-Process $chrome "chrome://extensions" }
    } catch { }
} catch {
    Write-Host "설치 실패: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""
Read-Host "Enter 키를 누르면 창이 닫힙니다"
