import { ACCOUNTS, CARD_TYPES, modelInfo } from "./config.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const SEP = " > ";

/**
 * 분류 선택지: 그룹웨어에서 불러온 대분류·소분류가 있으면 "대분류 > 소분류" 조합,
 * 없으면 카드계정 공지의 계정과목(대분류)만.
 */
export function categoryChoices(categories) {
  if (categories?.length) {
    return categories.flatMap((m) => m.items.map((s) => ({ key: `${m.name}${SEP}${s.name}`, majorId: m.id, major: m.name, minorId: s.id, minor: s.name })));
  }
  return ACCOUNTS.map((a) => ({ key: a.name, majorId: "", major: a.name, minorId: "", minor: "" }));
}

/**
 * 프로젝트 추천 후보: 그룹웨어 지출 화면에서 실제로 고를 수 있는 "내 프로젝트"만.
 * (mine 정보가 없는 기본 목록이면 전체)
 */
export function projectCandidates(projects) {
  const list = projects || [];
  const mine = list.filter((p) => p.mine === true);
  return mine.length ? mine : list.filter((p) => p.mine !== false);
}

// 이 지시문은 같은 설정이면 영수증마다 똑같으므로 프롬프트 캐시 대상(system 블록에 cache_control)
function buildSystemPrompt({ categories, hints, candidates, projectHints }) {
  const desc = Object.fromEntries(ACCOUNTS.map((a) => [a.name, a.desc]));
  const categoryLines = categories?.length
    ? categories.map((m) => `- ${m.name}${desc[m.name] ? ` (${desc[m.name]})` : ""}\n${m.items.map((s) => `    · ${m.name}${SEP}${s.name}`).join("\n")}`).join("\n")
    : ACCOUNTS.map((a) => `- ${a.name}: ${a.desc}`).join("\n");

  const projectRules = candidates.length ? `
- location: 영수증에서 알 수 있는 장소 단서(가맹점 주소의 시·구, 하이패스 출발→도착 영업소, 열차 출발→도착역 등). 없으면 "".
- project_id: 아래 프로젝트 중 이 지출이 속할 가능성이 가장 높은 것의 ID. 장소 단서·가맹점·프로젝트 힌트로 판단합니다.
  근거가 없으면(예: 사무실 근처 식당처럼 장소로 구분되지 않음) 억지로 고르지 말고 ""로 둡니다.
- project_confidence: 0~1. 그 프로젝트가 맞을 확률. project_id가 ""이면 0.
- project_reason: 그 프로젝트를 고른(또는 고르지 않은) 근거 한 줄.` : "";

  const projectSection = candidates.length ? `

프로젝트 목록 (ID: 이름):
${candidates.map((p) => `- ${p.id}: ${p.name}${p.aliases?.length ? ` (별칭: ${p.aliases.join(", ")})` : ""}`).join("\n")}
${projectHints ? `\n프로젝트 힌트 (우선 적용):\n${projectHints}\n` : ""}` : "";

  return `당신은 유티정보 직원의 카드영수증(카드매출전표, 하이패스 내역, 간이영수증 등) 이미지를 읽어 그룹웨어 지급품의에 입력할 값을 만드는 경리 보조입니다.
영수증 1장은 지출 1건입니다.

필드 규칙:
- is_receipt: 영수증·결제내역이 맞으면 true. 아니면 false로 하고 나머지는 빈 값/0.
- date: 거래일자(YYYY-MM-DD). 하이패스는 통행일자. 결제일·청구일이 따로 있어도 사용일을 씁니다.
- merchant: 가맹점명(상호). 하이패스는 "하이패스 (출발지→도착지)".
- amount: 실제 결제 합계 금액(원, 정수). 취소 전표면 음수.
- card_type: 전표에 개인/법인 구분이 보이면 그 값, 모르면 "미상".
- card_no: 카드번호에서 보이는 끝 4자리, 없으면 "".
- category: 아래 지출 유형 중 하나를 그대로 고릅니다. 기준을 따르고, 애매하면 가장 그럴듯한 것을 고른 뒤 category_confidence를 낮추세요.
- memo: 지급품의 "내용"란에 쓸 짧은 지출내역(예: "KTX 서울→대전", "야근 식대", "부산 출장 숙박"). 90자 이내.
- reason: 유형을 그렇게 고른 근거 한 줄.
- read_confidence: 0~1. 날짜·금액·가맹점을 정확히 읽었을 확률(흐림, 잘림, 손글씨면 낮게).
- category_confidence: 0~1. 고른 지출 유형(대분류·소분류)이 맞을 확률(직원 식대인지 접대인지처럼 애매하면 낮게).${projectRules}

지출 유형:
${categoryLines}

계정 기준 공지 요약: 개인차량 유류비·후불하이패스 충전비는 여비교통비, 법인차량 유류비·수리비는 차량유지비, 내부 직원 회식·식비는 복리후생비, 외부인 접대는 접대비.
${hints ? `\n사용자 분류 힌트 (우선 적용):\n${hints}\n` : ""}${projectSection}`;
}

function buildSchema(choices, candidates) {
  const required = ["is_receipt", "date", "merchant", "amount", "card_type", "card_no", "category", "memo", "reason", "read_confidence", "category_confidence"];
  const properties = {
    is_receipt: { type: "boolean" },
    date: { type: "string" },
    merchant: { type: "string" },
    amount: { type: "integer" },
    card_type: { type: "string", enum: CARD_TYPES },
    card_no: { type: "string" },
    category: { type: "string", enum: choices.map((c) => c.key) },
    memo: { type: "string" },
    reason: { type: "string" },
    read_confidence: { type: "number" },
    category_confidence: { type: "number" },
  };
  if (candidates.length) {
    required.push("location", "project_id", "project_confidence", "project_reason");
    properties.location = { type: "string" };
    properties.project_id = { type: "string", enum: ["", ...candidates.map((p) => p.id)] };
    properties.project_confidence = { type: "number" };
    properties.project_reason = { type: "string" };
  }
  return { type: "object", additionalProperties: false, required, properties };
}

/**
 * 영수증 1개(이미지 또는 PDF)를 분석해 지출 1건을 돌려준다.
 * file: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf", base64 }
 * 반환 result: { is_receipt, date, merchant, amount, card_type, card_no, majorId, major, minorId, minor, memo, reason,
 *               read_confidence, category_confidence, confidence, location?, project_id?, project_confidence?, project_reason? }
 */
export async function analyzeReceipt(file, settings) {
  const { apiKey, model, hints, categories, projects, recommendProject, projectHints } = settings;
  if (!apiKey) throw new Error("API 키가 설정되지 않았습니다. 사이드패널 설정에서 입력하세요.");
  const choices = categoryChoices(categories);
  const candidates = recommendProject === false ? [] : projectCandidates(projects);

  const source = { type: "base64", media_type: file.mediaType, data: file.base64 };
  const fileBlock = file.mediaType === "application/pdf"
    ? { type: "document", source }
    : { type: "image", source };

  const body = {
    model,
    max_tokens: 2048,
    // 영수증마다 같은 지시문(유형·프로젝트 목록) → 캐시해 두 번째 영수증부터 입력 비용 절감
    system: [{ type: "text", text: buildSystemPrompt({ categories, hints, candidates, projectHints }), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: "이 영수증을 분석하세요." }] }],
    output_config: { format: { type: "json_schema", schema: buildSchema(choices, candidates) } },
  };

  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };

  const info = modelInfo(model);
  // 단순 추출·분류 작업이라 effort는 low. Haiku 4.5는 effort 미지원.
  if (info.effort) body.output_config.effort = "low";
  // Fable 5.1 / Opus 5.5 / Sonnet 5.5: 안전 분류기 거절 시 서버가 다른 모델로 자동 재시도
  if (info.fallbacks) {
    body.fallbacks = "default";
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  }

  const res = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || res.statusText;
    if (res.status === 401) throw new Error("API 키가 올바르지 않습니다 (401).");
    if (res.status === 429) throw new Error("요청 한도 초과 (429). 잠시 후 다시 시도하세요.");
    throw new Error(`Claude API 오류 ${res.status}: ${msg}`);
  }
  if (json.stop_reason === "refusal") throw new Error("Claude가 이 이미지 처리를 거절했습니다.");
  if (json.stop_reason === "max_tokens") throw new Error("응답이 잘렸습니다 (max_tokens).");

  const text = json.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("응답에 결과가 없습니다.");
  const { category, ...rest } = JSON.parse(text);
  const c = choices.find((x) => x.key === category) || {};
  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  rest.read_confidence = clamp(rest.read_confidence);
  rest.category_confidence = clamp(rest.category_confidence);
  rest.confidence = Math.min(rest.read_confidence, rest.category_confidence); // 종합(낮은 쪽) — 주황 테두리 기준
  if ("project_id" in rest) rest.project_confidence = rest.project_id ? clamp(rest.project_confidence) : 0;
  return {
    result: { ...rest, majorId: c.majorId || "", major: c.major || "", minorId: c.minorId || "", minor: c.minor || "" },
    usage: json.usage,
    model: json.model,
  };
}
