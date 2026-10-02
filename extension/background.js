import { analyzeReceipt } from "./lib/claude.js";
import { loadSettings } from "./lib/config.js";

// 툴바 아이콘 클릭 시 사이드패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "ANALYZE") return false;
  (async () => {
    try {
      const settings = await loadSettings();
      const { result, usage, model } = await analyzeReceipt(msg.file, settings);
      sendResponse({ ok: true, result, usage, model });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // 비동기 응답
});

// ---------- 자동 업데이트 반영 ----------
// PC의 업데이트 스크립트(tools/update.ps1)가 설치 폴더 파일을 새 버전으로 덮어쓰면,
// 디스크의 manifest 버전과 실행 중인 버전이 달라진다 → 확장 프로그램을 다시 읽어 들인다.
const RELOAD_ALARM = "disk-version-check";

function ensureAlarm() {
  chrome.alarms.create(RELOAD_ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== RELOAD_ALARM) return;
  try {
    const res = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    const onDisk = (await res.json()).version;
    const running = chrome.runtime.getManifest().version;
    if (!onDisk || onDisk === running) return;
    // 사용자가 사이드패널로 작업 중이면 다음 확인 때로 미룬다 (reload하면 패널이 닫힘)
    const panels = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
    if (panels.length) return;
    console.log(`업데이트 반영: v${running} → v${onDisk}`);
    chrome.runtime.reload();
  } catch (e) {
    console.warn("버전 확인 실패", e);
  }
});
