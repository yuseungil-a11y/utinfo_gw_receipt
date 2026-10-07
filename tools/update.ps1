# UTHub 카드영수증 도우미 - 자동 업데이트
# GitHub Release 최신 버전을 확인해 설치 폴더(gw-receipt-helper)를 새 버전으로 교체한다.
# 작업 스케줄러가 1시간마다 실행. 수동 실행: powershell -ExecutionPolicy Bypass -File update.ps1
param(
    # 기본값 = 이 스크립트가 있는 폴더 (C:\UTGwReceipt 든 예전 위치 %LOCALAPPDATA%\UTGwReceipt 든 그대로 따라감)
    [string]$InstallRoot = $(if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path $env:LOCALAPPDATA "UTGwReceipt" }),
    [switch]$SkipProtocol   # 시험용: URL 프로토콜(레지스트리) 등록을 건너뜀
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "yuseungil-a11y/utinfo_gw_receipt"
$ExtDir = Join-Path $InstallRoot "gw-receipt-helper"
$LogFile = Join-Path $InstallRoot "update.log"
New-Item -ItemType Directory -Force $InstallRoot | Out-Null

function Write-Log([string]$msg) {
    $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $msg
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

# 확장 프로그램의 "지금 업데이트" 버튼이 이 스크립트를 바로 실행할 수 있도록
# 현재 사용자용 URL 프로토콜(utgwr-update://)을 등록한다. (HKCU, 관리자 권한 불필요, 매번 갱신)
function Register-UpdateProtocol([string]$launcher) {
    $base = "HKCU:\Software\Classes\utgwr-update"
    New-Item -Path "$base\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path $base -Name "(default)" -Value "URL:UTGwReceipt Update"
    Set-ItemProperty -Path $base -Name "URL Protocol" -Value ""
    Set-ItemProperty -Path "$base\shell\open\command" -Name "(default)" -Value "wscript.exe `"$launcher`""
}

# 창 없이 실행하는 실행기(update-hidden.vbs). 작업 스케줄러가 powershell.exe 를 직접 띄우면
# -WindowStyle Hidden 이어도 콘솔 창이 잠깐 깜빡이므로, wscript 가 창 없이(0) PowerShell 을 실행하게 한다.
function New-HiddenLauncher([string]$root) {
    $vbs = Join-Path $root "update-hidden.vbs"
    $ps1 = Join-Path $root "update.ps1"
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """"$ps1"""" -InstallRoot """"$root"""""
    $text = "' UTHub 카드영수증 도우미 - 자동 업데이트를 창 없이 실행`r`nCreateObject(""WScript.Shell"").Run ""$cmd"", 0, False`r`n"
    # 한글 경로를 위해 UTF-16(BOM) 으로 저장 — wscript 가 유니코드 스크립트로 읽음
    [IO.File]::WriteAllText($vbs, $text, [Text.Encoding]::Unicode)
    return $vbs
}

# 이 PC에서 wscript(VBScript)를 쓸 수 있는지 — 회사 정책으로 꺼져 있거나 윈도우에서 제거된 PC는 기존 방식 유지
function Test-Wsh {
    if (-not (Test-Path "$env:WINDIR\System32\vbscript.dll")) { return $false }
    foreach ($k in "HKLM:\Software\Microsoft\Windows Script Host\Settings", "HKCU:\Software\Microsoft\Windows Script Host\Settings") {
        $v = (Get-ItemProperty $k -Name Enabled -ErrorAction SilentlyContinue).Enabled
        if ($null -ne $v -and "$v" -eq "0") { return $false }
    }
    return $true
}

# 이미 등록된 자동 업데이트 작업이 powershell.exe 를 직접 실행하고 있으면(예전 설치) 창 없는 실행기로 바꾼다
function Use-HiddenTask([string]$launcher) {
    if (-not (Test-Wsh)) { return }
    $task = Get-ScheduledTask -TaskName "UTGwReceipt-AutoUpdate" -ErrorAction SilentlyContinue
    if ($task -and ($task.Actions | Where-Object { $_.Execute -notmatch 'wscript' })) {
        $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$launcher`""
        Set-ScheduledTask -TaskName "UTGwReceipt-AutoUpdate" -Action $action | Out-Null
        Write-Log "자동 업데이트 작업을 창 없이 실행하도록 변경"
    }
}

try {
    # 레지스트리·작업 정책 등으로 실패해도 업데이트 자체는 계속 (버튼만 못 쓰거나 창이 잠깐 보일 뿐)
    if (-not $SkipProtocol) {
        try {
            $launcher = New-HiddenLauncher $InstallRoot
            if (Test-Wsh) {
                Register-UpdateProtocol $launcher
                Use-HiddenTask $launcher
            } else {
                Write-Log "참고: 이 PC는 VBScript(wscript)를 쓸 수 없어 기존 방식(PowerShell 직접 실행)으로 업데이트합니다"
            }
        }
        catch { Write-Log "경고: 업데이트 실행기·버튼 등록 실패 - $($_.Exception.Message)" }
    }

    $headers = @{ "User-Agent" = "UTGwReceipt-Updater"; "Accept" = "application/vnd.github+json" }
    $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 30
    $latest = [version]($rel.tag_name -replace '^v', '')

    $current = [version]"0.0.0"
    $manifestPath = Join-Path $ExtDir "manifest.json"
    if (Test-Path $manifestPath) {
        $m = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $current = [version]$m.version
    }

    if ($latest -le $current) {
        Write-Log "최신 상태 (설치 v$current, 최신 v$latest)"
    } else {
        $asset = $rel.assets | Where-Object { $_.name -like "gw-receipt-helper-v*.zip" } | Select-Object -First 1
        if (-not $asset) { throw "Release v$latest 에 ZIP 파일이 없습니다." }

        $tmp = Join-Path ([IO.Path]::GetTempPath()) ("gwr-" + [guid]::NewGuid())
        New-Item -ItemType Directory -Force $tmp | Out-Null
        $zip = Join-Path $tmp $asset.name
        Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing -TimeoutSec 120
        Expand-Archive $zip -DestinationPath $tmp -Force
        $src = Join-Path $tmp "gw-receipt-helper"
        if (-not (Test-Path (Join-Path $src "manifest.json"))) { throw "ZIP 구조가 올바르지 않습니다." }

        # 같은 경로를 유지해야 크롬이 같은 확장으로 인식해 설정(API 키 등)이 보존된다.
        # manifest.json은 맨 마지막에 바꾼다 — 확장은 manifest 버전이 바뀐 것을 보고 다시 로드하므로,
        # 다른 파일이 덜 복사된 상태에서 새/옛 파일이 섞여 로드되는 것을 막는다.
        New-Item -ItemType Directory -Force $ExtDir | Out-Null
        robocopy $src $ExtDir /MIR /XF manifest.json /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "파일 복사 실패 (robocopy $LASTEXITCODE)" }
        Copy-Item (Join-Path $src "manifest.json") (Join-Path $ExtDir "manifest.json") -Force
        Remove-Item $tmp -Recurse -Force
        Write-Log "업데이트 완료 v$current -> v$latest (크롬은 30분 안에 자동 반영)"
    }

    # 업데이트 스크립트 자신(과 제거 스크립트)도 최신으로 교체.
    # 설치된 버전이 GitHub 최신보다 높으면(게시판 파일이 먼저 올라간 경우) 옛 스크립트로 되돌리지 않는다.
    $self = $rel.assets | Where-Object { $_.name -eq "update.ps1" } | Select-Object -First 1
    if ($self -and $latest -ge $current) {
        $selfPath = Join-Path $InstallRoot "update.ps1"
        $newSelf = "$selfPath.new"
        Invoke-WebRequest $self.browser_download_url -OutFile $newSelf -UseBasicParsing -TimeoutSec 60
        Move-Item $newSelf $selfPath -Force
        $un = $rel.assets | Where-Object { $_.name -eq "uninstall.ps1" } | Select-Object -First 1
        if ($un) {
            try { Invoke-WebRequest $un.browser_download_url -OutFile (Join-Path $InstallRoot "uninstall.ps1") -UseBasicParsing -TimeoutSec 60 }
            catch { Write-Log "경고: uninstall.ps1 갱신 실패 - $($_.Exception.Message)" }
        }
    }
} catch {
    Write-Log "오류: $($_.Exception.Message)"
    exit 1
}
