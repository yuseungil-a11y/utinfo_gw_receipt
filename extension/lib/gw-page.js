// 그룹웨어 페이지의 MAIN world에서 실행되는 함수들.
// chrome.scripting.executeScript({ world: "MAIN", func })로 직렬화되어 들어가므로
// 각 함수는 바깥 변수/import를 참조하지 않는 자기완결형이어야 한다.
// 그룹웨어 API·컴포넌트 구조는 /assets/index-*.js 번들 분석 기준(2026-10-02).

/**
 * 그룹웨어 API로 지출 유형(대분류·소분류)과 프로젝트 목록을 가져온다. 로그인 쿠키로 인증된다.
 * - 지출 유형: GET /api/common/category?mactgCd=D1 (지급품의 D005·D015 화면은 대분류 D202 제외)
 * - 전체 프로젝트: GET /api/project/mng (프로젝트 관리 화면과 동일 API)
 * - 내 프로젝트: GET /api/project/my/list?myProjectAt=Y (지출 화면의 프로젝트 선택칸 목록)
 */
export async function fetchGroupwareMeta() {
  const getJson = async (url) => {
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  };
  const out = { categories: [], projects: [], warnings: [] };

  // 지출 유형
  try {
    const cat = await getJson("/api/common/category?mactgCd=D1");
    const rows = Array.isArray(cat) ? cat : cat.result;
    const majors = [];
    for (const r of rows || []) {
      if (r.mictgCd === "D202") continue;
      let m = majors.find((x) => x.id === r.mictgCd);
      if (!m) majors.push((m = { id: r.mictgCd, name: r.mictgNm, items: [] }));
      m.items.push({ id: r.sbctgCd, name: r.sbctgNm });
    }
    out.categories = majors;
  } catch (e) {
    out.warnings.push(`지출 유형 조회 실패: ${e.message}`);
  }

  // 내 프로젝트 (지출 화면에서 선택 가능한 목록)
  let mine = [];
  try {
    const my = await getJson("/api/project/my/list?myProjectAt=Y");
    mine = (Array.isArray(my) ? my : my.result) || [];
  } catch (e) {
    out.warnings.push(`내 프로젝트 조회 실패: ${e.message}`);
  }
  const mineIds = new Set(mine.map((p) => p.prjId));

  // 전체 프로젝트: 연도 필터 없이 먼저 시도, 비어 있으면 올해·작년으로 조회
  const all = new Map();
  const loadMng = async (year) => {
    const qs = new URLSearchParams({ year, orgNo: "", orgId: "", prjStpDiv: "", prjDtlStpDiv: "", searchType: "", searchText: "", startIdx: 0, endIdx: 100000 });
    const j = await getJson(`/api/project/mng?${qs}`);
    const list = j?.result?.data?.list || j?.data?.list || [];
    for (const p of list) if (p.prjId) all.set(p.prjId, p);
    return list.length;
  };
  try {
    if (!(await loadMng(""))) {
      const y = new Date().getFullYear();
      await loadMng(String(y));
      await loadMng(String(y - 1));
    }
  } catch (e) {
    out.warnings.push(`전체 프로젝트 조회 실패: ${e.message}`);
  }
  for (const p of mine) if (!all.has(p.prjId)) all.set(p.prjId, p);

  out.projects = [...all.values()]
    .map((p) => ({ id: p.prjId, name: p.prjNm || p.prjId, mine: mineIds.has(p.prjId), org: p.excOrgNm || "", end: p.prjEndDt || "" }))
    .sort((a, b) => b.id.localeCompare(a.id));
  return out;
}

/**
 * 지급품의(개인 D005 / 법인 D015) 화면의 지출 목록에 행을 채운다.
 * 두 화면(RequestExpsDecsnRegistration / RequestExpsCmpyRegistration)은 같은 RequestExpsList와 지출 유형을 쓰고,
 * 저장 시 카드구분(D501 개인 / D502 법인)만 화면이 정해 넣는다.
 * 화면 컴포넌트의 React state {expensesList, totalExpsPrc}를 직접 갱신하면
 * 하위 RequestExpsList가 data prop 변경을 받아 행을 다시 그린다. 드롭다운을 클릭으로 조작하지 않으므로 안정적이다.
 * rows: [{ date:"YYYY-MM-DD", amount, majorId, minorId, memo, prjId, file:{name,type,dataUrl}|null }]
 */
export async function fillExpenseRows(rows) {
 try {
  const fiberOf = (el) => {
    const k = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    return k ? el[k] : null;
  };
  const hooksOf = (fiber) => {
    const hooks = [];
    for (let h = fiber?.memoizedState; h && hooks.length < 80; h = h.next) hooks.push(h);
    return hooks;
  };
  const anchor = document.querySelector(".ns-request-expenses") || document.querySelector('input[name="expsStrtDt"]');
  if (!anchor) return { ok: false, message: "지급품의 지출 정보 영역을 찾지 못했습니다. 지급품의(개인/법인) 신규 요청 화면인지 확인하세요." };

  // 위로 올라가며 (1) categoryData를 가진 RequestExpsList, (2) expensesList state를 가진 등록 컴포넌트를 찾는다
  let categoryData = null, listHook = null, formHook = null;
  for (let f = fiberOf(anchor), i = 0; f && i < 200; f = f.return, i++) {
    if (!categoryData && Array.isArray(f.memoizedProps?.categoryData) && f.memoizedProps.categoryData.length) categoryData = f.memoizedProps.categoryData;
    if (typeof f.type !== "function" && typeof f.type?.type !== "function") continue;
    for (const h of hooksOf(f)) {
      const s = h.memoizedState;
      if (!formHook && s && typeof s === "object" && "expensesList" in s && "totalExpsPrc" in s && h.queue?.dispatch) formHook = h;
      if (!listHook && s && typeof s === "object" && Array.isArray(s.newData) && h.queue?.dispatch) listHook = h;
    }
    if (formHook) break;
  }
  // RequestExpsList는 anchor 아래쪽에 있을 수 있으므로 행 요소에서 다시 탐색
  if (!categoryData || !listHook) {
    const rowEl = document.querySelector(".ns-grid-custom-editor");
    for (let f = fiberOf(rowEl), i = 0; f && i < 60; f = f.return, i++) {
      if (!categoryData && Array.isArray(f.memoizedProps?.categoryData) && f.memoizedProps.categoryData.length) categoryData = f.memoizedProps.categoryData;
      if (!listHook) for (const h of hooksOf(f)) if (h.memoizedState && Array.isArray(h.memoizedState.newData) && h.queue?.dispatch) { listHook = h; break; }
    }
  }
  if (!formHook) return { ok: false, message: "화면 state(expensesList)를 찾지 못했습니다. 그룹웨어 화면이 바뀌었을 수 있습니다." };
  if (!categoryData) return { ok: false, message: "지출 유형 목록(categoryData)을 찾지 못했습니다. 화면을 새로고침 후 다시 시도하세요." };

  // fetch(data:URL)는 페이지 CSP(connect-src)에 막힐 수 있어 base64를 직접 디코딩
  const toFile = ({ name, type, dataUrl }) => {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type });
  };

  const warnings = [];
  const newRows = [];
  for (const [i, r] of rows.entries()) {
    const major = categoryData.find((m) => m.id === r.majorId);
    const minor = major?.items?.find((s) => s.id === r.minorId);
    if (!major || !minor) warnings.push(`${i + 1}번(${r.memo || r.date}): 유형을 찾지 못해 비워 둠`);
    newRows.push({
      mictgNm: major || null,
      expsDiv: minor ? minor.id : null,
      expsStrtDt: r.date ? new Date(`${r.date}T00:00:00`) : new Date(),
      expsPrc: Number(r.amount) || 0,
      attchNo: r.file ? toFile(r.file) : null,
      rmrk: (r.memo || "").slice(0, 90),
      prjId: r.prjId || null,
      cpns: null,
    });
    if (!r.file) warnings.push(`${i + 1}번(${r.memo || r.date}): 첨부할 이미지가 없음`);
  }

  // 기존 행 중 내용이 있는 행은 유지하고, 비어 있는 기본 행은 대체
  const current = (listHook?.memoizedState?.newData || formHook.memoizedState.expensesList || []);
  const kept = current.filter((x) => x && (x.attchNo || x.rmrk || (x.expsPrc && x.expsPrc > 0)));
  const merged = [...kept, ...newRows];
  const total = merged.reduce((s, x) => s + (Number(x.expsPrc) || 0), 0);

  formHook.queue.dispatch((prev) => ({ ...prev, expensesList: merged, totalExpsPrc: new Intl.NumberFormat().format(total) }));
  // 화면이 다시 그려지고 프로젝트 콤보박스가 이름을 찾아 표시할 시간을 준 뒤, 선택 안 된 칸을 빨간 점선으로 표시
  await new Promise((r) => setTimeout(r, 900));
  document.querySelectorAll("[data-gwr-unset]").forEach((el) => { el.style.outline = ""; el.style.outlineOffset = ""; el.removeAttribute("data-gwr-unset"); });
  const mark = (el) => { el.style.outline = "3px dashed #e11d1d"; el.style.outlineOffset = "2px"; el.setAttribute("data-gwr-unset", "1"); };
  const unset = [];
  document.querySelectorAll(".ns-grid-custom-editor table.grid-table").forEach((table, idx) => {
    table.querySelectorAll(".k-dropdownlist").forEach((dd) => {
      const t = (dd.querySelector(".k-input-value-text")?.textContent || "").trim();
      if (!t || t === "대분류 선택" || t === "소분류 선택") { mark(dd); unset.push(`${idx + 1}번 ${t || "유형"}`); }
    });
    const prj = table.querySelector(".ns-search-combobox input");
    if (prj && !prj.value.trim()) { mark(prj.closest(".k-combobox") || prj); unset.push(`${idx + 1}번 프로젝트`); }
  });
  if (unset.length) warnings.push(`선택 안 된 칸 ${unset.length}개(화면에 빨간 점선 표시): ${unset.join(", ")}`);
  return {
    ok: true,
    message: `지출 ${newRows.length}건을 입력했습니다 (기존 ${kept.length}건 유지, 합계 ${new Intl.NumberFormat().format(total)}원).` +
      (warnings.length ? `\n\n확인 필요:\n- ${warnings.join("\n- ")}` : "") +
      "\n\n화면에서 내용을 확인하고 승인자·수신자를 지정한 뒤 직접 요청하세요.",
    debug: { formHookFound: !!formHook, listHookFound: !!listHook, categoryCount: categoryData.length },
  };
 } catch (e) {
  return { ok: false, message: `그룹웨어 화면 입력 중 오류: ${e.message}\n${(e.stack || "").split("\n").slice(0, 3).join("\n")}` };
 }
}

/**
 * 지급품의 화면 진단: 첫 지출 행의 각 입력 컨트롤(Kendo React 컴포넌트) props를 요약하고,
 * 유형 대분류를 하나씩 바꿔가며 소분류 목록을 수집한 뒤 원래 값으로 되돌린다.
 */
export async function probeExpenseForm() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fiberOf = (el) => {
    const k = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    return k ? el[k] : null;
  };
  const componentChain = (el, max = 12) => {
    const out = [];
    let f = fiberOf(el);
    for (let i = 0; f && out.length < max && i < 60; i++, f = f.return) {
      if (typeof f.type === "string" || !f.memoizedProps) continue;
      const t = f.type;
      out.push({ name: t?.displayName || t?.name || t?.render?.displayName || t?.render?.name || "?", props: f.memoizedProps });
    }
    return out;
  };
  const summarize = (v, depth = 0, seen = new WeakSet()) => {
    if (typeof v === "function") return "ƒ";
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return `Date(${v.toISOString()})`;
    if (v instanceof Element) return `<${v.tagName.toLowerCase()}>`;
    if (seen.has(v)) return "[circular]";
    seen.add(v);
    if (depth > 3) return Array.isArray(v) ? `[array ${v.length}]` : "[object]";
    if (Array.isArray(v)) return v.slice(0, 60).map((x) => summarize(x, depth + 1, seen));
    const o = {};
    for (const k of Object.keys(v).slice(0, 40)) {
      if (k === "children" || k.startsWith("_") || k === "$$typeof") continue;
      o[k] = summarize(v[k], depth + 1, seen);
    }
    return o;
  };
  const describe = (el) => el ? componentChain(el).map((c) => ({ name: c.name, props: summarize(c.props) })) : null;
  const findDataProps = (el) => componentChain(el, 20).find((c) => Array.isArray(c.props.data) && typeof c.props.onChange === "function")?.props;

  const dateInputs = [...document.querySelectorAll('input[name="expsStrtDt"]')];
  if (!dateInputs.length) return JSON.stringify({ error: "지출일 입력칸(input[name=expsStrtDt])을 찾지 못했습니다. 지급품의 등록 화면인지 확인하세요." });

  const tr0 = dateInputs[0].closest("tr");
  const trs = [tr0];
  for (let i = 0; i < 4 && trs[i].nextElementSibling; i++) trs.push(trs[i].nextElementSibling);
  const q = (tr, sel) => tr?.querySelector(sel) || null;

  const controls = {
    date: dateInputs[0],
    amount: q(trs[0], 'input[role="spinbutton"]'),
    file: q(trs[0], 'input[type="file"]'),
    plusBtn: q(trs[0], ".plusBtn"),
    major: trs[1]?.querySelectorAll(".k-dropdownlist")[0] || null,
    minor: trs[1]?.querySelectorAll(".k-dropdownlist")[1] || null,
    content: q(trs[2], "input"),
    project: q(trs[3], ".ns-search-combobox input"),
    companion: q(trs[4], "input"),
  };

  const report = {
    url: location.href,
    rowCount: dateInputs.length,
    rowHeaders: trs.map((tr) => [...tr.querySelectorAll("th")].map((th) => th.textContent.trim())),
    controls: Object.fromEntries(Object.entries(controls).map(([k, el]) => [k, { found: !!el, chain: describe(el) }])),
    categoryTree: [],
  };

  // 대분류별 소분류 수집
  const majorProps = findDataProps(controls.major);
  if (majorProps) {
    const original = majorProps.value;
    for (const m of majorProps.data) {
      const p = findDataProps(trs[1].querySelectorAll(".k-dropdownlist")[0]);
      p.onChange({ value: m, target: { value: m, name: p.name }, syntheticEvent: new Event("change"), nativeEvent: new Event("change") });
      await sleep(500);
      const minorProps = findDataProps(trs[1].querySelectorAll(".k-dropdownlist")[1]);
      report.categoryTree.push({ major: summarize(m), minors: summarize(minorProps?.data || []) });
    }
    if (original !== undefined) {
      const p = findDataProps(trs[1].querySelectorAll(".k-dropdownlist")[0]);
      p.onChange({ value: original, target: { value: original, name: p.name }, syntheticEvent: new Event("change"), nativeEvent: new Event("change") });
    }
  } else {
    report.categoryTreeError = "대분류 드롭다운의 data/onChange props를 찾지 못했습니다.";
  }
  return JSON.stringify(report, null, 2);
}
