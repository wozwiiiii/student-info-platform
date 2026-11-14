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

// cloudfunctions/job-remind/src/index.ts
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

// shared/domain/deadline.ts
var TZ_OFFSET = "+08:00";
var REMINDER_OFFSETS_DAYS = [3, 1];
function getDeadlineInstant(deadline) {
  if (deadline.precision === "date") {
    return /* @__PURE__ */ new Date(`${deadline.date.slice(0, 10)}T23:59:59${TZ_OFFSET}`);
  }
  return new Date(deadline.date);
}
function morningOf(dateOnly, hourOfDay) {
  const hh = String(hourOfDay).padStart(2, "0");
  return /* @__PURE__ */ new Date(`${dateOnly.slice(0, 10)}T${hh}:00:00${TZ_OFFSET}`);
}
function computeReminderSchedule(deadline, now, opts) {
  const hourOfDay = opts?.hourOfDay ?? 9;
  const offsets = opts?.offsetsDays ?? REMINDER_OFFSETS_DAYS;
  const base = deadline.precision === "date" ? deadline.date.slice(0, 10) : null;
  const points = [];
  for (const days of offsets) {
    if (base) {
      const d = new Date(morningOf(base, hourOfDay).getTime() - days * 24 * 60 * 60 * 1e3);
      points.push(d);
    } else {
      points.push(new Date(getDeadlineInstant(deadline).getTime() - days * 24 * 60 * 60 * 1e3));
    }
  }
  return points.filter((d) => d.getTime() > now.getTime()).sort((a, b) => a.getTime() - b.getTime()).map((d) => d.toISOString());
}
function dueReminderPoints(deadline, now, windowMs, opts) {
  return computeReminderSchedule(deadline, new Date(now.getTime() - windowMs), opts).filter(
    (iso) => new Date(iso).getTime() <= now.getTime()
  );
}

// shared/domain/roadmap.ts
var DAY_MS = 24 * 60 * 60 * 1e3;

// shared/constants.ts
var REMIND_TEMPLATE_ID = "REPLACE_WITH_MP_REMIND_TEMPLATE_ID";
var REMIND_WINDOW_MS = 2 * 60 * 60 * 1e3;

// cloudfunctions/job-remind/src/index.ts
import_wx_server_sdk.default.init({ env: import_wx_server_sdk.default.DYNAMIC_CURRENT_ENV });
var db = import_wx_server_sdk.default.database();
var INFORMATION = "information";
var SUBSCRIBE_RECORD = "subscribe_record";
var REMINDER_LOG = "reminder_log";
var PUSH_FAIL = "push_fail";
var BATCH_SIZE = 100;
var RECIPIENT_LIMIT = 500;
var PAGE_PATH = "pages/calendar/index";
function buildPage(infoId) {
  return `${PAGE_PATH}?from=remind&infoId=${encodeURIComponent(infoId)}`;
}
function templateId() {
  const env = globalThis.process?.env ?? {};
  return env.REMIND_TEMPLATE_ID || REMIND_TEMPLATE_ID;
}
function formatDeadline(deadline) {
  if (!deadline) return "";
  if (deadline.precision === "date") return deadline.date.slice(0, 10);
  const shifted = new Date(new Date(deadline.date).getTime() + 8 * 60 * 60 * 1e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`;
}
function buildData(info) {
  return {
    thing1: { value: (info.title ?? "").slice(0, 20) || "\u4FE1\u606F\u63D0\u9192" },
    time2: { value: formatDeadline(info.deadline) || "\u8BE6\u89C1\u8BE6\u60C5" }
  };
}
async function isAlreadyLogged(infoId, remindAt, openId) {
  const res = await db.collection(REMINDER_LOG).where({ infoId, remindAt, openId }).limit(1).get();
  return res.data.length > 0;
}
async function remindDue() {
  const tpl = templateId();
  if (tpl.startsWith("REPLACE_")) {
    return fail(400, "\u672A\u914D\u7F6E\u63D0\u9192\u8BA2\u9605\u6D88\u606F\u6A21\u677F ID\uFF08REMIND_TEMPLATE_ID\uFF09\uFF0C\u8BF7\u5148\u5728\u5FAE\u4FE1\u516C\u4F17\u5E73\u53F0\u8BA2\u9605\u6D88\u606F\u4E2D\u914D\u7F6E\u6A21\u677F");
  }
  const now = /* @__PURE__ */ new Date();
  const nowStr = nowIso();
  const infoRes = await db.collection(INFORMATION).where({ reviewStatus: "published" }).orderBy("createdAt", "desc").limit(BATCH_SIZE).get();
  const candidates = infoRes.data.filter(
    (d) => d.deadline && getDeadlineInstant(d.deadline).getTime() > now.getTime() - REMIND_WINDOW_MS
  );
  const subRes = await db.collection(SUBSCRIBE_RECORD).where({ templateId: tpl }).limit(RECIPIENT_LIMIT).get();
  const recipients = subRes.data.filter(
    (r) => (r.quota ?? 0) > 0 && (!r.expireAt || new Date(r.expireAt).getTime() > now.getTime())
  );
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const info of candidates) {
    if (!info._id || !info.deadline) continue;
    for (const remindAt of dueReminderPoints(info.deadline, now, REMIND_WINDOW_MS)) {
      for (const rec of recipients) {
        if (await isAlreadyLogged(info._id, remindAt, rec.openId)) {
          skipped++;
          continue;
        }
        try {
          const res = await import_wx_server_sdk.default.openapi.subscribeMessage.send({
            touser: rec.openId,
            template_id: tpl,
            page: buildPage(info._id),
            data: buildData(info)
          });
          if (res && typeof res.errCode === "number" && res.errCode !== 0) {
            throw new Error(`errCode=${res.errCode} ${res.errMsg ?? ""}`);
          }
          const left = (rec.quota ?? 1) - 1;
          await db.collection(SUBSCRIBE_RECORD).doc(rec._id).update({
            quota: left,
            usedAt: nowStr
          });
          if (left <= 0) {
            await db.collection("user").where({ openId: rec.openId }).update({ subscribeState: "none", updatedAt: nowStr });
          }
          await db.collection(REMINDER_LOG).add({
            infoId: info._id,
            remindAt,
            openId: rec.openId,
            status: "sent",
            at: nowStr
          });
          sent++;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          logError(`job-remind:${info._id}:${rec.openId}`, error);
          await db.collection(PUSH_FAIL).add({
            openId: rec.openId,
            infoId: info._id,
            templateId: tpl,
            reason,
            at: nowStr
          });
          await db.collection(REMINDER_LOG).add({
            infoId: info._id,
            remindAt,
            openId: rec.openId,
            status: "failed",
            at: nowStr
          });
          failed++;
        }
      }
    }
  }
  return ok({ scanned: infoRes.data.length, candidates: candidates.length, recipients: recipients.length, sent, failed, skipped });
}
async function main(event) {
  try {
    switch (event?.action) {
      case "remind.due":
      case void 0:
        return await remindDue();
      default:
        return fail(400, `\u672A\u77E5 action: ${String(event?.action)}`);
    }
  } catch (error) {
    logError("job-remind", error);
    return fail(500, "\u670D\u52A1\u5185\u90E8\u9519\u8BEF");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
