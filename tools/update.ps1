# UTHub 카드영수증 도우미 - 자동 업데이트
# GitHub Release 최신 버전을 확인해 설치 폴더(gw-receipt-helper)를 새 버전으로 교체한다.
# 작업 스케줄러가 1시간마다 실행. 수동 실행: powershell -ExecutionPolicy Bypass -File update.ps1
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "UTGwReceipt")
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

try {
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

        # 같은 경로를 유지해야 크롬이 같은 확장으로 인식해 설정(API 키 등)이 보존된다
        New-Item -ItemType Directory -Force $ExtDir | Out-Null
        robocopy $src $ExtDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "파일 복사 실패 (robocopy $LASTEXITCODE)" }
        Remove-Item $tmp -Recurse -Force
        Write-Log "업데이트 완료 v$current -> v$latest (크롬은 30분 안에 자동 반영)"
    }

    # 업데이트 스크립트 자신도 최신으로 교체
    $self = $rel.assets | Where-Object { $_.name -eq "update.ps1" } | Select-Object -First 1
    if ($self) {
        $selfPath = Join-Path $InstallRoot "update.ps1"
        $newSelf = "$selfPath.new"
        Invoke-WebRequest $self.browser_download_url -OutFile $newSelf -UseBasicParsing -TimeoutSec 60
        Move-Item $newSelf $selfPath -Force
    }
} catch {
    Write-Log "오류: $($_.Exception.Message)"
    exit 1
}
