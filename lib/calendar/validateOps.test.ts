import { describe, expect, it } from "vitest";
import type { CalendarOp } from "./types";
import { validateCalendarOps } from "./validateOps";

describe("validateCalendarOps", () => {
  it("accepts valid create with split segments", () => {
    const ops: CalendarOp[] = [
      {
        op: "createSeriesAndOccurrence",
        type: "task",
        title: "Essay",
        durationMinutes: 120,
        segments: [
          { startAt: "2026-05-11T01:00:00.000Z", endAt: "2026-05-11T02:00:00.000Z" },
          { startAt: "2026-05-11T03:00:00.000Z", endAt: "2026-05-11T04:00:00.000Z" },
        ],
      },
    ];
    expect(validateCalendarOps(ops)).toBeNull();
  });

  it("rejects overlapping segments", () => {
    const ops: CalendarOp[] = [
      {
        op: "createSeriesAndOccurrence",
        type: "task",
        title: "Overlap",
        durationMinutes: 90,
        segments: [
          { startAt: "2026-05-11T01:00:00.000Z", endAt: "2026-05-11T02:00:00.000Z" },
          { startAt: "2026-05-11T01:30:00.000Z", endAt: "2026-05-11T02:30:00.000Z" },
        ],
      },
    ];
    expect(validateCalendarOps(ops)).toContain("overlap");
  });

  it("rejects duration mismatch", () => {
    const ops: CalendarOp[] = [
      {
        op: "createSeriesAndOccurrence",
        type: "activity",
        title: "Sport",
        durationMinutes: 999,
        movable: false,
        segments: [
          { startAt: "2026-05-11T05:00:00.000Z", endAt: "2026-05-11T05:15:00.000Z" },
        ],
      },
    ];
    expect(validateCalendarOps(ops)).toContain("duration");
  });
});
