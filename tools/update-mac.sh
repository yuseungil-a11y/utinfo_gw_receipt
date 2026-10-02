#!/bin/bash
# UTHub 카드영수증 도우미 - 자동 업데이트 (macOS)
# GitHub Release 최신 버전을 확인해 설치 폴더(gw-receipt-helper)를 새 버전으로 교체한다.
# launchd가 1시간마다·로그인 시 실행. 수동 실행: bash "$HOME/Library/Application Support/UTGwReceipt/update-mac.sh"
# 윈도우판 update.ps1과 같은 동작 (API 대신 releases/latest 주소의 이동 위치로 최신 태그를 확인 — jq 불필요)
set -u

REPO="yuseungil-a11y/utinfo_gw_receipt"
INSTALL_ROOT="${UTGWR_ROOT:-$HOME/Library/Application Support/UTGwReceipt}"
EXT_DIR="$INSTALL_ROOT/gw-receipt-helper"
LOG="$INSTALL_ROOT/update.log"
mkdir -p "$INSTALL_ROOT"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }
fail() { log "오류: $*"; exit 1; }

# a > b 이면 0 (버전 주.부.수 비교)
newer() {
  awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 } exit 1 }'
}

manifest_version() {
  sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([0-9.]+)".*/\1/p' "$1" 2>/dev/null | head -1
}

# 최신 태그: https://github.com/<repo>/releases/latest → .../releases/tag/vX.Y.Z 로 이동
loc=$(curl -fsSI --max-time 30 "https://github.com/$REPO/releases/latest" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}' | tail -1)
tag="${loc##*/tag/}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "최신 버전 확인 실패 (네트워크 또는 GitHub 응답: ${loc:-없음})"
latest="${tag#v}"
current=$(manifest_version "$EXT_DIR/manifest.json"); current="${current:-0.0.0}"
base="https://github.com/$REPO/releases/download/$tag"

if newer "$latest" "$current"; then
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/gwr.XXXXXX") || fail "임시 폴더 생성 실패"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --max-time 120 -o "$tmp/ext.zip" "$base/gw-receipt-helper-v$latest.zip" || fail "v$latest 파일 내려받기 실패"
  unzip -q "$tmp/ext.zip" -d "$tmp" || fail "압축 풀기 실패"
  src="$tmp/gw-receipt-helper"
  [ -f "$src/manifest.json" ] || fail "ZIP 구조가 올바르지 않습니다."
  # 같은 경로를 유지해야 크롬이 같은 확장으로 인식해 설정(API 키·결재선)이 보존된다.
  # manifest.json은 맨 마지막에 바꾼다 — 확장은 manifest 버전 변화를 보고 다시 로드하므로 반쯤 복사된 상태를 막는다.
  mkdir -p "$EXT_DIR"
  rsync -a --delete --exclude manifest.json "$src/" "$EXT_DIR/" || fail "파일 복사 실패"
  cp "$src/manifest.json" "$EXT_DIR/manifest.json" || fail "manifest 복사 실패"
  log "업데이트 완료 v$current -> v$latest (크롬은 30분 안에 자동 반영)"
else
  log "최신 상태 (설치 v$current, 최신 v$latest)"
fi

# 스크립트 자신(과 제거 스크립트)도 최신으로 교체. 설치된 버전이 더 높으면(게시판 파일이 먼저 올라간 경우) 되돌리지 않는다.
if ! newer "$current" "$latest"; then
  for f in update-mac.sh uninstall-mac.sh; do
    if curl -fsL --max-time 60 -o "$INSTALL_ROOT/$f.new" "$base/$f" && head -1 "$INSTALL_ROOT/$f.new" | grep -q '^#!/bin/bash'; then
      mv -f "$INSTALL_ROOT/$f.new" "$INSTALL_ROOT/$f"
    else
      rm -f "$INSTALL_ROOT/$f.new"
    fi
  done
fi
exit 0
