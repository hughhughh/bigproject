import { z } from "zod";
import type { CalendarOp } from "./types";

const isoSegment = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6})$/, "colorHex must be a 6-digit hex color like #66AA3C");

export const calendarOpSchema: z.ZodType<CalendarOp> = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("createSeriesAndOccurrence"),
    type: z.enum(["task", "activity"]),
    title: z.string().min(1).max(500),
    movable: z.boolean().optional(),
    colorHex: hexColor.optional(),
    durationMinutes: z.number().int().positive().max(24 * 60),
    segments: z.array(isoSegment).min(1).max(32),
  }),
  z.object({
    op: z.literal("deleteOccurrence"),
    occurrenceId: z.string().min(1),
  }),
  z.object({
    op: z.literal("moveOccurrence"),
    occurrenceId: z.string().min(1),
    segments: z.array(isoSegment).min(1).max(32),
  }),
  z.object({
    op: z.literal("setOccurrenceComplete"),
    occurrenceId: z.string().min(1),
    completed: z.boolean(),
  }),
]);

export const calendarOpsRequestSchema = z.object({
  ops: z.array(calendarOpSchema).max(50),
});

function parseSegments(segments: { startAt: string; endAt: string }[]) {
  const out: { startAt: Date; endAt: Date }[] = [];
  for (const s of segments) {
    const startAt = new Date(s.startAt);
    const endAt = new Date(s.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return { ok: false as const, error: "Invalid segment datetime" };
    }
    if (endAt <= startAt) {
      return { ok: false as const, error: "Segment endAt must be after startAt" };
    }
    out.push({ startAt, endAt });
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i].startAt < out[i - 1].endAt) {
      return { ok: false as const, error: "Segments must not overlap" };
    }
  }
  return { ok: true as const, segments: out };
}

/**
 * Validates calendar operations before touching the database.
 * Does not check ownership (caller must filter by userId when loading maps).
 */
export function validateCalendarOps(ops: CalendarOp[]): string | null {
  for (const op of ops) {
    if (op.op === "createSeriesAndOccurrence") {
      const parsed = parseSegments(op.segments);
      if (!parsed.ok) return parsed.error;
      const totalMinutes = parsed.segments.reduce(
        (acc, s) => acc + (s.endAt.getTime() - s.startAt.getTime()) / 60000,
        0,
      );
      if (Math.abs(totalMinutes - op.durationMinutes) > 1) {
        return "createSeriesAndOccurrence: segment total duration must match durationMinutes (within 1 minute)";
      }
      continue;
    }
    if (op.op === "moveOccurrence") {
      const parsed = parseSegments(op.segments);
      if (!parsed.ok) return parsed.error;
      continue;
    }
    if (op.op === "deleteOccurrence") {
      continue;
    }
    if (op.op === "setOccurrenceComplete") {
      continue;
    }
  }
  return null;
}

/**
 * Validates move/delete/complete against loaded occurrence metadata.
 */
export function validateOccurrenceGuard(
  op: CalendarOp,
  meta: { occurrenceId: string; seriesId: string; movable: boolean; type: "task" | "activity" },
): string | null {
  if (op.op === "moveOccurrence") {
    if (!meta.movable) return "Cannot move a fixed (immovable) item";
    const parsed = parseSegments(op.segments);
    if (!parsed.ok) return parsed.error;
    return null;
  }
  if (op.op === "setOccurrenceComplete") {
    if (meta.type !== "task") return "Only tasks can be completed";
    return null;
  }
  if (op.op === "deleteOccurrence") {
    return null;
  }
  return null;
}
