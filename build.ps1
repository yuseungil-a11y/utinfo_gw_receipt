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

# ZIP 만들기: 항목 경로 구분자를 '/'로 저장 (PS 5.1 Compress-Archive는 '\'로 저장해 맥에서 폴더가 아닌 파일 이름으로 풀림)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function New-Zip([string]$baseDir, [string[]]$items, [string]$zipPath) {
    $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($item in $items) {
            $full = Join-Path $baseDir $item
            $files = if (Test-Path $full -PathType Container) { Get-ChildItem $full -Recurse -File } else { @(Get-Item $full) }
            foreach ($f in $files) {
                $rel = $f.FullName.Substring($baseDir.TrimEnd('\').Length + 1).Replace('\', '/')
                [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal)
            }
        }
    } finally { $zip.Dispose() }
}

$stage = Join-Path ([System.IO.Path]::GetTempPath()) "gw-receipt-build"
if (Test-Path $stage) { [IO.Directory]::Delete($stage, $true) }

# 업데이트용
$upd = Join-Path $stage "update"
Copy-Item $ext (Join-Path $upd "gw-receipt-helper") -Recurse
$zip1 = Join-Path $dist "gw-receipt-helper-v$version.zip"
if (Test-Path $zip1) { [IO.File]::Delete($zip1) }
New-Zip $upd @("gw-receipt-helper") $zip1

# 게시판 배포용 설치 파일
$set = Join-Path $stage "setup"
Copy-Item $ext (Join-Path $set "gw-receipt-helper") -Recurse
# 압축 푼 폴더를 크롬에 직접 불러오면 사이드패널이 경고하도록 표시 파일 (설치 프로그램은 이 파일을 빼고 설치, 업데이트 zip에는 없음)
[IO.File]::WriteAllText((Join-Path $set "gw-receipt-helper\portable.json"), '{"portable": true}')
Copy-Item (Join-Path $root "tools\install.cmd"), (Join-Path $root "tools\install.ps1"), (Join-Path $root "tools\update.ps1"), (Join-Path $root "tools\uninstall.ps1") $set
# 맥용 설치/업데이트/제거 스크립트도 같은 ZIP에 (윈도우·맥 공용 설치 파일)
Copy-Item (Join-Path $root "tools\install-mac.sh"), (Join-Path $root "tools\update-mac.sh"), (Join-Path $root "tools\uninstall-mac.sh") $set
# 게시판에 올리는 파일은 직원이 알아보기 쉽게 한글 이름 (GitHub Release 첨부는 영문 이름 유지)
$zip2 = Join-Path $dist "유티허브 영수증 등록 도우미 v$version.zip"
if (Test-Path $zip2) { [IO.File]::Delete($zip2) }
New-Zip $set @(Get-ChildItem $set | ForEach-Object Name) $zip2

# 설치 exe (윈도우 기본 IExpress): 더블클릭 → install.cmd → install.ps1 이 GitHub 최신 버전을 C:\UTGwReceipt 에 설치
# exe에는 확장 프로그램 파일을 넣지 않는다(IExpress는 하위 폴더 미지원) — 설치 시 항상 최신 Release를 받음
$exeStage = Join-Path $stage "exe"
New-Item -ItemType Directory -Force $exeStage | Out-Null
Copy-Item (Join-Path $root "tools\install.cmd"), (Join-Path $root "tools\install.ps1") $exeStage
$exeTmp = Join-Path $stage "gwr-setup.exe"   # IExpress 출력은 영문 이름으로 만든 뒤 한글 이름으로 바꿈
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exeTmp
FriendlyName=UTHub Card Receipt Helper Setup
AppLaunched=cmd /c .\install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="install.cmd"
FILE1="install.ps1"
[SourceFiles]
SourceFiles0=$exeStage\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@
$sedPath = Join-Path $stage "setup.sed"
[IO.File]::WriteAllText($sedPath, $sed, [Text.Encoding]::ASCII)
Start-Process -FilePath "$env:WINDIR\System32\iexpress.exe" -ArgumentList "/N", "/Q", $sedPath -Wait -NoNewWindow
if (-not (Test-Path $exeTmp)) { throw "설치 exe 생성 실패 (IExpress)" }
# exe 아이콘을 브랜드 아이콘(tools\setup.ico)으로 교체 — rcedit(Electron 공식 도구)을 처음 한 번 .tools\ 에 받아 둠
$rcedit = Join-Path $root ".tools\rcedit-x64.exe"
if (-not (Test-Path $rcedit)) {
    New-Item -ItemType Directory -Force (Split-Path $rcedit) | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe" -OutFile $rcedit -UseBasicParsing
}
& $rcedit $exeTmp --set-icon (Join-Path $root "tools\setup.ico") `
    --set-version-string "FileDescription" "UTHub Card Receipt Helper Setup" `
    --set-version-string "ProductName" "UTHub Card Receipt Helper" `
    --set-version-string "CompanyName" "UTinfo" --set-file-version $version --set-product-version $version
if ($LASTEXITCODE -ne 0) { Write-Warning "exe 아이콘 적용 실패 (기본 아이콘으로 계속)" }
$exe = Join-Path $dist "유티허브 영수증 등록 도우미 설치 v$version.exe"
if (Test-Path $exe) { [IO.File]::Delete($exe) }
Move-Item $exeTmp $exe

[IO.Directory]::Delete($stage, $true)
Write-Host "Built: $zip1"
Write-Host "Built: $zip2"
Write-Host "Built: $exe"
