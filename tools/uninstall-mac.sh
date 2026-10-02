#!/bin/bash
# UTHub 카드영수증 도우미 - 제거 (macOS: 자동 업데이트 작업, 업데이트 버튼용 도우미 앱, 설치 폴더 삭제)
# 실행: bash "$HOME/Library/Application Support/UTGwReceipt/uninstall-mac.sh"
# 크롬 확장 목록에서의 삭제는 chrome://extensions 에서 직접 "삭제"를 누르세요.
LABEL="kr.co.utinfo.gwreceipt.update"
INSTALL_ROOT="$HOME/Library/Application Support/UTGwReceipt"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload -w "$PLIST" 2>/dev/null
rm -f "$PLIST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -u "$INSTALL_ROOT/UTGwReceipt Updater.app" 2>/dev/null
rm -rf "$INSTALL_ROOT"
echo "제거 완료: 작업 '$LABEL', 업데이트 도우미 앱, 폴더 $INSTALL_ROOT"
echo "크롬에서 chrome://extensions 를 열어 'UTHub 카드영수증 도우미'를 삭제하세요."
echo
read -r -p "Enter 키를 누르면 끝납니다 " _
