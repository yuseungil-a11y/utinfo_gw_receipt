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
  let mineOk = false;
  try {
    const my = await getJson("/api/project/my/list?myProjectAt=Y");
    mine = (Array.isArray(my) ? my : my.result) || [];
    mineOk = true;
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
    // mine: 조회 실패 시 undefined (사이드패널이 이전 값을 유지)
    .map((p) => ({ id: p.prjId, name: p.prjNm || p.prjId, mine: mineOk ? mineIds.has(p.prjId) : undefined, org: p.excOrgNm || "", end: p.prjEndDt || "" }))
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
 * line: { consensual, approver, receiver } — 쉼표로 구분한 이름. 주면 같은 state의 합의자·승인자·수신자 목록도 채운다.
 *   화면의 사람 선택 팝업과 같은 방식: GET /api/employee 결과(emplId·emplNm)로
 *   { appdUserDiv:"P"|"A"|"R", appdEmplId, appdStt:"W", appdEmplInfo:직원 } 항목을 목록에 추가.
 * rows가 비어 있으면 결재선만 지정한다.
 */
export async function fillExpenseRows(rows, line) {
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
  if (rows.length && !categoryData) return { ok: false, message: "지출 유형 목록(categoryData)을 찾지 못했습니다. 화면을 새로고침 후 다시 시도하세요." };

  // fetch(data:URL)는 페이지 CSP(connect-src)에 막힐 수 있어 base64를 직접 디코딩
  const toFile = ({ name, type, dataUrl }) => {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type });
  };

  const warnings = [];
  const done = [];
  const newRows = [];
  for (const [i, r] of rows.entries()) {
    const major = categoryData.find((m) => m.id === r.majorId);
    const minor = major?.items?.find((s) => s.id === r.minorId);
    if (!major || !minor) warnings.push(`${i + 1}번(${r.memo || r.date}): 유형을 찾지 못해 비워 둠`);
    newRows.push({
      mictgNm: major || null,
      expsDiv: minor ? minor.id : null,
      expsStrtDt: (() => {
        const d = r.date ? new Date(`${r.date}T00:00:00`) : null;
        if (d && !isNaN(d)) return d;
        warnings.push(`${i + 1}번(${r.memo || "?"}): 지출일을 읽지 못해 오늘 날짜로 넣음`);
        return new Date();
      })(),
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

  if (rows.length) {
    formHook.queue.dispatch((prev) => ({ ...prev, expensesList: merged, totalExpsPrc: new Intl.NumberFormat().format(total) }));
    done.push(`지출 ${newRows.length}건을 입력했습니다 (기존 ${kept.length}건 유지, 합계 ${new Intl.NumberFormat().format(total)}원).`);
  }

  // 결재선: 이름 → 직원 검색(/api/employee, 화면의 사람 선택 팝업과 같은 API) → 설정한 순서대로 목록 구성
  //  - 설정한 사람은 설정 순서대로 앞에, 설정에 없지만 화면에 이미 있는 사람은 그 뒤에 유지
  //  - 이름 구분: 쉼표·띄어쓰기·줄바꿈. 동명이인 단서는 괄호로: "홍길동(AI모빌리티본부)"
  const LINE = [["consensual", "consensualList", "P", "합의자"], ["approver", "approverList", "A", "승인자"], ["receiver", "receiverList", "R", "수신자"]];
  const splitNames = (s) => (String(s || "").match(/[^\s,，(]+(?:\s*\([^)]*\))?/g) || []).map((x) => x.trim());
  const wanted = LINE.map(([k, ...rest]) => [splitNames(line?.[k]), ...rest]);
  if (wanted.some(([names]) => names.length)) {
    // 결재선은 화면마다 지출 state와 별도 state({approverList, receiverList, consensualList})로 관리되고,
    // 오른쪽 결재선 패널(RequestApprProcess)이 그 값을 data, setter를 setData prop으로 받는다 → 패널에서 위로 올라가며 찾는다
    let lineData = null, setLine = null;
    const panel = document.querySelector("h3.receiptor") || document.querySelector(".approver_none");
    for (let f = fiberOf(panel), i = 0; f && i < 40; f = f.return, i++) {
      const p = f.memoizedProps;
      if (p && p.data && Array.isArray(p.data.approverList) && typeof p.setData === "function") { lineData = p.data; setLine = p.setData; break; }
    }
    // 패널을 못 찾으면: 지출 영역에서 위로 올라가며 결재선 state 훅을 직접 찾는다(등록 화면 컴포넌트가 가진 별도 useState)
    for (let f = fiberOf(anchor), i = 0; !setLine && f && i < 200; f = f.return, i++) {
      if (typeof f.type !== "function" && typeof f.type?.type !== "function") continue;
      for (const h of hooksOf(f)) {
        const s = h.memoizedState;
        if (s && typeof s === "object" && Array.isArray(s.approverList) && h.queue?.dispatch) { lineData = s; setLine = h.queue.dispatch; break; }
      }
    }
    if (!setLine) {
      warnings.push("이 화면에서 결재선 영역(합의자·승인자·수신자)을 찾지 못해 결재선은 지정하지 않음");
    } else {
      let emps = [];
      try {
        const res = await fetch("/api/employee", { credentials: "include", headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        emps = (Array.isArray(j) ? j : j.result) || [];
      } catch (e) {
        warnings.push(`직원 목록 조회 실패(${e.message}) — 결재선은 직접 지정하세요`);
      }
      if (emps.length) {
        const resolved = []; // [listKey, div, label, [직원...]]
        for (const [names, listKey, div, label] of wanted) {
          if (!names.length) continue;
          const people = [];
          for (const raw of names) {
            const m = raw.match(/^([^(]+?)\s*(?:\(([^)]*)\))?$/);
            const name = (m ? m[1] : raw).trim(), hint = (m && m[2] || "").trim();
            let found = emps.filter((e) => e.emplNm === name);
            if (hint) { const sq = (x) => String(x).replace(/\s+/g, ""); found = found.filter((e) => sq(JSON.stringify(e)).includes(sq(hint))); }
            if (!found.length) { warnings.push(`${label} '${raw}': 직원 목록에서 찾지 못함${hint ? " (괄호 안 단서가 맞는지 확인)" : ""}`); continue; }
            if (found.length > 1) { warnings.push(`${label} '${raw}': 같은 이름이 ${found.length}명 — 설정에서 "${name}(부서)"처럼 구분해 주세요`); continue; }
            if (!people.some((p) => p.emplId === found[0].emplId)) people.push(found[0]);
          }
          resolved.push([listKey, div, label, people]);
        }
        // 화면 최신 상태(prev) 기준으로 재구성 — 사용자가 직접 바꾼 내용을 덮어쓰지 않도록
        const build = (prev) => {
          const next = {};
          for (const [listKey, div, , people] of resolved) {
            const cur = prev[listKey] || [];
            const ids = new Set(people.map((p) => p.emplId));
            const ordered = people.map((p) => cur.find((x) => x.appdEmplId === p.emplId) ||
              { appdUserDiv: div, appdEmplId: p.emplId ?? null, appdStt: "W", appdEmplInfo: p });
            next[listKey] = [...ordered, ...cur.filter((x) => !ids.has(x.appdEmplId))];
          }
          return next;
        };
        const preview = build(lineData);
        const added = [];
        for (const [listKey, , label, people] of resolved) {
          const had = new Set((lineData[listKey] || []).map((x) => x.appdEmplId));
          const fresh = people.filter((p) => !had.has(p.emplId));
          fresh.forEach((p) => added.push(`${label} ${p.emplNm}`));
          if (people.length && !fresh.length && (lineData[listKey] || []).map((x) => x.appdEmplId).join() !== preview[listKey].map((x) => x.appdEmplId).join()) added.push(`${label} 순서 정리`);
        }
        if (resolved.some(([, , , people]) => people.length)) {
          setLine((prev) => ({ ...prev, ...build(prev) }));
          done.push(added.length ? `결재선을 지정했습니다: ${added.join(", ")}` : "결재선은 설정한 사람이 이미 모두 지정되어 있습니다.");
        }
      }
    }
  }
  if (!rows.length) {
    return {
      ok: done.length > 0,
      message: (done.join("\n") || "결재선을 지정하지 못했습니다.") + (warnings.length ? `\n\n확인 필요:\n- ${warnings.join("\n- ")}` : ""),
    };
  }

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
    message: done.join("\n") +
      (warnings.length ? `\n\n확인 필요:\n- ${warnings.join("\n- ")}` : "") +
      "\n\n화면에서 내용과 결재선(합의자·승인자·수신자)을 확인한 뒤 직접 완료(요청)하세요.",
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
