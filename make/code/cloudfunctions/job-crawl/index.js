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

// cloudfunctions/job-crawl/src/index.ts
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
function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? "";
    const text = decodeEntities(stripTags(m[2] ?? "")).trim();
    if (!text) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") {
        links.push({ url: abs.toString(), text });
      }
    } catch {
    }
  }
  return links;
}

// cloudfunctions/lib/classify.ts
function classifyByTitle(title) {
  if (/保研|推免/.test(title)) return { category: "opportunity", subType: "postgrad" };
  if (/竞赛|大赛|比赛/.test(title)) return { category: "opportunity", subType: "competition" };
  if (/招聘|实习|就业|校招|宣讲/.test(title)) return { category: "opportunity", subType: "job_internship" };
  if (/奖学金|助学|评优|表彰/.test(title)) return { category: "scholarship" };
  if (/讲座|活动|论坛/.test(title)) return { category: "lecture" };
  return { category: "academic" };
}
var CRAWL_KEYWORDS = /通知|公告|报名|竞赛|大赛|比赛|招聘|实习|就业|校招|宣讲|保研|推免|奖学金|助学|评优|讲座|活动|选拔/;

// shared/domain/content-hash.ts
function normalizeTitle(title) {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function computeContentHash(title, sourceChannel) {
  return hashString(`${normalizeTitle(title)}|${sourceChannel.trim().toLowerCase()}`);
}

// shared/domain/roadmap.ts
var DAY_MS = 24 * 60 * 60 * 1e3;

// cloudfunctions/job-crawl/src/index.ts
import_wx_server_sdk.default.init({ env: import_wx_server_sdk.default.DYNAMIC_CURRENT_ENV });
var db = import_wx_server_sdk.default.database();
var INFORMATION = "information";
var SOURCES = "source";
var MAX_LINKS_PER_SOURCE = 10;
async function crawlOne(source) {
  const url = source.homepageUrl;
  if (!url || !source._id) return { added: 0, failed: true };
  try {
    const html = await fetchText(url);
    const links = extractLinks(html, url).filter((l) => CRAWL_KEYWORDS.test(l.text)).slice(0, MAX_LINKS_PER_SOURCE);
    let added = 0;
    for (const link of links) {
      const contentHash = computeContentHash(link.text, source.name || link.url);
      const dup = await db.collection(INFORMATION).where({ contentHash }).limit(1).get();
      if (dup.data.length > 0) continue;
      const { category, subType } = classifyByTitle(link.text);
      const doc = {
        title: link.text,
        category,
        subType,
        deadlineVerifiedByHuman: false,
        sourceUrl: link.url,
        sourceChannel: source.name,
        sourceType: "official_site",
        contentHash,
        reviewStatus: "collected",
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await db.collection(INFORMATION).add(doc);
      added++;
    }
    await db.collection(SOURCES).doc(source._id).update({
      lastFetchedAt: nowIso(),
      reliability: Math.min(1, (source.reliability ?? 0.5) + 0.02),
      updatedAt: nowIso()
    });
    return { added, failed: false };
  } catch (error) {
    logError(`job-crawl:${source.name}`, error);
    await db.collection(SOURCES).doc(source._id).update({
      reliability: Math.max(0, (source.reliability ?? 0.5) - 0.1),
      updatedAt: nowIso()
    });
    return { added: 0, failed: true };
  }
}
async function runCrawl() {
  const res = await db.collection(SOURCES).where({ monitorMethod: "scheduled_crawl" }).limit(20).get();
  let added = 0;
  let failedSources = 0;
  for (const source of res.data) {
    const r = await crawlOne(source);
    added += r.added;
    if (r.failed) failedSources++;
  }
  return ok({ sources: res.data.length, added, failedSources });
}
async function main(event) {
  try {
    switch (event?.action) {
      case "crawl.run":
      case void 0:
        return await runCrawl();
      default:
        return fail(400, `\u672A\u77E5 action: ${String(event?.action)}`);
    }
  } catch (error) {
    logError("job-crawl", error);
    return fail(500, "\u670D\u52A1\u5185\u90E8\u9519\u8BEF");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
