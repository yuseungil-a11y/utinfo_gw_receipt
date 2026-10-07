#!/bin/bash
# UTHub 카드영수증 도우미 - 설치 (macOS, 맥당 1회, 관리자 권한 불필요)
# 게시판에서 받은 설치 ZIP을 풀고 터미널에서 실행:  bash install-mac.sh  (파일을 터미널 창에 끌어다 놓아도 됨)
# 1) 같은 폴더의 gw-receipt-helper 를 ~/Library/Application Support/UTGwReceipt/gw-receipt-helper 로 복사
#    (같은 폴더에 없으면 GitHub 최신 Release에서 받음)
# 2) 1시간마다 + 로그인 시 GitHub를 확인해 자동 업데이트하는 launchd 작업 등록
# 3) 확장의 "지금 업데이트" 버튼용 도우미 앱(utgwr-update:// 주소 처리) 등록
set -u

REPO="yuseungil-a11y/utinfo_gw_receipt"
INSTALL_ROOT="$HOME/Library/Application Support/UTGwReceipt"
EXT_DIR="$INSTALL_ROOT/gw-receipt-helper"
LABEL="kr.co.utinfo.gwreceipt.update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$INSTALL_ROOT/UTGwReceipt Updater.app"
HERE="$(cd "$(dirname "$0")" && pwd)"

finish() { echo; read -r -p "Enter 키를 누르면 끝납니다 " _; exit "${1:-0}"; }
die() { echo "설치 실패: $*"; finish 1; }

[ "$(uname)" = "Darwin" ] || die "macOS 전용 스크립트입니다. 윈도우는 install.ps1 을 사용하세요."
mkdir -p "$INSTALL_ROOT" || die "폴더를 만들 수 없습니다: $INSTALL_ROOT"

if [ -f "$HERE/gw-receipt-helper/manifest.json" ] && [ -f "$HERE/update-mac.sh" ]; then
  # 게시판 설치 ZIP: 함께 들어 있는 파일로 설치 (GitHub 접속 불필요)
  mkdir -p "$EXT_DIR"
  # portable.json = "압축 푼 폴더" 표시 파일(게시판 zip에만 있음) — 설치 폴더에는 넣지 않음
  rsync -a --delete --exclude portable.json "$HERE/gw-receipt-helper/" "$EXT_DIR/" || die "파일 복사 실패"
  rm -f "$EXT_DIR/portable.json"
  cp "$HERE/update-mac.sh" "$INSTALL_ROOT/update-mac.sh" || die "update-mac.sh 복사 실패"
  [ -f "$HERE/uninstall-mac.sh" ] && cp "$HERE/uninstall-mac.sh" "$INSTALL_ROOT/uninstall-mac.sh"
  echo "설치 파일에서 v$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([0-9.]+)".*/\1/p' "$EXT_DIR/manifest.json" | head -1) 설치"
  echo "최신 버전 확인 중..."
  bash "$INSTALL_ROOT/update-mac.sh" >/dev/null || echo "최신 버전 확인 실패 - 1시간 안에 자동으로 다시 확인합니다."
else
  # 스크립트만 받은 경우: GitHub 최신 Release에서 설치
  curl -fsSL --max-time 60 -o "$INSTALL_ROOT/update-mac.sh" \
    "https://github.com/$REPO/releases/latest/download/update-mac.sh" || die "update-mac.sh 내려받기 실패"
  bash "$INSTALL_ROOT/update-mac.sh" || die "설치 실패 - $INSTALL_ROOT/update.log 를 확인하세요."
fi
chmod +x "$INSTALL_ROOT"/*.sh 2>/dev/null

# 자동 업데이트: launchd (현재 사용자, 1시간마다 + 로그인 시)
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$INSTALL_ROOT/update-mac.sh</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>$INSTALL_ROOT/update-error.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && sleep 1   # 재설치: 해제 직후 바로 등록하면 실패할 수 있음
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null \
  || echo "경고: 자동 업데이트 작업 등록 실패 - 로그아웃 후 다시 로그인하면 등록됩니다."

# "지금 업데이트" 버튼용 도우미 앱: 크롬이 utgwr-update://run 을 열면 update-mac.sh 실행
rm -rf "$APP"
script_path="$INSTALL_ROOT/update-mac.sh"
if osacompile -o "$APP" -e "on open location u
  do shell script \"/bin/bash \" & quoted form of \"$script_path\" & \" >/dev/null 2>&1 &\"
end open location" 2>/dev/null; then
  pb=/usr/libexec/PlistBuddy
  info="$APP/Contents/Info.plist"
  $pb -c "Add :CFBundleIdentifier string kr.co.utinfo.gwreceipt.updater" "$info" 2>/dev/null \
    || $pb -c "Set :CFBundleIdentifier kr.co.utinfo.gwreceipt.updater" "$info"
  $pb -c "Add :LSUIElement bool true" "$info" 2>/dev/null
  $pb -c "Add :CFBundleURLTypes array" "$info" 2>/dev/null
  $pb -c "Add :CFBundleURLTypes:0 dict" "$info"
  $pb -c "Add :CFBundleURLTypes:0:CFBundleURLName string UTGwReceipt Update" "$info"
  $pb -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$info"
  $pb -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string utgwr-update" "$info"
  codesign --force --deep -s - "$APP" 2>/dev/null   # Info.plist를 바꿨으므로 다시 서명(로컬 임시 서명)
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null
else
  echo "경고: 업데이트 버튼용 도우미 앱 생성 실패 - 자동 업데이트(1시간마다)는 정상 동작합니다."
fi

printf '%s' "$EXT_DIR" | pbcopy
echo
echo "설치 완료: $EXT_DIR"
echo "자동 업데이트: launchd '$LABEL' (1시간마다, 로그인 시 GitHub 확인)"
echo
echo "마지막으로 크롬에서 한 번만 해주세요:"
echo "  1. 주소창에 chrome://extensions 입력"
echo "  2. 오른쪽 위 '개발자 모드' 켜기"
echo "  3. '압축해제된 확장 프로그램을 로드합니다' 클릭"
echo "  4. 폴더 선택 창에서 Cmd+Shift+G → Cmd+V(경로가 복사되어 있음) → Enter → '선택'"
echo
echo "참고: '백그라운드 항목이 추가됨' 알림이 뜨면 정상입니다(자동 업데이트 작업)."
echo "      시스템 설정 > 로그인 항목에서 이 항목(bash)을 끄면 자동 업데이트가 멈추니 켜 두세요."
finish 0
