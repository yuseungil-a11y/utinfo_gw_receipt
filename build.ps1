# 로컬 빌드: dist\ 에 두 가지 ZIP 생성 (_test 영수증, _sample 등 개인 자료는 제외)
#  - gw-receipt-helper-v<ver>.zip        : 업데이트용 (확장 프로그램 폴더만)
#  - gw-receipt-helper-setup-v<ver>.zip  : 게시판 배포용 설치 파일 (확장 + install/update/uninstall 스크립트)
# 정식 배포는 v* 태그 push → GitHub Actions가 같은 파일을 Release에 올린다.
# 사용: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$ext = Join-Path $root "extension"
$manifest = [System.IO.File]::ReadAllText((Join-Path $ext "manifest.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null

$stage = Join-Path ([System.IO.Path]::GetTempPath()) "gw-receipt-build"
if (Test-Path $stage) { [IO.Directory]::Delete($stage, $true) }

# 업데이트용
$upd = Join-Path $stage "update"
Copy-Item $ext (Join-Path $upd "gw-receipt-helper") -Recurse
$zip1 = Join-Path $dist "gw-receipt-helper-v$version.zip"
if (Test-Path $zip1) { [IO.File]::Delete($zip1) }
Compress-Archive -Path (Join-Path $upd "gw-receipt-helper") -DestinationPath $zip1

# 게시판 배포용 설치 파일
$set = Join-Path $stage "setup"
Copy-Item $ext (Join-Path $set "gw-receipt-helper") -Recurse
Copy-Item (Join-Path $root "tools\install.ps1"), (Join-Path $root "tools\update.ps1"), (Join-Path $root "tools\uninstall.ps1") $set
$zip2 = Join-Path $dist "gw-receipt-helper-setup-v$version.zip"
if (Test-Path $zip2) { [IO.File]::Delete($zip2) }
Compress-Archive -Path (Join-Path $set "*") -DestinationPath $zip2

[IO.Directory]::Delete($stage, $true)
Write-Host "Built: $zip1"
Write-Host "Built: $zip2"
