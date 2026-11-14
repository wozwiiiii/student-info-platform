"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// cloudfunctions/job-ai-extract/src/index.ts
var index_exports = {};
__export(index_exports, {
  main: () => main
});
module.exports = __toCommonJS(index_exports);
var import_wx_server_sdk = __toESM(require("wx-server-sdk"));

// cloudfunctions/lib/result.ts
function ok(data) {
  return { code: 0, message: "ok", data };
}
function fail(code, message) {
  return { code, message, data: null };
}
function logError(fn, error) {
  console.error(JSON.stringify({ fn, error: error instanceof Error ? error.message : String(error), at: (/* @__PURE__ */ new Date()).toISOString() }));
}

// cloudfunctions/lib/doc.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}

// cloudfunctions/lib/html.ts
async function fetchText(url, timeoutMs = 15e3) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CampusInfoBot/0.1)" }
  });
  if (!res.ok) throw new Error(`\u6293\u53D6\u5931\u8D25 HTTP ${res.status}`);
  return await res.text();
}
function stripTags(html) {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}
function decodeEntities(text) {
  return text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// shared/domain/review-state.ts
var TRANSITIONS = {
  collected: ["ai_extracted", "pending_review"],
  ai_extracted: ["pending_review", "low_confidence"],
  low_confidence: ["pending_review"],
  pending_review: ["published", "rejected"],
  published: ["archived", "expired", "corrected"],
  archived: ["pending_review"],
  expired: ["pending_review"],
  rejected: ["pending_review"],
  corrected: ["pending_review"]
};
function canTransition(from, to) {
  if (from === to) return false;
  if (to === "rejected" || to === "corrected") return true;
  return TRANSITIONS[from].includes(to);
}
var AI_LOW_CONFIDENCE_THRESHOLD = 0.7;

// shared/domain/roadmap.ts
var DAY_MS = 24 * 60 * 60 * 1e3;

// cloudfunctions/lib/llm.ts
var CATEGORY_MAP = {
  opportunity: "opportunity",
  scholarship: "scholarship",
  academic: "academic",
  lecture: "lecture",
  \u673A\u4F1A\u6210\u957F: "opportunity",
  \u5956\u52A9\u8BC4\u4F18: "scholarship",
  \u6559\u52A1\u901A\u77E5: "academic",
  \u8BB2\u5EA7\u6D3B\u52A8: "lecture"
};
var SUBTYPE_MAP = {
  competition: "competition",
  job_internship: "job_internship",
  postgrad: "postgrad",
  other: "other",
  \u7ADE\u8D5B: "competition",
  \u5C31\u4E1A\u5B9E\u4E60: "job_internship",
  \u4FDD\u7814: "postgrad",
  \u5176\u4ED6: "other"
};
var SYSTEM_PROMPT = [
  "\u4F60\u662F\u9AD8\u6821\u4FE1\u606F\u7ED3\u6784\u5316\u52A9\u624B\u3002\u4ECE\u7528\u6237\u7ED9\u51FA\u7684\u6821\u56ED\u901A\u77E5\u539F\u6587\u4E2D\u63D0\u53D6\u5B57\u6BB5\uFF0C\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u8F93\u51FA\u5176\u4ED6\u6587\u5B57\u3002",
  'JSON \u7ED3\u6784\uFF1A{"title":string,"category":"opportunity|scholarship|academic|lecture",',
  '"subType":"competition|job_internship|postgrad|other|null",',
  '"deadline":{"date":"YYYY-MM-DD \u6216 ISO \u65F6\u95F4","precision":"date|datetime"}|null,',
  '"eventTime":\u540C deadline \u7ED3\u6784|null,"location":string|null,"targetAudience":string|null,',
  '"confidence":0\u52301\u7684\u6570\u5B57}',
  "deadline \u6307\u62A5\u540D/\u63D0\u4EA4/\u7533\u8BF7\u7684\u622A\u6B62\u65F6\u95F4\uFF08\u4E0D\u662F\u53D1\u5E03\u65F6\u95F4\uFF09\uFF1Bcategory \u8BED\u4E49\uFF1Aopportunity=\u673A\u4F1A\u6210\u957F(\u7ADE\u8D5B/\u5C31\u4E1A/\u4FDD\u7814)\u3001scholarship=\u5956\u52A9\u8BC4\u4F18\u3001academic=\u6559\u52A1\u901A\u77E5\u3001lecture=\u8BB2\u5EA7\u6D3B\u52A8\uFF1Bconfidence \u8868\u793A\u4F60\u5BF9\u6574\u4F53\u63D0\u53D6\u7ED3\u679C\u7684\u628A\u63E1\u3002"
].join("\n");
function toDeadline(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const d = raw;
  const date = typeof d.date === "string" ? d.date.trim() : "";
  if (!date || Number.isNaN(new Date(date).getTime())) return void 0;
  const precision = d.precision === "datetime" ? "datetime" : "date";
  return { date, precision, tz: "Asia/Shanghai" };
}
function getEnv() {
  return globalThis.process?.env ?? {};
}
async function extractStructured(title, content) {
  const env = getEnv();
  const baseUrl = env.LLM_BASE_URL || "https://api.deepseek.com";
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL || "deepseek-chat";
  if (!apiKey) throw new Error("\u672A\u914D\u7F6E LLM_API_KEY \u73AF\u5883\u53D8\u91CF");
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(3e4),
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `\u6807\u9898\uFF1A${title}

\u6B63\u6587\uFF1A${content.slice(0, 6e3)}` }
      ]
    })
  });
  if (!res.ok) throw new Error(`LLM \u8C03\u7528\u5931\u8D25 HTTP ${res.status}`);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("LLM \u8FD4\u56DE\u975E JSON");
  }
  const category = typeof parsed.category === "string" ? CATEGORY_MAP[parsed.category.trim()] : void 0;
  const subType = typeof parsed.subType === "string" ? SUBTYPE_MAP[parsed.subType.trim()] : void 0;
  const rawConfidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
  const confidence = Math.min(1, Math.max(0, rawConfidence));
  return {
    fields: {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : void 0,
      category,
      subType,
      deadline: toDeadline(parsed.deadline),
      eventTime: toDeadline(parsed.eventTime),
      location: typeof parsed.location === "string" ? parsed.location : void 0,
      targetAudience: typeof parsed.targetAudience === "string" ? parsed.targetAudience : void 0
    },
    confidence,
    model,
    extractedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// cloudfunctions/job-ai-extract/src/index.ts
import_wx_server_sdk.default.init({ env: import_wx_server_sdk.default.DYNAMIC_CURRENT_ENV });
var db = import_wx_server_sdk.default.database();
var INFORMATION = "information";
var BATCH_SIZE = 10;
async function processCollected() {
  const res = await db.collection(INFORMATION).where({ reviewStatus: "collected" }).orderBy("createdAt", "asc").limit(BATCH_SIZE).get();
  let processed = 0;
  let failed = 0;
  for (const doc of res.data) {
    if (!doc._id) continue;
    try {
      let content = doc.content ?? "";
      if (!content && doc.sourceUrl) {
        content = stripTags(await fetchText(doc.sourceUrl)).slice(0, 6e3);
      }
      const extraction = await extractStructured(doc.title, content);
      const target = extraction.confidence >= AI_LOW_CONFIDENCE_THRESHOLD ? "pending_review" : "low_confidence";
      if (!canTransition(doc.reviewStatus, "ai_extracted") || !canTransition("ai_extracted", target)) {
        throw new Error(`\u975E\u6CD5\u72B6\u6001\u8FC1\u79FB: ${doc.reviewStatus} \u2192 ${target}`);
      }
      const patch = {
        aiExtract: extraction,
        reviewStatus: target,
        updatedAt: nowIso()
      };
      if (content && !doc.content) patch.content = content;
      await db.collection(INFORMATION).doc(doc._id).update(patch);
      processed++;
    } catch (error) {
      failed++;
      logError(`job-ai-extract:${doc._id}`, error);
    }
  }
  return ok({ processed, failed, total: res.data.length });
}
async function main(event) {
  try {
    switch (event?.action) {
      case "extract.pending":
      case void 0:
        return await processCollected();
      case "extract.raw": {
        const title = String(event.payload?.title ?? "");
        const content = String(event.payload?.content ?? "");
        if (!title && !content) return fail(400, "\u7F3A\u5C11 title/content");
        return ok(await extractStructured(title, content));
      }
      default:
        return fail(400, `\u672A\u77E5 action: ${String(event?.action)}`);
    }
  } catch (error) {
    logError("job-ai-extract", error);
    return fail(500, "\u670D\u52A1\u5185\u90E8\u9519\u8BEF");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
