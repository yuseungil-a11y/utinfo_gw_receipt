import { ACCOUNTS, MODELS, RELEASES_API, loadSettings, saveSettings, matchProjectFromFileName, modelInfo, costUSD } from "../lib/config.js";
import { probeExpenseForm, fetchGroupwareMeta, fillExpenseRows } from "../lib/gw-page.js";

const MAX_IMAGE_EDGE = 1568; // 이 이상은 Claude가 어차피 축소하므로 미리 줄여 전송량 절감
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const CONCURRENCY = 3;
const META_STALE_MS = 12 * 60 * 60 * 1000; // 12시간 지나면 그룹웨어 목록 자동 갱신

const $ = (sel) => document.querySelector(sel);
let settings = await loadSettings();
// 영수증 1장 = 지출 1건
// { id, file, name, mediaType, previewUrl, status, error, project_id, projectAuto, data }
let items = [];
let seq = 0;

// ---------- 지출 유형(대분류·소분류) ----------
// 그룹웨어에서 불러오기 전에는 카드계정 공지의 계정과목만 대분류로 사용
const majors = () => settings.categories.length
  ? settings.categories
  : ACCOUNTS.map((a) => ({ id: a.name, name: a.name, items: [] }));

// ---------- 설정 ----------
function renderSettings() {
  renderKeyStatus();
  const modelOptions = MODELS.map((m) => `<option value="${m.id}">${escapeHtml(m.label)} ($${m.input}/$${m.output})</option>`).join("");
  $("#model").innerHTML = modelOptions;
  $("#model").value = settings.model;
  $("#quickModel").innerHTML = modelOptions;
  $("#quickModel").value = settings.model;
  renderProjectsField();
  $("#hints").value = settings.hints;
  $("#projectHints").value = settings.projectHints || "";
  $("#recommendProject").checked = settings.recommendProject !== false;
  const line = settings.approvalLine || {};
  $("#lineConsensual").value = line.consensual || "";
  $("#lineApprover").value = line.approver || "";
  $("#lineReceiver").value = line.receiver || "";
  $("#autoApproval").checked = settings.autoApproval !== false;
  renderMetaStatus();
}

function renderProjectsField() {
  $("#projects").value = settings.projects
    .map((p) => [p.id, p.name, (p.aliases || []).join(",")].join("|").replace(/\|$/, ""))
    .join("\n");
}

function renderMetaStatus(extra = "") {
  const t = settings.metaLoadedAt ? new Date(settings.metaLoadedAt).toLocaleString("ko-KR") : "";
  $("#metaStatus").textContent = extra || (t
    ? `${t} 불러옴 · 프로젝트 ${settings.projects.length}개 · 유형 ${settings.categories.reduce((s, m) => s + m.items.length, 0)}개`
    : "아직 불러오지 않음 (기본 목록 사용 중)");
}

function parseProjects(text) {
  const prev = new Map(settings.projects.map((p) => [p.id, p]));
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [id, name, aliases] = l.split("|").map((s) => (s || "").trim());
    return {
      ...prev.get(id),
      id,
      name: name || id,
      aliases: aliases ? aliases.split(",").map((a) => a.trim()).filter(Boolean) : [],
    };
  });
}

$("#btnSettings").onclick = () => { $("#settings").hidden = !$("#settings").hidden; };

// ---------- API 키 (변경·초기화·확인) ----------
// 저장된 키는 입력칸에 다시 채우지 않고 끝 4자리만 보여준다. 새 키를 입력하고 저장하면 교체된다.
const maskKey = (k) => (k ? `sk-ant-…${k.slice(-4)}` : "");
function renderKeyStatus() {
  const st = $("#keyStatus");
  $("#apiKey").value = "";
  if (settings.apiKey) {
    st.textContent = `저장된 키: ${maskKey(settings.apiKey)} — 바꾸려면 새 키를 입력하고 저장`;
    st.className = "keyStatus set";
    $("#apiKey").placeholder = "새 키로 바꿀 때만 입력 (sk-ant-…)";
  } else {
    st.textContent = "저장된 키 없음 — Claude Console에서 발급한 키를 입력하세요";
    st.className = "keyStatus unset";
    $("#apiKey").placeholder = "sk-ant-…";
  }
  $("#btnKeyReset").disabled = !settings.apiKey;
}

function keyMsg(text, cls = "") {
  $("#keyMsg").textContent = text;
  $("#keyMsg").className = cls;
}

$("#btnKeyReset").onclick = async () => {
  if (!confirm("저장된 Claude API 키를 이 PC에서 삭제할까요?\n삭제 후에는 새 키를 입력해야 분석할 수 있습니다.")) return;
  settings.apiKey = "";
  await saveSettings({ apiKey: "" });
  renderKeyStatus();
  keyMsg("키를 삭제했습니다.", "ok");
};

// 입력칸의 새 키(없으면 저장된 키)로 Models API를 호출해 유효한지 확인 — 토큰 비용 없음
$("#btnKeyTest").onclick = async () => {
  const key = $("#apiKey").value.trim() || settings.apiKey;
  if (!key) { keyMsg("확인할 키가 없습니다.", "err"); return; }
  keyMsg("확인 중…");
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    });
    if (res.ok) keyMsg(`사용 가능한 키입니다${$("#apiKey").value.trim() ? " — 저장을 눌러 적용하세요" : ""}.`, "ok");
    else if (res.status === 401) keyMsg("잘못되었거나 폐기된 키입니다 (401).", "err");
    else if (res.status === 403) keyMsg("이 키에 권한이 없습니다 (403).", "err");
    else keyMsg(`확인 실패 (HTTP ${res.status}).`, "err");
  } catch {
    keyMsg("네트워크 오류로 확인하지 못했습니다.", "err");
  }
};

// 메인 화면의 모델 선택 — 바로 저장되고 설정 화면과 동기화
$("#quickModel").onchange = async () => {
  settings.model = $("#quickModel").value;
  $("#model").value = settings.model;
  await saveSettings({ model: settings.model });
};
$("#btnSave").onclick = async () => {
  settings = {
    ...settings,
    // 입력칸이 비어 있으면 기존 키 유지, 새 키를 넣었으면 교체
    apiKey: $("#apiKey").value.trim() || settings.apiKey,
    model: $("#model").value,
    projects: parseProjects($("#projects").value),
    hints: $("#hints").value.trim(),
    projectHints: $("#projectHints").value.trim(),
    recommendProject: $("#recommendProject").checked,
    approvalLine: readApprovalLine(),
    autoApproval: $("#autoApproval").checked,
  };
  await saveSettings(settings);
  $("#quickModel").value = settings.model;
  renderKeyStatus();
  // 프로젝트 목록이 바뀌었을 수 있으니 파일 이름으로 자동 선택했던 항목은 다시 매칭
  items.forEach(rematchProject);
  $("#saveMsg").textContent = "저장됨";
  setTimeout(() => ($("#saveMsg").textContent = ""), 1500);
  render();
};

// ---------- 그룹웨어 연동 ----------
// ---------- 기능 메뉴(탭) ----------
// 새 기능 추가: 여기에 항목을 넣고 sidepanel.html에 <div id="tab-<id>" class="tabpane"> 섹션을 만든다.
// docIds: 이 기능이 동작하는 그룹웨어 화면(/request/registration/<docId>) — 그 화면을 열면 해당 탭을 자동 선택
const FEATURES = [
  { id: "receipt", label: "카드영수증", docIds: ["D005", "D015"], status: "ready" },
  { id: "budget", label: "실행예산 품의", docIds: ["D016"], status: "wip" },
];
let activeFeature = "receipt";

function showFeature(id) {
  if (!FEATURES.some((f) => f.id === id)) id = FEATURES[0].id;
  activeFeature = id;
  for (const f of FEATURES) {
    const pane = $(`#tab-${f.id}`); // 영역을 빠뜨린 기능이 있어도 패널 전체가 멈추지 않도록
    if (pane) pane.hidden = f.id !== id;
    const btn = $(`#tabs [data-tab="${f.id}"]`);
    btn?.classList.toggle("on", f.id === id);
    btn?.setAttribute("aria-selected", String(f.id === id));
  }
  try { localStorage.setItem("gwr.tab", id); } catch { /* 저장 불가해도 무시 */ }
}

function renderTabs() {
  $("#tabs").innerHTML = FEATURES.map((f) =>
    `<button type="button" role="tab" data-tab="${f.id}" title="${f.docIds.join("·")} 화면">${escapeHtml(f.label)}` +
    (f.status === "wip" ? ` <span class="wip">기능구현중</span>` : "") + `</button>`).join("");
  $("#tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) showFeature(b.dataset.tab); };
  let saved = null;
  try { saved = localStorage.getItem("gwr.tab"); } catch { /* 무시 */ }
  showFeature(saved || "receipt");
  // 지금 열린 그룹웨어 화면에 맞는 기능 탭으로 자동 전환
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    const docId = (tab?.url || "").match(/\/request\/registration\/(D\d{3})\b/)?.[1];
    const f = docId && FEATURES.find((x) => x.docIds.includes(docId));
    if (f) showFeature(f.id);
  }).catch(() => {});
}

async function groupwareTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { host = new URL(tab?.url || "").hostname; } catch { /* chrome:// 등 */ }
  if (host !== "uthub.utinfo.co.kr") {
    throw new Error("UTHub(uthub.utinfo.co.kr) 탭을 연 상태에서 눌러주세요.");
  }
  return tab;
}

async function runInPage(func, args = []) {
  const tab = await groupwareTab();
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func, args });
  return result;
}

async function loadMeta({ silent = false } = {}) {
  if (!silent) renderMetaStatus("불러오는 중…");
  try {
    const meta = await runInPage(fetchGroupwareMeta);
    const prev = new Map(settings.projects.map((p) => [p.id, p]));
    const patch = { metaLoadedAt: new Date().toISOString() };
    if (meta.projects.length) {
      // 그룹웨어 목록으로 교체하되, 사용자가 넣은 별칭은 유지.
      // '내 프로젝트' 조회가 실패해 mine이 정해지지 않았으면 이전 값을 유지 (전부 '내 프로젝트 아님'이 되는 것 방지)
      patch.projects = meta.projects.map((p) => ({
        ...p,
        mine: p.mine ?? prev.get(p.id)?.mine,
        aliases: prev.get(p.id)?.aliases || [],
      }));
    }
    if (meta.categories.length) patch.categories = meta.categories;
    settings = { ...settings, ...patch };
    await saveSettings(patch);
    // 목록 관련 칸만 다시 그림 — 저장 전인 API 키·힌트 입력값은 건드리지 않음
    renderProjectsField();
    renderMetaStatus();
    items.forEach(rematchProject);
    render();
    if (meta.warnings.length) {
      if (silent) renderMetaStatus(`⚠ 일부 목록을 불러오지 못함: ${meta.warnings.join(" / ")}`);
      else alert(meta.warnings.join("\n"));
    }
  } catch (e) {
    renderMetaStatus();
    if (!silent) alert(e.message);
  }
}
$("#btnLoadMeta").onclick = () => loadMeta();

async function dumpPage() {
  return `<!-- URL: ${location.href} -->\n` + document.documentElement.outerHTML;
}
$("#btnDump").onclick = async () => {
  try {
    download(await runInPage(dumpPage), `uthub_구조_${stamp()}.html`, "text/html");
  } catch (e) { alert(e.message); }
};
$("#btnProbe").onclick = async () => {
  try {
    download(await runInPage(probeExpenseForm), `uthub_지급품의_진단_${stamp()}.json`, "application/json");
  } catch (e) { alert(e.message); }
};

function download(text, filename, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");

// ---------- 파일 추가 ----------
function applyAutoProject(it) {
  const { id, kind } = matchProjectFromFileName(it.name, settings.projects);
  it.project_id = id;
  it.projectAuto = kind; // "exact" | "similar" | ""
}

function addFiles(fileList) {
  for (const file of fileList) {
    const isPdf = file.type === "application/pdf";
    if (!isPdf && !file.type.startsWith("image/")) continue;
    const it = {
      id: ++seq,
      file,
      name: file.name || `붙여넣기-${seq}.png`,
      mediaType: file.type,
      previewUrl: isPdf ? "" : URL.createObjectURL(file),
      status: "pending",
      error: "",
      project_id: "",
      projectAuto: "",
      data: null,
    };
    applyAutoProject(it);
    items.push(it);
  }
  render();
}

const drop = $("#drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
$("#fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
document.addEventListener("paste", (e) => {
  if (activeFeature !== "receipt") return; // 다른 기능 탭에서는 영수증으로 받지 않음
  const files = [...e.clipboardData.items].filter((i) => i.kind === "file").map((i) => i.getAsFile());
  if (files.length) addFiles(files);
});

// ---------- 프로젝트 일괄 지정 ----------
function projectOptions(selected) {
  return options(
    [
      { value: "", label: "(프로젝트 선택)" },
      ...settings.projects.map((p) => ({ value: p.id, label: `${p.id} ${p.name}${p.mine === false ? " ※내 프로젝트 아님" : ""}` })),
    ],
    selected,
  );
}
// 체크한 영수증에 적용 (영수증별 프로젝트가 여러 개일 때: 울산 건 체크 → 적용, 김천 건 체크 → 적용 …)
$("#btnBulkPicked").onclick = () => {
  const id = $("#bulkProject").value;
  const picked = items.filter((it) => it.picked);
  if (!id) { alert("적용할 프로젝트를 먼저 고르세요."); return; }
  if (!picked.length) { alert("목록에서 적용할 영수증을 체크하세요."); return; }
  picked.forEach((it) => { it.project_id = id; it.projectAuto = ""; it.picked = false; });
  $("#pickAll").checked = false;
  render();
};
// 프로젝트가 비어 있는 영수증에만 적용
$("#btnBulk").onclick = () => {
  const id = $("#bulkProject").value;
  if (!id) { alert("적용할 프로젝트를 먼저 고르세요."); return; }
  items.forEach((it) => { if (!it.project_id) { it.project_id = id; it.projectAuto = ""; } });
  render();
};
$("#pickAll").onchange = () => {
  items.forEach((it) => { it.picked = $("#pickAll").checked; });
  render();
};

// 파일 이름 자동 선택을 다시 계산. 사용자가 직접 고른 것과 Claude 추천은 그대로 둔다.
function rematchProject(it) {
  // 다시 불러온 목록에서 사라진 프로젝트는 비움(화면엔 미선택인데 값만 남는 것 방지)
  if (it.project_id && !settings.projects.some((p) => p.id === it.project_id)) { it.project_id = ""; it.projectAuto = ""; }
  if (it.projectAuto === "claude") return;
  if (it.projectAuto || !it.project_id) applyAutoProject(it);
}

// ---------- 전송용 변환 ----------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function reencode(file, maxEdge, type) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { blob: await canvas.convertToBlob({ type, quality: 0.9 }), scale };
}

async function toPayload(item) {
  if (item.mediaType === "application/pdf") {
    return { mediaType: "application/pdf", base64: await blobToBase64(item.file) };
  }
  const supported = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(item.mediaType);
  const bmp = await createImageBitmap(item.file);
  const small = Math.max(bmp.width, bmp.height) <= MAX_IMAGE_EDGE;
  if (small && supported && item.file.size <= MAX_IMAGE_BYTES) {
    return { mediaType: item.mediaType, base64: await blobToBase64(item.file) };
  }
  const { blob } = await reencode(item.file, MAX_IMAGE_EDGE, "image/jpeg");
  return { mediaType: "image/jpeg", base64: await blobToBase64(blob) };
}

// 그룹웨어 첨부는 jpg/jpeg/png/svg만 허용 → 그 외 이미지는 png로 변환, PDF는 첨부 불가
async function toGroupwareAttachment(item) {
  if (item.mediaType === "application/pdf") return null;
  const ext = item.name.split(".").pop().toLowerCase();
  let blob = item.file, name = item.name, type = item.mediaType;
  if (!["jpg", "jpeg", "png"].includes(ext)) {
    ({ blob } = await reencode(item.file, 10000, "image/png"));
    name = item.name.replace(/\.[^.]*$/, "") + ".png";
    type = "image/png";
  }
  return { name, type, dataUrl: `data:${type};base64,${await blobToBase64(blob)}` };
}

// ---------- 분석 ----------
async function analyzeOne(item) {
  item.status = "analyzing"; item.error = ""; render();
  try {
    const file = await toPayload(item);
    const res = await chrome.runtime.sendMessage({ type: "ANALYZE", file });
    if (!res?.ok) throw new Error(res?.error || "알 수 없는 오류");
    item.data = res.result;
    // Claude 프로젝트 추천: 파일 이름이나 사용자가 이미 정한 프로젝트는 덮어쓰지 않음
    if (!item.project_id && res.result.project_id) {
      item.project_id = res.result.project_id;
      item.projectAuto = "claude";
    }
    item.model = res.model || settings.model; // 서버 대체 모델로 처리됐으면 그 모델
    item.cost = costUSD(item.model, res.usage);
    if (!settings.categories.length) item.data.majorId = item.data.major; // 대분류만 있는 모드: 이름이 곧 ID
    item.status = res.result.is_receipt ? "done" : "empty";
  } catch (e) {
    item.status = "error";
    item.error = e.message || String(e);
  }
  render();
}

$("#btnAnalyze").onclick = async () => {
  if (!settings.apiKey) { $("#settings").hidden = false; $("#apiKey").focus(); return; }
  const queue = items.filter((i) => i.status === "pending" || i.status === "error");
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await analyzeOne(queue.shift());
  });
  await Promise.all(workers);
};

// ---------- 결과 내보내기 / 그룹웨어 입력 ----------
const readyItems = () => items.filter((it) => it.status === "done");

function toRow(it) {
  const { is_receipt, ...d } = it.data;
  const p = settings.projects.find((x) => x.id === it.project_id);
  return { ...d, project_id: it.project_id, project_name: p?.name || "", file_name: it.name };
}

$("#btnExport").onclick = () => {
  download(JSON.stringify(readyItems().map(toRow), null, 2), `영수증분석_${stamp()}.json`, "application/json");
};

$("#btnFill").onclick = async () => {
  const ready = readyItems();
  const problems = [];
  const noProj = ready.filter((it) => !it.project_id).length;
  if (noProj) problems.push(`프로젝트 미선택 ${noProj}건`);
  if (!settings.categories.length) problems.push("지출 유형을 그룹웨어에서 불러오지 않음 (설정 → 그룹웨어에서 불러오기 후, 각 영수증의 대분류·소분류를 직접 고르거나 ✕로 지우고 다시 넣어 분석)");
  const noMinor = ready.filter((it) => !it.data.minorId).length;
  if (settings.categories.length && noMinor) problems.push(`소분류 미선택 ${noMinor}건`);
  if (problems.length) { alert(`입력 전에 확인하세요:\n- ${problems.join("\n- ")}`); return; }

  // 지급품의(개인) D005 / 지급품의(법인) D015 — 두 화면은 지출 목록 구조가 같고 카드구분만 다르다
  let docId;
  try {
    const tab = await groupwareTab();
    docId = tab.url.match(/\/request\/registration\/(D005|D015)\b/)?.[1];
  } catch (e) { alert(e.message); return; }
  if (!docId) {
    alert("지급품의(개인) 또는 지급품의(법인) 신규 요청 화면에서 눌러주세요.\n(uthub.utinfo.co.kr/request/registration/D005 또는 D015)");
    return;
  }
  const expectedCard = docId === "D015" ? "법인카드" : "개인카드";
  const otherCard = docId === "D015" ? "개인카드" : "법인카드";
  const mismatch = ready.filter((it) => it.data.card_type === otherCard);
  if (mismatch.length && !confirm(`지금 화면은 지급품의(${docId === "D015" ? "법인" : "개인"})인데, ${mismatch.length}건은 영수증에서 '${otherCard}'로 읽혔습니다.\n(${mismatch.map((it) => it.name).join(", ")})\n\n그래도 이 화면(${expectedCard})에 입력할까요?`)) return;

  const notMine = ready.filter((it) => settings.projects.find((p) => p.id === it.project_id)?.mine === false);
  if (notMine.length && !confirm(`${notMine.length}건은 '내 프로젝트'가 아니어서 그룹웨어 지출 화면에서 선택되지 않을 수 있습니다. 계속할까요?`)) return;

  // 이미 그룹웨어에 입력한 영수증을 다시 넣으면 같은 지출이 중복으로 생김
  const already = ready.filter((it) => it.filled);
  let targets = ready;
  if (already.length) {
    const fresh = ready.filter((it) => !it.filled);
    if (fresh.length && confirm(`${already.length}건은 이미 그룹웨어에 입력했습니다.\n\n[확인] 아직 입력하지 않은 ${fresh.length}건만 입력\n[취소] 이번 입력 취소`)) {
      targets = fresh;
    } else if (!fresh.length && confirm(`모든 영수증(${already.length}건)을 이미 입력했습니다. 다시 입력하면 같은 지출이 중복으로 생깁니다.\n그래도 다시 입력할까요?`)) {
      targets = ready;
    } else {
      return;
    }
  }

  try {
    const rows = [];
    for (const it of targets) {
      rows.push({
        date: it.data.date,
        amount: it.data.amount,
        majorId: it.data.majorId,
        minorId: it.data.minorId,
        memo: it.data.memo,
        prjId: it.project_id,
        file: await toGroupwareAttachment(it),
      });
    }
    // 설정 입력칸에서 고치고 저장을 안 눌렀어도 화면에 보이는 결재선으로 넣고, 그 값을 저장
    const line = readApprovalLine();
    const autoApproval = $("#autoApproval").checked;
    if (JSON.stringify(line) !== JSON.stringify(settings.approvalLine) || autoApproval !== (settings.autoApproval !== false)) {
      settings = { ...settings, approvalLine: line, autoApproval };
      await saveSettings({ approvalLine: line, autoApproval });
    }
    const res = await runInPage(fillExpenseRows, [rows, $("#autoApproval").checked ? line : null]);
    console.log("fillExpenseRows", res);
    if (res?.ok) { targets.forEach((it) => { it.filled = true; }); render(); }
    alert(res?.message || "그룹웨어 화면에서 응답이 없습니다. 화면을 새로고침한 뒤 다시 시도하세요.");
  } catch (e) {
    console.error(e);
    alert(`입력 실패: ${e.message}`);
  }
};

// 결재선 입력칸 → { consensual, approver, receiver } (쉼표 뒤 공백 정리)
function readApprovalLine() {
  // 쉼표·띄어쓰기·줄바꿈으로 구분, "홍길동(부서)"의 괄호 단서는 한 덩어리로 유지
  const clean = (s) => (s.match(/[^\s,，(]+(?:\s*\([^)]*\))?/g) || []).map((x) => x.trim()).join(", ");
  return { consensual: clean($("#lineConsensual").value), approver: clean($("#lineApprover").value), receiver: clean($("#lineReceiver").value) };
}

$("#btnLine").onclick = async () => {
  const line = readApprovalLine();
  if (!line.consensual && !line.approver && !line.receiver) { alert("합의자·승인자·수신자 중 하나 이상 입력하세요."); return; }
  // 입력칸 값을 바로 저장해 두고 적용
  settings = { ...settings, approvalLine: line };
  await saveSettings({ approvalLine: line });
  try {
    const tab = await groupwareTab();
    if (!/\/request\/registration\/(D005|D015)\b/.test(tab.url)) { alert("지급품의(개인 D005 / 법인 D015) 신규 요청 화면에서 눌러주세요."); return; }
    const res = await runInPage(fillExpenseRows, [[], line]);
    alert(res?.message || "그룹웨어 화면에서 응답이 없습니다. 화면을 새로고침한 뒤 다시 시도하세요.");
  } catch (e) {
    alert(`결재선 지정 실패: ${e.message}`);
  }
};

$("#btnClear").onclick = () => {
  if (items.length && !confirm("목록을 모두 지울까요?")) return;
  items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
  items = [];
  render();
};

// ---------- 렌더링 ----------
const fmt = new Intl.NumberFormat("ko-KR");
const STATUS_TEXT = { pending: "분석 대기", analyzing: "분석 중…", done: "분석 완료", empty: "영수증이 아닌 것 같습니다", error: "오류" };

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function options(list, selected) {
  return list.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === selected ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
}

function render() {
  $("#bulkProject").innerHTML = projectOptions($("#bulkProject").value);
  const list = $("#list");
  list.innerHTML = "";
  for (const it of items) {
    const li = $("#tplItem").content.firstElementChild.cloneNode(true);
    const img = li.querySelector(".thumb");
    if (it.previewUrl) { img.src = it.previewUrl; img.onclick = () => window.open(it.previewUrl); }
    else { img.alt = "PDF"; }
    li.querySelector(".fname").textContent = it.name;
    const st = li.querySelector(".status");
    st.textContent = (it.status === "error" ? `오류: ${it.error}` : STATUS_TEXT[it.status]) + (it.filled ? " · 그룹웨어 입력함" : "");
    st.className = "status " + ({ error: "err", done: "ok", empty: "warn" }[it.status] || "");
    li.querySelector(".remove").onclick = () => { items = items.filter((x) => x !== it); render(); };

    // 프로젝트 (사용자 선택, 파일명 자동매칭)
    const ps = li.querySelector('[data-f="project_id"]');
    ps.innerHTML = projectOptions(it.project_id);
    ps.onchange = () => { it.project_id = ps.value; it.projectAuto = ""; render(); };
    const pc = it.data?.project_confidence;
    const auto = li.querySelector(".auto");
    auto.textContent =
      it.projectAuto === "exact" ? "(파일 이름으로 자동 선택)"
      : it.projectAuto === "similar" ? "(파일 이름과 비슷한 프로젝트 — 확인 필요)"
      : it.projectAuto === "claude" ? `(Claude 추천 ${Math.round((pc || 0) * 100)}% — 확인 필요)`
      : "";
    auto.title = it.projectAuto === "claude"
      ? `${it.data?.project_reason || ""}${it.data?.location ? ` [장소: ${it.data.location}]` : ""}`
      : "";
    // 일괄 지정용 체크박스
    const pick = li.querySelector(".pick");
    pick.checked = !!it.picked;
    pick.onchange = () => { it.picked = pick.checked; li.classList.toggle("picked", it.picked); updatePickCount(); };
    li.classList.toggle("picked", !!it.picked);
    if (!it.project_id) li.classList.add("noproj");
    markUnset(ps, !it.project_id);

    // 분석 결과 (확인·수정용)
    const fields = li.querySelector(".fields");
    const d = it.data;
    if (it.status !== "done" || !d) {
      fields.hidden = true;
    } else {
      const majorSel = li.querySelector('[data-f="majorId"]');
      const minorSel = li.querySelector('[data-f="minorId"]');
      const fillMinor = () => {
        const m = majors().find((x) => x.id === d.majorId);
        minorSel.innerHTML = options([{ value: "", label: "(소분류 선택)" }, ...(m?.items || []).map((s) => ({ value: s.id, label: s.name }))], d.minorId);
        minorSel.disabled = !m?.items?.length;
        markUnset(majorSel, !d.majorId);
        // 소분류가 없는 대분류(목록 미로딩 모드)는 미선택으로 보지 않음
        markUnset(minorSel, !minorSel.disabled && !d.minorId);
      };
      majorSel.innerHTML = options([{ value: "", label: "(대분류 선택)" }, ...majors().map((m) => ({ value: m.id, label: m.name }))], d.majorId);
      fillMinor();
      // 사용자가 유형을 직접 바꾸면 Claude 확률 대신 "직접 선택"으로 표시
      const manualCategory = () => { d.category_confidence = null; setProbs(li, d); updateSummary(); };
      majorSel.onchange = () => {
        d.majorId = majorSel.value;
        d.major = majorSel.selectedOptions[0]?.text || "";
        const m = majors().find((x) => x.id === d.majorId);
        if (!m?.items?.some((s) => s.id === d.minorId)) { d.minorId = ""; d.minor = ""; }
        fillMinor();
        manualCategory();
      };
      minorSel.onchange = () => {
        d.minorId = minorSel.value;
        d.minor = minorSel.selectedOptions[0]?.text || "";
        fillMinor();
        manualCategory();
      };
      setProbs(li, d);
      for (const input of fields.querySelectorAll("input[data-f]")) {
        const f = input.dataset.f;
        input.value = d[f] ?? "";
        input.onchange = () => { d[f] = f === "amount" ? Number(input.value) : input.value; updateSummary(); };
      }
      const modelName = modelInfo(it.model).label.split(" — ")[0].replace("Claude ", "");
      li.querySelector(".reason").textContent =
        `${d.reason}` + (it.model ? ` · ${modelName} · $${(it.cost || 0).toFixed(4)}` : "");
      if ((d.confidence ?? 1) < 0.7) li.classList.add("low");
    }
    list.appendChild(li);
  }
  const todo = items.filter((i) => i.status === "pending" || i.status === "error").length;
  $("#btnAnalyze").textContent = `분석 (${todo})`;
  $("#btnAnalyze").disabled = todo === 0 || items.some((i) => i.status === "analyzing");
  const hasRows = readyItems().length > 0;
  $("#btnFill").disabled = !hasRows;
  $("#btnExport").disabled = !hasRows;
  updatePickCount();
  updateSummary();
}

function updatePickCount() {
  const n = items.filter((it) => it.picked).length;
  $("#btnBulkPicked").textContent = `체크한 영수증에 적용 (${n})`;
  $("#pickAll").checked = items.length > 0 && n === items.length;
}

// 선택 안 된 드롭다운: 빨간 테두리 + 라벨 옆 "미선택"
function markUnset(sel, unset) {
  sel.classList.toggle("unset", !!unset);
  const tag = sel.parentElement.querySelector(".unsetTag");
  if (tag) tag.hidden = !unset;
}

// 확률 배지: 지출일·금액 = 글자 인식 확률, 대분류·소분류 = 유형 분류 확률 (70% 미만 주황, 50% 미만 빨강)
function setProbs(li, d) {
  for (const el of li.querySelectorAll(".prob")) {
    const v = el.dataset.p === "read" ? d.read_confidence : d.category_confidence;
    el.className = "prob";
    if (v === null && el.dataset.p === "category") { el.textContent = "직접 선택"; continue; }
    if (typeof v !== "number") { el.textContent = ""; continue; }
    const pct = Math.round(v * 100);
    el.textContent = `${pct}%`;
    el.title = el.dataset.p === "read" ? "영수증 글자를 정확히 읽었을 확률" : "지출 유형 분류가 맞을 확률";
    if (pct < 50) el.classList.add("low");
    else if (pct < 70) el.classList.add("mid");
  }
}

function updateSummary() {
  const ready = readyItems();
  const noProj = items.filter((i) => !i.project_id).length;
  const noType = ready.filter((it) => !it.data.majorId || (settings.categories.length && !it.data.minorId)).length;
  const apiCost = items.reduce((s, it) => s + (it.cost || 0), 0);
  $("#summary").textContent = items.length
    ? `영수증 ${items.length}장 · 분석 완료 ${ready.length}건 · 합계 ${fmt.format(ready.reduce((s, it) => s + (Number(it.data.amount) || 0), 0))}원` +
      (noProj ? ` · 프로젝트 미선택 ${noProj}건` : "") +
      (noType ? ` · 유형 미선택 ${noType}건` : "") +
      (apiCost ? ` · 분석 비용 $${apiCost.toFixed(3)}` : "")
    : "";
}

// ---------- 시작 ----------
$("#appVersion").textContent = `v${chrome.runtime.getManifest().version}`;
renderTabs();
// 사용 매뉴얼(확장 프로그램에 포함된 manual/index.html)을 새 탭으로
$("#btnManual").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("manual/index.html") });
// 그룹웨어에서 다른 요청 화면으로 옮기거나 다른 탭으로 바꾸면 맞는 기능 탭으로 전환(이 창의 활성 탭만)
const followTab = (tab) => {
  if (!tab?.active || !tab.url) return;
  chrome.windows.getCurrent().then((w) => {
    if (tab.windowId !== w.id) return;
    const docId = tab.url.match(/\/request\/registration\/(D\d{3})\b/)?.[1];
    const f = docId && FEATURES.find((x) => x.docIds.includes(docId));
    if (f) showFeature(f.id);
  }).catch(() => {});
};
chrome.tabs.onUpdated.addListener((_, info, tab) => { if (info.url) followTab(tab); });
chrome.tabs.onActivated.addListener(({ tabId }) => { chrome.tabs.get(tabId).then(followTab).catch(() => {}); });
// 드롭 영역 밖에 파일을 놓아도 브라우저가 파일을 열지 않도록
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (activeFeature !== "receipt" && e.dataTransfer?.files?.length) alert("이 기능은 아직 구현 중입니다. 완성되면 업데이트로 제공됩니다.");
});
renderSettings();
if (!settings.apiKey) $("#settings").hidden = false;
render();
// UTHub 탭이 열려 있고 목록이 오래됐으면 조용히 갱신
if (!settings.metaLoadedAt || Date.now() - new Date(settings.metaLoadedAt).getTime() > META_STALE_MS) {
  loadMeta({ silent: true });
}
// ---------- 업데이트 알림 + "지금 업데이트" ----------
// GitHub Releases에 더 새 버전이 있으면 상단 배너와 업데이트 버튼을 보여준다 (실패하면 조용히 무시).
const isNewer = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// 설치 폴더(디스크)에 있는 버전 — PC 업데이트 스크립트가 파일을 바꾸면 실행 중인 버전보다 높아진다
async function diskVersion() {
  try {
    const res = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    return (await res.json()).version;
  } catch { return ""; }
}

async function checkUpdate() {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    const rel = await res.json();
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    const current = chrome.runtime.getManifest().version;
    if (!latest || !isNewer(latest, current)) return;
    showUpdateBanner(latest, current, rel.html_url);
  } catch { /* 오프라인 등 */ }
}

function showUpdateBanner(latest, current, notesUrl) {
  const banner = $("#updateBanner");
  banner.innerHTML =
    `<div class="row"><span>새 버전 <strong>v${escapeHtml(latest)}</strong>이 있습니다 (현재 v${escapeHtml(current)})</span>` +
    `<button id="btnUpdateNow">지금 업데이트</button></div>` +
    `<small id="updateMsg"><a href="${escapeHtml(notesUrl)}" target="_blank" rel="noopener">변경 내용 보기</a></small>`;
  banner.hidden = false;
  $("#btnUpdateNow").onclick = () => runUpdate(latest);
}

// 1) 이미 새 파일이 설치돼 있으면 바로 다시 로드
// 2) 아니면 PC 업데이트 스크립트를 utgwr-update:// 로 실행 → 새 파일이 생기면 다시 로드
async function runUpdate(latest) {
  const msg = $("#updateMsg");
  const btn = $("#btnUpdateNow");
  if (!isNewer(latest, await diskVersion()) ) {
    msg.textContent = "새 버전을 적용합니다…";
    setTimeout(() => chrome.runtime.reload(), 500);
    return;
  }
  btn.disabled = true;
  const isMac = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || "");
  msg.textContent = `업데이트를 받는 중입니다… (크롬이 '${isMac ? "UTGwReceipt Updater" : "PowerShell"} 열기'를 물으면 허용하세요)`;
  let tab;
  try { tab = await chrome.tabs.create({ url: "utgwr-update://run", active: true }); } catch { /* 무시 */ }
  const started = Date.now();
  // 크롬 확인 창에서 취소했을 수도 있으니 15초 뒤에는 버튼을 다시 누를 수 있게 함
  setTimeout(() => { btn.disabled = false; }, 15000);
  const timer = setInterval(async () => {
    const v = await diskVersion();
    if (v && !isNewer(latest, v)) {
      clearInterval(timer);
      msg.textContent = `v${v} 설치 완료 — 다시 불러옵니다…`;
      if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
      setTimeout(() => chrome.runtime.reload(), 800);
    } else if (Date.now() - started > 120000) {
      clearInterval(timer);
      btn.disabled = false;
      if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
      msg.innerHTML = "업데이트를 확인하지 못했습니다. 잠시 후 다시 누르거나, 1시간 안에 자동으로 업데이트됩니다. " +
        `(계속되면 <code>${isMac ? "~/Library/Application Support/UTGwReceipt/update.log" : "%LOCALAPPDATA%\\UTGwReceipt\\update.log"}</code> 확인)`;
    }
  }, 3000);
}

// 함수·상수 정의가 모두 끝난 뒤 새 버전 확인 (isNewer 등 const 참조 순서 보장)
checkUpdate();
