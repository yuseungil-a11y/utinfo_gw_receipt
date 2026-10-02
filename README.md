# UTHub 카드영수증 도우미

카드영수증 이미지를 Claude로 분석해 UTHub 지급품의(개인 D005·법인 D015) 화면에 영수증 수만큼 지출 행(지출일·금액·유형 대분류/소분류·내용·프로젝트·첨부)을 자동 입력하는 크롬 확장 프로그램입니다.

새 버전이 나오면 사이드패널 상단 배너의 **지금 업데이트** 버튼(설치 시 등록되는 현재 사용자용 URL 프로토콜 `utgwr-update://` → `update.ps1` 실행)이나 1시간 주기 작업 스케줄러로 적용됩니다.

- 설치·사용 매뉴얼: 배포 담당자에게 받은 매뉴얼 링크 참조
- 버그·기능 요청: [Issues](../../issues/new/choose) (영수증 원본 이미지는 첨부 금지)
- 최신 버전: [Releases](../../releases/latest)

## 설치 (PC당 1회)

1. [최신 Release](../../releases/latest)에서 `install.ps1`을 내려받아 우클릭 → PowerShell에서 실행
2. `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `%LOCALAPPDATA%\UTGwReceipt\gw-receipt-helper` 선택

이후에는 작업 스케줄러(`UTGwReceipt-AutoUpdate`)가 1시간마다 새 Release를 확인해 설치 폴더를 교체하고, 확장 프로그램은 30분 안에 스스로 다시 로드합니다. 제거는 `uninstall.ps1`.

## 구조

| 경로 | 역할 |
| --- | --- |
| `extension/manifest.json` | Manifest V3, 버전 번호 |
| `extension/sidepanel/` | 사이드패널 UI (영수증 추가·분석·확인·입력) |
| `extension/lib/claude.js` | Claude API 호출 (영수증 → 지출일·금액·유형) |
| `extension/lib/gw-page.js` | 그룹웨어 탭 안에서 실행: 목록 조회(`/api/common/category`, `/api/project/mng`, `/api/project/my/list`), 지출 행 입력 |
| `extension/lib/config.js` | 계정과목 기준, 설정 저장, 파일 이름 → 프로젝트 매칭 |
| `tools/install.ps1` · `update.ps1` · `uninstall.ps1` | PC 설치, 1시간 주기 자동 업데이트, 제거 |
| `build.ps1` | 로컬에서 배포 ZIP 생성 (`dist/`) |
| `.github/workflows/release.yml` | `v*` 태그 push → ZIP 빌드 → GitHub Release (+ 선택: 크롬 웹스토어 게시) |

## 새 버전 배포

버전은 `주.부.수` — 버그 수정은 세 번째(0.1.0→0.1.1), 기능 추가는 두 번째(0.1.1→0.2.0), 큰 개편은 첫 번째 자리를 올립니다.

1. `extension/manifest.json`의 `version`을 올립니다.
2. 커밋 후 같은 번호의 태그를 push합니다: `git tag v0.1.1 && git push origin v0.1.1`
3. GitHub Actions가 Release를 만들고, 각 PC가 1시간 안에 자동 업데이트합니다.

크롬 웹스토어 자동 게시를 쓰려면 저장소 Secrets에 `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`을 등록합니다. 등록하지 않으면 그 단계는 건너뜁니다.

## 주의

그룹웨어 입력은 화면의 React 상태를 직접 갱신하는 방식입니다(`gw-page.js`). 그룹웨어 화면이 개편되면 "화면 state를 찾지 못했습니다" 오류가 날 수 있으며, 사이드패널 ⚙ 설정 → 진단 도구로 구조를 확인해 수정합니다.
