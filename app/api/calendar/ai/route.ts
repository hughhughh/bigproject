import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { applyCalendarOps } from "@/lib/calendar/applyOps";
import type { CalendarOp } from "@/lib/calendar/types";
import { calendarOpSchema } from "@/lib/calendar/validateOps";
import { currentMondayYmd, weekRangeUtcFromMonday } from "@/lib/calendar/sydneyWeek";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { DateTime } from "luxon";

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  weekStart: z.string().optional(),
});

const opsResponseSchema = z.object({
  ops: z.array(calendarOpSchema).min(1),
});

const GEMINI_MODEL = "gemini-2.5-flash";
const SYDNEY_TZ = "Australia/Sydney";
const GEMINI_TIMEOUT_MS = 15000;

async function buildBusySummary(userId: ObjectId, weekStart: string) {
  const { fromUtc, toUtc } = weekRangeUtcFromMonday(weekStart);
  const db = await getDb();
  const occs = await db
    .collection("calendar_occurrences")
    .find({
      userId,
      segments: {
        $elemMatch: {
          startAt: { $lt: toUtc },
          endAt: { $gt: fromUtc },
        },
      },
    })
    .project({ segments: 1, seriesId: 1 })
    .toArray();
  const seriesIds = [...new Set(occs.map((o) => o.seriesId.toString()))].map((id) => new ObjectId(id));
  const series =
    seriesIds.length > 0
      ? await db
          .collection("calendar_series")
          .find({ _id: { $in: seriesIds }, userId })
          .project({ title: 1, movable: 1, type: 1 })
          .toArray()
      : [];
  const seriesById = new Map(series.map((s) => [s._id.toString(), s]));
  return occs.map((o) => ({
    occurrenceId: o._id.toString(),
    title: (seriesById.get(o.seriesId.toString())?.title as string) ?? "Untitled",
    type: (seriesById.get(o.seriesId.toString())?.type as string) ?? "task",
    movable: Boolean(seriesById.get(o.seriesId.toString())?.movable),
    segments: o.segments.map((s: { startAt: Date; endAt: Date }) => ({
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
    })),
  }));
}

function tryParseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const direct = [trimmed];

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) direct.push(fenceMatch[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    direct.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    direct.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of direct) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }

  throw new Error("Could not parse model JSON");
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "yes") return true;
    if (v === "false" || v === "no") return false;
  }
  return undefined;
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (/^#(?:[0-9a-fA-F]{6})$/.test(v)) return v.toUpperCase();
  return undefined;
}

function coerceSegments(raw: unknown): { startAt: string; endAt: string }[] {
  const arr = Array.isArray(raw) ? raw : [];
  const segs: { startAt: string; endAt: string }[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const startAt =
      typeof obj.startAt === "string"
        ? obj.startAt
        : typeof obj.start === "string"
          ? obj.start
          : typeof obj.startTime === "string"
            ? obj.startTime
            : undefined;
    const endAt =
      typeof obj.endAt === "string"
        ? obj.endAt
        : typeof obj.end === "string"
          ? obj.end
          : typeof obj.endTime === "string"
            ? obj.endTime
            : undefined;
    if (startAt && endAt) segs.push({ startAt, endAt });
  }
  return segs;
}

function normalizeModelOps(raw: unknown): unknown {
  const container =
    Array.isArray(raw)
      ? raw
      : typeof raw === "object" && raw !== null
        ? ((raw as Record<string, unknown>).ops ??
          (raw as Record<string, unknown>).operations ??
          (raw as Record<string, unknown>).actions ??
          raw)
        : raw;

  if (!Array.isArray(container)) return raw;

  const normalized = container
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const opObj = entry as Record<string, unknown>;
      const rawOp = String(opObj.op ?? opObj.action ?? opObj.type ?? "").trim();
      const op = rawOp.toLowerCase();

      const occurrenceId =
        typeof opObj.occurrenceId === "string"
          ? opObj.occurrenceId
          : typeof opObj.id === "string"
            ? opObj.id
            : typeof opObj.targetOccurrenceId === "string"
              ? opObj.targetOccurrenceId
              : "";

      if (op === "deleteoccurrence" || op === "delete" || op === "remove") {
        return occurrenceId ? { op: "deleteOccurrence", occurrenceId } : null;
      }

      if (op === "moveoccurrence" || op === "move" || op === "reschedule") {
        const segments = coerceSegments(opObj.segments ?? opObj.timeBlocks);
        return occurrenceId && segments.length > 0
          ? { op: "moveOccurrence", occurrenceId, segments }
          : null;
      }

      if (
        op === "setoccurrencecomplete" ||
        op === "complete" ||
        op === "setcomplete" ||
        op === "markcomplete"
      ) {
        const completed = toBool(opObj.completed ?? opObj.done ?? true);
        return occurrenceId && completed !== undefined
          ? { op: "setOccurrenceComplete", occurrenceId, completed }
          : null;
      }

      if (
        op === "createseriesandoccurrence" ||
        op === "create" ||
        op === "add" ||
        op === "createoccurrence"
      ) {
        const typeRaw = String(opObj.type ?? "task")
          .toLowerCase()
          .replace(/[^a-z]/g, "");
        const type = typeRaw === "activity" ? "activity" : "task";
        const title =
          typeof opObj.title === "string" && opObj.title.trim().length > 0
            ? opObj.title.trim()
            : "Untitled";
        const movable = toBool(opObj.movable);
        const colorHex = normalizeHexColor(
          opObj.colorHex ?? opObj.color ?? opObj.calendarColour ?? opObj.calendarColor,
        );
        const durationMinutes = toNumber(
          opObj.durationMinutes ?? opObj.duration ?? opObj.estimatedMinutes,
        );
        const segments =
          coerceSegments(opObj.segments ?? opObj.timeBlocks).length > 0
            ? coerceSegments(opObj.segments ?? opObj.timeBlocks)
            : (() => {
                const startAt =
                  typeof opObj.startAt === "string"
                    ? opObj.startAt
                    : typeof opObj.start === "string"
                      ? opObj.start
                      : undefined;
                const endAt =
                  typeof opObj.endAt === "string"
                    ? opObj.endAt
                    : typeof opObj.end === "string"
                      ? opObj.end
                      : undefined;
                return startAt && endAt ? [{ startAt, endAt }] : [];
              })();

        if (!durationMinutes || segments.length === 0) return null;
        return {
          op: "createSeriesAndOccurrence",
          type,
          title,
          movable,
          colorHex,
          durationMinutes: Math.round(durationMinutes),
          segments,
        };
      }

      return null;
    })
    .filter(Boolean);

  return { ops: normalized };
}

function extractRawOpsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.ops)) return obj.ops;
    if (Array.isArray(obj.operations)) return obj.operations;
    if (Array.isArray(obj.actions)) return obj.actions;
  }
  return [];
}

function findMissingCreateFields(rawOps: unknown[]): string[] {
  const missing = new Set<string>();
  for (const item of rawOps) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const opName = String(obj.op ?? obj.action ?? "").toLowerCase().trim();
    if (!(opName.includes("create") || opName.includes("add"))) continue;
    if (!obj.title) missing.add("title");
    if (!obj.durationMinutes && !obj.duration && !obj.estimatedMinutes) {
      missing.add("durationMinutes");
    }
    const hasSegments =
      Array.isArray(obj.segments) ||
      Array.isArray(obj.timeBlocks) ||
      (typeof obj.startAt === "string" && typeof obj.endAt === "string") ||
      (typeof obj.start === "string" && typeof obj.end === "string");
    if (!hasSegments) missing.add("segments(startAt,endAt)");
  }
  return [...missing];
}

function parseTimeToMinutes(input: string): number | null {
  const t = input.trim().toLowerCase();
  const normalized = t.replace(".", ":");
  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min < 0 || min > 59 || h < 0 || h > 23) return null;
  const mer = m[3];
  if (mer) {
    if (h === 12) h = 0;
    if (mer === "pm") h += 12;
  }
  if (h < 0 || h > 23) return null;
  return h * 60 + min;
}

function parseDateFlexible(input: string): DateTime | null {
  const raw = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = DateTime.fromISO(raw, { zone: SYDNEY_TZ });
    return dt.isValid ? dt : null;
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    const dt = DateTime.fromObject({ year, month, day }, { zone: SYDNEY_TZ });
    return dt.isValid ? dt : null;
  }
  return null;
}

function parseStructuredMessageToOps(message: string): { ops: CalendarOp[] } | null {
  const lines = message
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const kv = new Map<string, string>();
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase().replace(/\s+/g, "");
    const value = line.slice(idx + 1).trim();
    kv.set(key, value);
  }

  const name = kv.get("name");
  const typeRaw = kv.get("type")?.toLowerCase();
  const timeRaw = kv.get("time");
  const startDateRaw = kv.get("startdate");
  if (!name || !timeRaw || !startDateRaw) return null;

  const [startText, endText] = timeRaw.split("-").map((s) => s.trim());
  if (!startText || !endText) return null;
  const startMin = parseTimeToMinutes(startText);
  const endMin = parseTimeToMinutes(endText);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  const startDate = parseDateFlexible(startDateRaw);
  if (!startDate) return null;

  const colorHex = normalizeHexColor(
    kv.get("calendarcolour") ?? kv.get("calendarcolor") ?? kv.get("colorhex") ?? kv.get("color"),
  );
  const movable = toBool(kv.get("moveable") ?? kv.get("movable"));
  const repeat = toBool(kv.get("repeat")) ?? false;
  const repeatEveryDays = toNumber(kv.get("repeateverydays")) ?? 0;
  const isWeekdayPattern = /every\s+weekday/i.test(message);
  const type = typeRaw === "activity" ? "activity" : "task";

  const makeSegment = (date: DateTime) => {
    const start = date.startOf("day").plus({ minutes: startMin });
    const end = date.startOf("day").plus({ minutes: endMin });
    return { startAt: start.toUTC().toISO()!, endAt: end.toUTC().toISO()! };
  };

  const base: Omit<Extract<CalendarOp, { op: "createSeriesAndOccurrence" }>, "segments"> = {
    op: "createSeriesAndOccurrence",
    type,
    title: name,
    movable,
    colorHex,
    durationMinutes: endMin - startMin,
  };

  const ops: CalendarOp[] = [];
  if (isWeekdayPattern) {
    const monday = startDate.minus({ days: startDate.weekday - 1 }).startOf("day");
    for (let i = 0; i < 5; i++) {
      ops.push({ ...base, segments: [makeSegment(monday.plus({ days: i }))] });
    }
    return { ops };
  }

  ops.push({ ...base, segments: [makeSegment(startDate)] });
  if (repeat && repeatEveryDays === 7) {
    ops.push({ ...base, segments: [makeSegment(startDate.plus({ days: 7 }))] });
  }

  return { ops };
}

function parseNaturalWeekdayRangeToOps(message: string): { ops: CalendarOp[] } | null {
  const src = message.trim();
  const timeMatch =
    src.match(
      /from\s+(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)\s*(?:to|-|–)\s*(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)/i,
    ) ??
    src.match(
      /(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)\s*(?:to|-|–)\s*(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)/i,
    );
  if (!timeMatch) return null;
  const startMin = parseTimeToMinutes(timeMatch[1]);
  const endMin = parseTimeToMinutes(timeMatch[2]);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  const weekdayPattern =
    /every\s+weekday/i.test(src) ||
    /\bweekdays?\b/i.test(src) ||
    /\bmon(?:day)?\s*-\s*fri(?:day)?\b/i.test(src) ||
    /\bmonday\s+to\s+friday\b/i.test(src);
  if (!weekdayPattern) return null;

  const colorHexMatch = src.match(/#(?:[0-9a-fA-F]{6})/);
  const colorHex = colorHexMatch ? colorHexMatch[0].toUpperCase() : undefined;
  const movable = /mov(?:e)?able\s*:\s*yes/i.test(src) ? true : false;

  let title = "School";
  const nameMatch = src.match(/name\s*:\s*([^\n,]+)/i);
  if (nameMatch?.[1]) title = nameMatch[1].trim();
  else if (/school/i.test(src)) title = "School";
  else {
    const haveMatch = src.match(/\bi\s+have\s+(.+?)\s+(?:every|on|from|\d{1,2}(?::\d{2})?)/i);
    if (haveMatch?.[1]) {
      title = haveMatch[1].trim().replace(/\s+/g, " ");
    }
  }

  const monday = DateTime.now().setZone(SYDNEY_TZ).startOf("week").plus({ days: 1 });
  const durationMinutes = endMin - startMin;
  const ops: CalendarOp[] = [];
  for (let i = 0; i < 5; i++) {
    const day = monday.plus({ days: i });
    const start = day.startOf("day").plus({ minutes: startMin });
    const end = day.startOf("day").plus({ minutes: endMin });
    ops.push({
      op: "createSeriesAndOccurrence",
      type: "activity",
      title,
      movable,
      colorHex,
      durationMinutes,
      segments: [{ startAt: start.toUTC().toISO()!, endAt: end.toUTC().toISO()! }],
    });
  }
  return { ops };
}

function parseGeneralTimeRangeToOps(message: string, weekStart: string): { ops: CalendarOp[] } | null {
  const src = message.trim();
  const timeMatch =
    src.match(
      /from\s+(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)\s*(?:to|-|–)\s*(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)/i,
    ) ??
    src.match(
      /(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)\s*(?:to|-|–)\s*(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)?)/i,
    );
  if (!timeMatch) return null;

  const startMin = parseTimeToMinutes(timeMatch[1]);
  const endMin = parseTimeToMinutes(timeMatch[2]);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  const dateToken =
    src.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ??
    src.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0];
  const baseDate =
    (dateToken ? parseDateFlexible(dateToken) : null) ??
    DateTime.fromISO(weekStart, { zone: SYDNEY_TZ }).startOf("day");

  const type: "task" | "activity" = /\btask\b/i.test(src) ? "task" : "activity";
  const movable = /\bmov(?:e)?able\b.*\byes\b/i.test(src) ? true : false;
  const colorHex = normalizeHexColor(src.match(/#(?:[0-9a-fA-F]{6})/)?.[0]);
  const weekdayPattern =
    /every\s+weekday/i.test(src) ||
    /\bweekdays?\b/i.test(src) ||
    /\bmon(?:day)?\s*-\s*fri(?:day)?\b/i.test(src) ||
    /\bmonday\s+to\s+friday\b/i.test(src);

  let title = "New Activity";
  if (/school/i.test(src)) title = "School";
  else if (/study/i.test(src)) title = "Study";
  else if (/revision/i.test(src)) title = "Revision";
  const nameMatch = src.match(/name\s*:\s*([^\n,]+)/i);
  if (nameMatch?.[1]) title = nameMatch[1].trim();

  const buildOp = (d: DateTime): CalendarOp => {
    const start = d.startOf("day").plus({ minutes: startMin });
    const end = d.startOf("day").plus({ minutes: endMin });
    return {
      op: "createSeriesAndOccurrence",
      type,
      title,
      movable,
      colorHex,
      durationMinutes: endMin - startMin,
      segments: [{ startAt: start.toUTC().toISO()!, endAt: end.toUTC().toISO()! }],
    };
  };

  if (weekdayPattern) {
    const monday = baseDate.minus({ days: baseDate.weekday - 1 }).startOf("day");
    return { ops: [0, 1, 2, 3, 4].map((i) => buildOp(monday.plus({ days: i }))) };
  }
  return { ops: [buildOp(baseDate)] };
}

async function callGeminiJson(
  apiKey: string,
  system: string,
  userText: string,
  timeoutMs = GEMINI_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            role: "system",
            parts: [{ text: system }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userText }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                ops: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      op: { type: "STRING" },
                      type: { type: "STRING" },
                      title: { type: "STRING" },
                      movable: { type: "BOOLEAN" },
                      colorHex: { type: "STRING" },
                      durationMinutes: { type: "NUMBER" },
                      occurrenceId: { type: "STRING" },
                      completed: { type: "BOOLEAN" },
                      segments: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            startAt: { type: "STRING" },
                            endAt: { type: "STRING" },
                          },
                          required: ["startAt", "endAt"],
                        },
                      },
                    },
                    required: ["op"],
                  },
                },
              },
              required: ["ops"],
            },
          },
        }),
      },
    );
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false as const, detail: `Gemini request timed out after ${timeoutMs / 1000}s` };
    }
    return { ok: false as const, detail: error instanceof Error ? error.message : "Gemini request failed" };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return { ok: false as const, detail: await res.text() };
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { ok: false as const, detail: "Empty model response" };
  return { ok: true as const, text };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: ObjectId;
  try {
    uid = new ObjectId(session.user.id);
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  }

  const weekStart = parsedBody.data.weekStart ?? currentMondayYmd();
  const busy = await buildBusySummary(uid, weekStart);
  const structuredFallback = parseStructuredMessageToOps(parsedBody.data.message);
  const naturalFallback = parseNaturalWeekdayRangeToOps(parsedBody.data.message);
  const generalFallback = parseGeneralTimeRangeToOps(parsedBody.data.message, weekStart);
  const nowUtc = new Date();
  const nowSydney = DateTime.fromJSDate(nowUtc, { zone: "utc" }).setZone(SYDNEY_TZ);
  const debugContext = {
    weekStart,
    structuredFallbackDetected: Boolean(structuredFallback),
    naturalFallbackDetected: Boolean(naturalFallback),
    generalFallbackDetected: Boolean(generalFallback),
    sentAtUtc: nowUtc.toISOString(),
    sentAtSydney: nowSydney.toISO(),
  };

  // Prefer deterministic parsing for known calendar formats before calling Gemini.
  for (const fallback of [structuredFallback, naturalFallback, generalFallback]) {
    if (!fallback) continue;
    const fallbackParsed = opsResponseSchema.safeParse(fallback);
    if (!fallbackParsed.success) continue;
    const fallbackApply = await applyCalendarOps(session.user.id, fallbackParsed.data.ops);
    if (fallbackApply.ok) {
      return NextResponse.json({
        applied: true,
        weekStart,
        ops: fallbackParsed.data.ops,
        via: "deterministic-parser",
        debug: debugContext,
      });
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      skipped: true,
      reason: "AI scheduling is not available right now.",
      weekStart,
      busy,
      applied: null,
      debug: debugContext,
    });
  }

  const system = [
    "You are a scheduling assistant for a student planner.",
    "Respond in English only.",
    "Return ONLY JSON with shape { \"ops\": CalendarOp[] }.",
    "CalendarOp union:",
    '{ "op":"createSeriesAndOccurrence","type":"task"|"activity","title":string,"movable"?:boolean,"colorHex"?:string,"durationMinutes":number,"segments":[{"startAt":"ISO8601","endAt":"ISO8601"}] }',
    '{ "op":"deleteOccurrence","occurrenceId":string }',
    '{ "op":"moveOccurrence","occurrenceId":string,"segments":[{"startAt":"ISO8601","endAt":"ISO8601"}] }',
    '{ "op":"setOccurrenceComplete","occurrenceId":string,"completed":boolean }',
    "Rules: segments must not overlap; total segment minutes must equal durationMinutes within 1 minute.",
    "Activities default immovable unless movable:true. Tasks default movable unless movable:false.",
    "Prefer changes inside the user's current week context. Use occurrenceId from busy summary when editing.",
  ].join("\n");

  const userPayload = JSON.stringify(
    {
      message: parsedBody.data.message,
      structuredHint:
        "If the user provides fields like Name/Type/Time/StartDate/Repeat/RepeatEveryDays/CalendarColour, map them directly to create ops.",
      weekStart,
      sentAtUtc: nowUtc.toISOString(),
      sentAtSydney: nowSydney.toISO(),
      sentWeekdaySydney: nowSydney.toFormat("cccc"),
      busy,
    },
    null,
    2,
  );

  let firstPass = await callGeminiJson(apiKey, system, userPayload);
  if (!firstPass.ok && /timed out/i.test(firstPass.detail)) {
    // Retry once with reduced context if the first call times out.
    const minimalPayload = JSON.stringify(
      {
        message: parsedBody.data.message,
        weekStart,
        sentAtUtc: nowUtc.toISOString(),
        sentAtSydney: nowSydney.toISO(),
        sentWeekdaySydney: nowSydney.toFormat("cccc"),
        busySummary: `Busy count in window: ${busy.length}`,
      },
      null,
      2,
    );
    firstPass = await callGeminiJson(apiKey, system, minimalPayload, 10000);
  }
  if (!firstPass.ok) {
    return NextResponse.json(
      {
        error: "Gemini API request failed",
        detail: firstPass.detail,
        stage: "gemini-call",
        debug: debugContext,
      },
      { status: 502 },
    );
  }
  const content = firstPass.text;

  let raw: unknown;
  try {
    raw = tryParseJsonLoose(content);
  } catch {
    return NextResponse.json(
      {
        error: "Model returned non-JSON",
        detail: content.slice(0, 800),
        stage: "json-parse",
        debug: debugContext,
      },
      { status: 502 },
    );
  }

  const rawOpsArray = extractRawOpsArray(raw);
  const normalized = normalizeModelOps(raw);

  const parsedOps = opsResponseSchema.safeParse(normalized);
  if (!parsedOps.success) {
    const repairPrompt = JSON.stringify(
      {
        instruction:
          "Repair this invalid ops JSON into valid CalendarOp objects with complete fields. For createSeriesAndOccurrence you MUST include type,title,durationMinutes,segments(startAt,endAt).",
        originalUserMessage: parsedBody.data.message,
        invalidModelOutput: content,
      },
      null,
      2,
    );
    const repair = await callGeminiJson(apiKey, system, repairPrompt);
    if (repair.ok) {
      try {
        const repairRaw = tryParseJsonLoose(repair.text);
        const repairNormalized = normalizeModelOps(repairRaw);
        const repaired = opsResponseSchema.safeParse(repairNormalized);
        if (repaired.success) {
          const repairApply = await applyCalendarOps(session.user.id, repaired.data.ops);
          if (repairApply.ok) {
            return NextResponse.json({
              applied: true,
              weekStart,
              ops: repaired.data.ops,
              via: "gemini-repair-pass",
              debug: debugContext,
            });
          }
        }
      } catch {
        // continue to other fallbacks
      }
    }

    for (const fallback of [structuredFallback, naturalFallback, generalFallback]) {
      if (!fallback) continue;
      const fallbackParsed = opsResponseSchema.safeParse(fallback);
      if (fallbackParsed.success) {
        const fallbackApply = await applyCalendarOps(session.user.id, fallbackParsed.data.ops);
        if (fallbackApply.ok) {
          return NextResponse.json({
            applied: true,
            weekStart,
            ops: fallbackParsed.data.ops,
            via: "fallback-parser",
            debug: debugContext,
          });
        }
      }
    }
    const missingCreateFields = findMissingCreateFields(rawOpsArray);
    if (missingCreateFields.length > 0) {
      return NextResponse.json(
        {
          error: "Model returned incomplete create operations.",
          stage: "schema-validation",
          detail: `Missing required fields for create ops: ${missingCreateFields.join(", ")}.`,
          hint:
            "Include real times and dates, e.g. 'School weekdays 7:45am-4:05pm, start date 2026-05-04, not movable'.",
          debug: debugContext,
          modelOutputPreview: content.slice(0, 800),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "Invalid ops from model",
        stage: "schema-validation",
        details: parsedOps.error.flatten(),
        detail: content.slice(0, 1200),
        modelOutputPreview: content.slice(0, 800),
        debug: debugContext,
      },
      { status: 502 },
    );
  }

  if (parsedOps.data.ops.length === 0) {
    return NextResponse.json(
      {
        error: "No actionable calendar operations were generated.",
        detail:
          "Try a more specific request with real times and dates (e.g. 'Add School activity every weekday 8:30am-3:00pm this week, immovable').",
        stage: "empty-ops",
        debug: debugContext,
      },
      { status: 400 },
    );
  }

  const apply = await applyCalendarOps(session.user.id, parsedOps.data.ops);
  if (!apply.ok) {
    return NextResponse.json(
      {
        error: apply.error,
        stage: "apply",
        ops: parsedOps.data.ops,
        debug: debugContext,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ applied: true, weekStart, ops: parsedOps.data.ops, debug: debugContext });
}
