# 로컬 빌드: dist\ 에 두 가지 ZIP 생성 (_test 영수증, _sample 등 개인 자료는 제외)
#  - gw-receipt-helper-v<ver>.zip        : 업데이트용 (확장 프로그램 폴더만)
#  - 유티허브 영수증 등록 도우미 v<ver>.zip : 게시판 배포용 설치 파일 (확장 + install/update/uninstall 스크립트)
# 정식 배포는 v* 태그 push → GitHub Actions가 같은 내용을 Release에 올린다
# (Release의 설치 ZIP 이름은 영문 gw-receipt-helper-setup-v<ver>.zip — GitHub가 한글·공백 파일명을 바꾸기 때문.
#  게시판에는 이 스크립트가 만든 한글 이름 파일을 올리거나, Release 파일을 받아 이름만 바꿔 올린다).
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
# 맥용 설치/업데이트/제거 스크립트도 같은 ZIP에 (윈도우·맥 공용 설치 파일)
Copy-Item (Join-Path $root "tools\install-mac.sh"), (Join-Path $root "tools\update-mac.sh"), (Join-Path $root "tools\uninstall-mac.sh") $set
# 게시판에 올리는 파일은 직원이 알아보기 쉽게 한글 이름 (GitHub Release 첨부는 영문 이름 유지)
$zip2 = Join-Path $dist "유티허브 영수증 등록 도우미 v$version.zip"
if (Test-Path $zip2) { [IO.File]::Delete($zip2) }
Compress-Archive -Path (Join-Path $set "*") -DestinationPath $zip2

[IO.Directory]::Delete($stage, $true)
Write-Host "Built: $zip1"
Write-Host "Built: $zip2"
