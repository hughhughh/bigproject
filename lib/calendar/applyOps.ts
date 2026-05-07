import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CalendarOp, TimeSegment } from "./types";
import { validateCalendarOps, validateOccurrenceGuard } from "./validateOps";

const DEFAULT_COLORS = ["#66AA3C", "#F97316", "#3B82F6", "#A855F7", "#14B8A6", "#EAB308"];

function normalizeColorHex(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!/^#(?:[0-9a-fA-F]{6})$/.test(trimmed)) return undefined;
  return trimmed.toUpperCase();
}

function generateColorHex(): string {
  return DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
}

function segmentsFromOp(
  segs: { startAt: string; endAt: string }[],
): TimeSegment[] | { error: string } {
  const out: TimeSegment[] = [];
  for (const s of segs) {
    const startAt = new Date(s.startAt);
    const endAt = new Date(s.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return { error: "Invalid segment datetime" };
    }
    if (endAt <= startAt) return { error: "Segment endAt must be after startAt" };
    out.push({ startAt, endAt });
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i].startAt < out[i - 1].endAt) {
      return { error: "Segments must not overlap" };
    }
  }
  return out;
}

type OccurrenceMeta =
  | { ok: true; occurrenceObjectId: ObjectId; seriesObjectId: ObjectId; movable: boolean; type: "task" | "activity" }
  | { ok: false; error: string };

async function loadOccurrenceMeta(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: ObjectId,
  occurrenceId: string,
): Promise<OccurrenceMeta> {
  let oid: ObjectId;
  try {
    oid = new ObjectId(occurrenceId);
  } catch {
    return { ok: false, error: "Invalid occurrence id" };
  }
  const occ = await db.collection("calendar_occurrences").findOne({
    _id: oid,
    userId,
  });
  if (!occ) return { ok: false, error: "Occurrence not found" };
  const series = await db.collection("calendar_series").findOne({
    _id: occ.seriesId,
    userId,
  });
  if (!series) return { ok: false, error: "Series not found" };
  return {
    ok: true,
    occurrenceObjectId: occ._id as ObjectId,
    seriesObjectId: series._id as ObjectId,
    movable: Boolean(series.movable),
    type: series.type as "task" | "activity",
  };
}

export async function applyCalendarOps(userId: string, ops: CalendarOp[]) {
  const structural = validateCalendarOps(ops);
  if (structural) return { ok: false as const, error: structural };

  let uid: ObjectId;
  try {
    uid = new ObjectId(userId);
  } catch {
    return { ok: false as const, error: "Invalid user id" };
  }

  const db = await getDb();
  const now = new Date();

  for (const op of ops) {
    if (op.op === "createSeriesAndOccurrence") {
      const segs = segmentsFromOp(op.segments);
      if ("error" in segs) return { ok: false as const, error: segs.error };
      const movable =
        op.type === "activity" ? (op.movable ?? false) : (op.movable ?? true);
      const colorHex = normalizeColorHex(op.colorHex) ?? generateColorHex();
      const seriesDoc = {
        userId: uid,
        type: op.type,
        title: op.title,
        movable,
        colorHex,
        durationMinutes: op.durationMinutes,
        createdAt: now,
        updatedAt: now,
      };
      const series = await db.collection("calendar_series").insertOne(seriesDoc);
      await db.collection("calendar_occurrences").insertOne({
        userId: uid,
        seriesId: series.insertedId,
        segments: segs,
        completedAt: null,
        source: "ai",
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const meta = await loadOccurrenceMeta(db, uid, op.occurrenceId);
    if (!meta.ok) return { ok: false as const, error: meta.error };

    const guard = validateOccurrenceGuard(op, {
      occurrenceId: meta.occurrenceObjectId.toString(),
      seriesId: meta.seriesObjectId.toString(),
      movable: meta.movable,
      type: meta.type,
    });
    if (guard) return { ok: false as const, error: guard };

    if (op.op === "deleteOccurrence") {
      await db.collection("calendar_occurrences").deleteOne({ _id: meta.occurrenceObjectId, userId: uid });
      const remaining = await db.collection("calendar_occurrences").countDocuments({
        seriesId: meta.seriesObjectId,
        userId: uid,
      });
      if (remaining === 0) {
        await db.collection("calendar_series").deleteOne({ _id: meta.seriesObjectId, userId: uid });
      }
      continue;
    }

    if (op.op === "moveOccurrence") {
      const segs = segmentsFromOp(op.segments);
      if ("error" in segs) return { ok: false as const, error: segs.error };
      await db.collection("calendar_occurrences").updateOne(
        { _id: meta.occurrenceObjectId, userId: uid },
        { $set: { segments: segs, isException: true, updatedAt: now } },
      );
      continue;
    }

    if (op.op === "setOccurrenceComplete") {
      await db.collection("calendar_occurrences").updateOne(
        { _id: meta.occurrenceObjectId, userId: uid },
        {
          $set: {
            completedAt: op.completed ? now : null,
            updatedAt: now,
          },
        },
      );
      continue;
    }
  }

  return { ok: true as const };
}
