// 계정과목 기준: 사내 공지 "카드사용내역 작성 시 참조할 계정" (카드계정.txt)
export const ACCOUNTS = [
  { name: "복리후생비", desc: "내부 직원을 위해 업무 외 목적으로 사용하는 비용. 회식비, 식비(음료 포함) 등" },
  { name: "여비교통비", desc: "출장, 외부 업체와의 미팅 등 시 업무목적으로 사용하는 비용. 숙박비, 식비, 교통비(톨비 포함) 등. 개인차량 유류비, 후불하이패스카드 충전비도 여기에 포함" },
  { name: "접대비", desc: "접대를 목적으로 외부 인력을 위해 사용하는 비용. 식비, 골프비 등" },
  { name: "통신비", desc: "프로젝트 사무실 통신비, 무선모뎀 통신비 등" },
  { name: "수도광열비", desc: "프로젝트 사무실 등의 수도, 난방, 가스 요금 등" },
  { name: "전력비", desc: "프로젝트 사무실, 현장설비 등의 전기신청비 및 전기사용 요금 등" },
  { name: "차량유지비", desc: "법인차량 유류비, 수리비 등 (개인차량 유류비·후불하이패스 충전비는 여비교통비)" },
  { name: "운반비", desc: "택배(우편 포함), 퀵서비스 비용 등" },
  { name: "교육훈련비", desc: "내외부 교육 시 발생하는 비용. 숙박비, 식비, 교통비 등" },
  { name: "도서인쇄비", desc: "자료나 제안서 등의 인쇄에 따른 비용" },
  { name: "사무용품비", desc: "사무용품의 구매에 따른 비용. 업무용 PC(노트북 포함) 구매 비용도 포함" },
  { name: "소모품비", desc: "업무에 필요한 자재나 도구를 구매하거나 임대하기 위한 비용. 복사용지, 사무용품, 생수, 허브, 랜선 등" },
  { name: "지급수수료", desc: "서류 발급 등으로 인해 발생하는 비용. 예: 공채매입비, 보험료 등" },
  { name: "잡비", desc: "위에 해당하지 않는 비용" },
];

export const CARD_TYPES = ["개인카드", "법인카드", "현금", "미상"];

// 프로젝트 목록은 그룹웨어(/api/project/mng)에서 불러온다. 코드에는 사내 프로젝트명을 두지 않는다.
export const DEFAULT_PROJECTS = [];

// 새 버전 알림: GitHub Releases의 최신 태그와 manifest 버전을 비교
export const RELEASES_API = "https://api.github.com/repos/yuseungil-a11y/utinfo_gw_receipt/releases/latest";

// 가격: 100만 토큰당 USD (입력/출력). 2026-09 기준 공개 가격. 사이드패널의 영수증별 비용 표시에 쓴다.
export const MODELS = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1 — 최고 성능, 가장 비쌈", input: 10, output: 50, effort: true, fallbacks: true },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — 기본, 정확도 우선", input: 4, output: 20, effort: true, fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — 빠르고 절반 가격", input: 2, output: 10, effort: true, fallbacks: true },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — 최저가", input: 1, output: 5, effort: false, fallbacks: false },
];

// 응답 모델 ID에 날짜 등이 붙어 와도(예: claude-haiku-4-5-20251001) 앞부분으로 찾는다
export const modelInfo = (id) =>
  MODELS.find((m) => m.id === id) || MODELS.find((m) => String(id || "").startsWith(m.id)) || MODELS[1];

/** API 응답 usage로 비용(USD) 계산 */
export function costUSD(modelId, usage) {
  if (!usage) return 0;
  const m = modelInfo(modelId);
  // 캐시 쓰기는 입력 단가의 1.25배, 캐시 읽기는 0.1배
  const inCost = (usage.input_tokens || 0) * m.input
    + (usage.cache_creation_input_tokens || 0) * m.input * 1.25
    + (usage.cache_read_input_tokens || 0) * m.input * 0.1;
  return (inCost + (usage.output_tokens || 0) * m.output) / 1e6;
}

export const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-opus-5-5",
  projects: DEFAULT_PROJECTS,   // [{ id, name, aliases?, mine? }] — 그룹웨어에서 불러오면 갱신
  categories: [],               // [{ id, name, items:[{ id, name }] }] — 그룹웨어 지출 유형(대분류·소분류)
  metaLoadedAt: "",             // 그룹웨어에서 마지막으로 불러온 시각
  hints: "",                    // 지출 유형 분류 힌트
  recommendProject: true,       // 분석 시 Claude가 장소 단서로 프로젝트 추천
  projectHints: "",             // 지역·업체 → 프로젝트 연결 힌트
  // 결재선: 이름을 쉼표로 구분(순서 = 결재 순서). 동명이인은 "홍길동(부서)"처럼 부서·직급을 덧붙임
  approvalLine: { consensual: "", approver: "", receiver: "" },
  autoApproval: true,           // 그룹웨어에 입력할 때 결재선도 함께 지정
};

const norm = (s) => String(s || "").toLowerCase().replace(/[\s_\-()\[\].·~,]/g, "");

// 파일 이름에 흔히 붙는 영수증·날짜 관련 단어 — 프로젝트 유사도 판단에서 제외
const FILE_STOPWORDS = new Set([
  "영수증", "카드", "전표", "매출전표", "교통비", "식대", "식비", "숙박", "숙박비", "주유", "택시", "하이패스",
  "ktx", "srt", "출장", "회식", "야근", "그림", "사진", "스캔", "image", "img", "scan", "photo", "screenshot", "캡처",
]);

const tokenize = (s) => String(s || "").toLowerCase().split(/[^0-9a-z가-힣]+/).filter(Boolean);

/**
 * 파일 이름으로 프로젝트를 고른다. 반환: { id, kind: "exact" | "similar" | "" }
 * 1) 정확 일치: 프로젝트 ID("26-PRJ-0006"/"PRJ-0006"/"prj0006"), 이름 전체, 별칭이 파일 이름에 포함
 * 2) 유사 일치: 파일 이름 단어와 프로젝트 이름·별칭이 두 글자 단위로 겹치는 수로 점수. 2점 이상이고 1등이 단독일 때만 선택
 */
export function matchProjectFromFileName(fileName, projects) {
  const base = String(fileName || "").replace(/\.[^.]+$/, "");
  const nb = norm(base);

  // 0) 프로젝트 번호: 연도 2자리/4자리, 번호 자릿수 무관 — "2026-PRJ-005", "26-PRJ-0005", "26PRJ5" 모두 26-PRJ-0005
  const num = base.match(/(?:^|[^0-9])(\d{4}|\d{2})\s*[-_ ]?\s*prj\s*[-_ ]?\s*(\d{1,4})(?!\d)/i);
  let byNumber = "";
  if (num) {
    const want = `${num[1].slice(-2)}-PRJ-${num[2].padStart(4, "0")}`;
    byNumber = projects.find((p) => p.id.toUpperCase() === want)?.id || "";
  }
  if (byNumber) {
    // 파일 이름에 적힌 프로젝트 이름이 다른 프로젝트를 강하게 가리키면 번호 오기로 보고 이름 쪽을 '확인 필요'로 선택
    const byName = similarProject(base.replace(num[0], " "), projects);
    if (byName.id && byName.id !== byNumber && byName.score >= 6) return { id: byName.id, kind: "similar" };
    return { id: byNumber, kind: "exact" };
  }

  let exact = { id: "", len: 0 };
  for (const p of projects) {
    const prjNo = p.id.match(/prj-?(\d+)/i)?.[1];
    const keys = [p.id, p.name, ...(p.aliases || [])];
    if (prjNo) keys.push(`prj${prjNo}`);
    for (const k of keys) {
      const nk = norm(k);
      if (nk.length >= 2 && nb.includes(nk) && nk.length > exact.len) exact = { id: p.id, len: nk.length };
    }
  }
  if (exact.id) return { id: exact.id, kind: "exact" };

  const sim = similarProject(base, projects);
  return sim.id ? { id: sim.id, kind: "similar" } : { id: "", kind: "" };
}

/** 파일 이름 단어와 프로젝트 이름·별칭의 유사도로 가장 비슷한 프로젝트. 1등이 단독이고 2점 이상일 때만 id */
function similarProject(base, projects) {
  // 두 글자 이하 영문·숫자(예: "AI", "TF")는 흔해서 오선택을 부르므로 유사 판단에서 제외
  const words = tokenize(base).filter((w) =>
    w.length >= 2 && !/^\d+$/.test(w) && !/^\d+월$/.test(w) && !FILE_STOPWORDS.has(w) && !/^[a-z0-9]{1,2}$/.test(w) && w !== "prj");
  if (!words.length) return { id: "", score: 0 };

  // 두 글자 단위(bigram)로 겹치는 수를 센다: "울산자율주행" vs "울산시 자율주행" → 울산·자율·율주·주행 4점
  const bigrams = (w) => { const out = []; for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2)); return out; };
  const fileGrams = [...new Set(words.flatMap(bigrams))];
  const scored = projects.map((p) => {
    const target = norm([p.name, ...(p.aliases || [])].join(" "));
    const gramScore = fileGrams.filter((g) => target.includes(g)).length;
    const wordBonus = words.filter((w) => target.includes(w)).length; // "울산"처럼 한 단어가 통째로 들어 있으면 가산
    return { id: p.id, score: gramScore + wordBonus };
  }).sort((a, b) => b.score - a.score);

  const [first, second] = scored;
  if (first && first.score >= 2 && first.score > (second?.score || 0)) return { id: first.id, score: first.score };
  return { id: "", score: first?.score || 0 };
}

export async function loadSettings() {
  const s = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}
