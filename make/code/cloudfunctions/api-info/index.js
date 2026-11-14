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

// cloudfunctions/api-info/src/index.ts
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

// shared/domain/deadline.ts
var TZ_OFFSET = "+08:00";
function getDeadlineInstant(deadline) {
  if (deadline.precision === "date") {
    return /* @__PURE__ */ new Date(`${deadline.date.slice(0, 10)}T23:59:59${TZ_OFFSET}`);
  }
  return new Date(deadline.date);
}

// shared/domain/roadmap.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
function groupNodesByYearSemester(nodes) {
  const buckets = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const key = `${node.year}-${node.semester}`;
    const group = buckets.get(key);
    if (group) {
      group.nodes.push(node);
    } else {
      buckets.set(key, { year: node.year, semester: node.semester, nodes: [node] });
    }
  }
  return [...buckets.values()].sort((a, b) => a.year - b.year || a.semester - b.semester);
}

// cloudfunctions/api-info/src/index.ts
import_wx_server_sdk.default.init({ env: import_wx_server_sdk.default.DYNAMIC_CURRENT_ENV });
var db = import_wx_server_sdk.default.database();
var COLLECTION = "information";
function toInfo({ _id, ...rest }) {
  return { id: _id ?? "", ...rest };
}
async function listPublished(payload) {
  const page = Math.max(1, Math.floor(payload.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(payload.pageSize ?? 20)));
  const where = { reviewStatus: "published" };
  if (payload.category) where.category = payload.category;
  if (payload.subType) where.subType = payload.subType;
  const coll = db.collection(COLLECTION);
  const [listRes, countRes] = await Promise.all([
    coll.where(where).orderBy("publishedAt", "desc").skip((page - 1) * pageSize).limit(pageSize).get(),
    coll.where(where).count()
  ]);
  return ok({ items: listRes.data.map(toInfo), total: countRes.total, page, pageSize });
}
async function getPublished(id) {
  if (!id) return fail(400, "\u7F3A\u5C11 id");
  try {
    const res = await db.collection(COLLECTION).doc(id).get();
    const info = res.data;
    if (!info || info.reviewStatus !== "published") {
      return fail(404, "\u4FE1\u606F\u4E0D\u5B58\u5728\u6216\u672A\u53D1\u5E03");
    }
    return ok(toInfo(info));
  } catch {
    return fail(404, "\u4FE1\u606F\u4E0D\u5B58\u5728\u6216\u672A\u53D1\u5E03");
  }
}
async function listDeadlines(payload) {
  const withinDays = Math.min(180, Math.max(1, Math.floor(payload.withinDays ?? 30)));
  const now = Date.now();
  const until = now + withinDays * 24 * 60 * 60 * 1e3;
  const res = await db.collection(COLLECTION).where({ reviewStatus: "published" }).orderBy("publishedAt", "desc").limit(200).get();
  const items = res.data.filter((d) => {
    if (!d.deadline) return false;
    const t = getDeadlineInstant(d.deadline).getTime();
    return t >= now && t <= until;
  }).sort((a, b) => getDeadlineInstant(a.deadline).getTime() - getDeadlineInstant(b.deadline).getTime()).slice(0, 100).map(toInfo);
  return ok({ items, total: items.length, withinDays });
}
async function listRoadmap() {
  const [nodeRes, infoRes] = await Promise.all([
    db.collection("roadmap_node").where({}).limit(100).get(),
    db.collection(COLLECTION).where({ reviewStatus: "published" }).orderBy("publishedAt", "desc").limit(200).get()
  ]);
  const publishedInfos = infoRes.data.map(toInfo);
  const nodes = nodeRes.data.map(({ _id, ...rest }) => ({
    id: _id ?? "",
    ...rest,
    // 单校试点规模假设：published ≤ 200，内存关联足够
    relatedInfos: publishedInfos.filter((i) => (rest.relatedInfoIds ?? []).includes(i.id))
  }));
  const items = groupNodesByYearSemester(nodes).flatMap((g) => g.nodes);
  return ok({ items, total: items.length });
}
async function main(event) {
  try {
    const payload = event?.payload ?? {};
    switch (event?.action) {
      case "info.list":
        return await listPublished(payload);
      case "info.get":
        return await getPublished(String(payload.id ?? ""));
      case "info.deadlines":
        return await listDeadlines(payload);
      case "roadmap.list":
        return await listRoadmap();
      default:
        return fail(400, `\u672A\u77E5 action: ${String(event?.action)}`);
    }
  } catch (error) {
    logError("api-info", error);
    return fail(500, "\u670D\u52A1\u5185\u90E8\u9519\u8BEF");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
