/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState } from "react";
import { DateTime } from "luxon";
import { signOut } from "next-auth/react";
import { currentMondayYmd, SYDNEY_TZ } from "@/lib/calendar/sydneyWeek";

type Occurrence = {
  id: string;
  seriesId: string;
  type: "task" | "activity";
  title: string;
  movable: boolean;
  colorHex?: string;
  segments: { startAt: string; endAt: string }[];
  completedAt: string | null;
  isOverdue: boolean;
};

const WORK_START_HOUR = 6;
const WORK_END_HOUR = 22;
const PX_PER_MIN = 0.6;
const WORK_MINUTES = (WORK_END_HOUR - WORK_START_HOUR) * 60;
const COLUMN_HEIGHT = WORK_MINUTES * PX_PER_MIN;

function dayBoundsUtc(mondayYmd: string, dayOffset: number) {
  const monday = DateTime.fromISO(mondayYmd, { zone: SYDNEY_TZ }).startOf("day");
  const dayStart = monday.plus({ days: dayOffset });
  const dayEnd = dayStart.plus({ days: 1 });
  return { dayStart, dayEnd };
}

function clipIntervalToDay(
  segStart: DateTime,
  segEnd: DateTime,
  dayStart: DateTime,
  dayEnd: DateTime,
): { start: DateTime; end: DateTime } | null {
  const s = segStart.toUTC();
  const e = segEnd.toUTC();
  const d0 = dayStart.toUTC();
  const d1 = dayEnd.toUTC();
  const clipS = s.toMillis() < d0.toMillis() ? d0 : s;
  const clipE = e.toMillis() > d1.toMillis() ? d1 : e;
  if (clipE <= clipS) return null;
  return { start: clipS, end: clipE };
}

function layoutInWorkingColumn(clip: { start: DateTime; end: DateTime }): { top: number; height: number } | null {
  const clipStartSyd = clip.start.setZone(SYDNEY_TZ);
  const clipEndSyd = clip.end.setZone(SYDNEY_TZ);

  const startMinutesFromMidnight = clipStartSyd.hour * 60 + clipStartSyd.minute + clipStartSyd.second / 60;
  const endMinutesFromMidnight = clipEndSyd.hour * 60 + clipEndSyd.minute + clipEndSyd.second / 60;

  const workStartMin = WORK_START_HOUR * 60;
  const workEndMin = WORK_END_HOUR * 60;

  const clippedStart = Math.max(startMinutesFromMidnight, workStartMin);
  const clippedEnd = Math.min(endMinutesFromMidnight, workEndMin);
  if (clippedEnd <= clippedStart) return null;

  const top = (clippedStart - workStartMin) * PX_PER_MIN;
  const height = Math.max(8, (clippedEnd - clippedStart) * PX_PER_MIN);
  return { top, height };
}

type PlacedOccurrence = Occurrence & { top: number; height: number };

function placeOccurrencesForDay(mondayYmd: string, dayOffset: number, occs: Occurrence[]): PlacedOccurrence[] {
  const { dayStart, dayEnd } = dayBoundsUtc(mondayYmd, dayOffset);
  const placed: PlacedOccurrence[] = [];

  for (const occ of occs) {
    let merged: { start: DateTime; end: DateTime } | null = null;
    for (const seg of occ.segments) {
      const s = DateTime.fromISO(seg.startAt, { zone: "utc" });
      const e = DateTime.fromISO(seg.endAt, { zone: "utc" });
      const clip = clipIntervalToDay(s, e, dayStart, dayEnd);
      if (!clip) continue;
      if (!merged) merged = clip;
      else {
        merged = {
          start: clip.start.toMillis() < merged.start.toMillis() ? clip.start : merged.start,
          end: clip.end.toMillis() > merged.end.toMillis() ? clip.end : merged.end,
        };
      }
    }
    if (!merged) continue;
    const layout = layoutInWorkingColumn(merged);
    if (!layout) continue;
    placed.push({ ...occ, ...layout });
  }

  placed.sort((a, b) => a.top - b.top);
  return placed;
}

export function WeekView() {
  const [weekStart, setWeekStart] = useState(currentMondayYmd);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [debugBusy, setDebugBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/calendar/occurrences?weekStart=${encodeURIComponent(weekStart)}`);
    if (!res.ok) {
      setError("Could not load calendar.");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { occurrences: Occurrence[] };
    setOccurrences(data.occurrences);
    setLoading(false);
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowSydney = DateTime.now().setZone(SYDNEY_TZ);

  const dayOffsets = [0, 1, 2, 3, 4, 5, 6];
  const dayLabels = dayOffsets.map((d) => {
    const dt = DateTime.fromISO(weekStart, { zone: SYDNEY_TZ }).plus({ days: d });
    return { short: dt.toFormat("ccc"), day: dt.day, offset: d, iso: dt.toISODate()! };
  });

  const nowLineForDay = (offset: number) => {
    const { dayStart, dayEnd } = dayBoundsUtc(weekStart, offset);
    if (nowSydney < dayStart || nowSydney >= dayEnd) return null;
    const minutes = nowSydney.hour * 60 + nowSydney.minute + nowSydney.second / 60;
    const workStartMin = WORK_START_HOUR * 60;
    const workEndMin = WORK_END_HOUR * 60;
    const clipped = Math.min(Math.max(minutes, workStartMin), workEndMin);
    const top = (clipped - workStartMin) * PX_PER_MIN;
    return { top, label: nowSydney.toFormat("h:mm a") };
  };

  const shiftWeek = (deltaWeeks: number) => {
    const monday = DateTime.fromISO(weekStart, { zone: SYDNEY_TZ });
    setWeekStart(monday.plus({ weeks: deltaWeeks }).toISODate()!);
  };

  const submitAi = async () => {
    const text = aiText.trim();
    if (!text) return;
    setAiBusy(true);
    setError(null);
    setDebugInfo(null);
    try {
      const res = await fetch("/api/calendar/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, weekStart }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : typeof data.error === "string"
              ? data.error
              : "AI request failed.";
        setError(detail);
        setDebugInfo(
          JSON.stringify(
            {
              stage: data.stage,
              via: data.via,
              debug: data.debug,
              details: data.details,
              modelOutputPreview: data.modelOutputPreview,
            },
            null,
            2,
          ),
        );
        return;
      }
      if (data.skipped) {
        setError(String(data.reason ?? "AI skipped (no API key)."));
      }
      setAiText("");
      setDebugInfo(
        JSON.stringify(
          { via: data.via ?? "model", debug: data.debug ?? null, opCount: Array.isArray(data.ops) ? data.ops.length : undefined },
          null,
          2,
        ),
      );
      await load();
    } finally {
      setAiBusy(false);
    }
  };

  const patchComplete = async (occ: Occurrence, completed: boolean) => {
    const res = await fetch(`/api/calendar/occurrences/${occ.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    if (!res.ok) {
      setError("Could not update task.");
      return;
    }
    await load();
    setSelected(null);
  };

  const deleteOcc = async (occ: Occurrence) => {
    const res = await fetch(`/api/calendar/occurrences/${occ.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete.");
      return;
    }
    await load();
    setSelected(null);
  };

  const rescheduleOverdue = async (occ: Occurrence) => {
    setAiBusy(true);
    setError(null);
    setDebugInfo(null);
    try {
      const res = await fetch("/api/calendar/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Reschedule overdue task "${occ.title}" (occurrenceId ${occ.id}) within working hours this week. Keep total duration the same unless I asked otherwise.`,
          weekStart,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : typeof data.error === "string"
              ? data.error
              : "Reschedule failed.";
        setError(detail);
        setDebugInfo(
          JSON.stringify(
            {
              stage: data.stage,
              via: data.via,
              debug: data.debug,
              details: data.details,
              modelOutputPreview: data.modelOutputPreview,
            },
            null,
            2,
          ),
        );
        return;
      }
      if (data.skipped) {
        setError(String(data.reason ?? "AI skipped (no API key)."));
      }
      await load();
      setSelected(null);
    } finally {
      setAiBusy(false);
    }
  };

  const runGeminiDebug = async () => {
    setDebugBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/debug/gemini");
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : String(data.error ?? "Gemini debug failed."));
        setDebugInfo(JSON.stringify(data, null, 2));
        return;
      }
      setError(`Gemini debug OK: ${String(data.text ?? "").slice(0, 160)}`);
      setDebugInfo(JSON.stringify(data, null, 2));
    } finally {
      setDebugBusy(false);
    }
  };

  const seedTestItem = async () => {
    setSeedBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/debug/seed-item", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Seed insert failed.");
        setDebugInfo(JSON.stringify(data, null, 2));
        return;
      }
      await load();
      setError(`Inserted test item for ${String(data.startAt ?? "").slice(11, 16)} (Sydney-local approx).`);
      setDebugInfo(JSON.stringify(data, null, 2));
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <div className="flex h-[75vh] w-[75vw] max-w-[75vw] min-w-0 flex-col gap-4 overflow-hidden p-4 md:p-6">
      <button
        type="button"
        className="fixed right-4 top-3 z-50 text-sm text-zinc-600 underline-offset-2 hover:underline"
        onClick={() => void signOut({ callbackUrl: "/signin" })}
      >
        Sign out
      </button>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
            onClick={() => shiftWeek(-1)}
          >
            Previous week
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
            onClick={() => shiftWeek(1)}
          >
            Next week
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
            onClick={() => setWeekStart(currentMondayYmd())}
          >
            This week
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            disabled={debugBusy}
            onClick={() => void runGeminiDebug()}
          >
            {debugBusy ? "Testing Gemini..." : "Test Gemini"}
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            disabled={seedBusy}
            onClick={() => void seedTestItem()}
          >
            {seedBusy ? "Inserting..." : "Insert Test Item"}
          </button>
        </div>
      </header>

      {error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          {error}
        </p>
      ) : null}
      {debugInfo ? (
        <pre className="max-h-40 overflow-auto rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
          {debugInfo}
        </pre>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-2 pr-1 md:gap-3">
            {dayLabels.map((d, idx) => (
              <div
                key={d.iso}
                className={
                  idx === 5
                    ? "ml-2 flex min-w-[120px] flex-1 flex-col gap-1 md:ml-6 md:min-w-[140px]"
                    : "flex min-w-[120px] flex-1 flex-col gap-1 md:min-w-[140px]"
                }
              >
                <div
                  className={
                    d.iso === nowSydney.toISODate()
                      ? "rounded-md border border-dashed border-accent px-2 py-1 text-center text-sm font-medium text-black"
                      : d.iso < nowSydney.toISODate()!
                        ? "rounded-md bg-zinc-100 px-2 py-1 text-center text-sm font-medium text-zinc-500"
                        : "rounded-md px-2 py-1 text-center text-sm font-medium text-zinc-800"
                  }
                >
                  {d.short} {d.day}
                </div>
                <div
                  className="relative rounded-md border border-zinc-200 bg-white shadow-sm"
                  style={{ height: COLUMN_HEIGHT }}
                >
                  {(() => {
                    const line = nowLineForDay(d.offset);
                    return line ? (
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                        style={{ top: line.top }}
                      >
                        <div className="h-px flex-1 bg-red-500" />
                        <span className="rounded-full border border-red-500 bg-white px-2 py-0.5 text-xs font-medium text-red-600">
                          {line.label}
                        </span>
                        <div className="h-px flex-1 bg-red-500" />
                      </div>
                    ) : null;
                  })()}
                  {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Loading…</div>
                  ) : null}
                  {placeOccurrencesForDay(weekStart, d.offset, occurrences).map((occ) => {
                    const completed = Boolean(occ.completedAt);
                    const overdue = occ.isOverdue;
                    const border = completed
                      ? "border-green-600"
                      : overdue
                        ? "border-orange-500"
                        : "border-zinc-900";
                    return (
                      <button
                        key={`${occ.id}-${d.iso}`}
                        type="button"
                        className={`absolute left-1 right-1 z-10 flex items-stretch gap-2 rounded-md border bg-white px-2 py-1 text-left text-xs shadow-sm ${border}`}
                        style={{ top: occ.top, height: occ.height }}
                        onClick={() => setSelected(occ)}
                      >
                        {occ.type === "task" ? (
                          <span
                            className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              completed ? "border-green-600 bg-green-50" : "border-zinc-400"
                            }`}
                            aria-hidden
                          >
                            {completed ? "✓" : ""}
                          </span>
                        ) : (
                          <span className="mt-0.5 inline-block w-4 shrink-0" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{occ.title}</span>
                        {!completed && occ.type === "task" ? (
                          <button
                            type="button"
                            className="shrink-0 leading-none text-zinc-400 hover:text-zinc-700"
                            aria-label="Delete task"
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteOcc(occ);
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <form
        className="mx-auto flex w-full max-w-3xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitAi();
        }}
      >
        <input
          className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 shadow-inner outline-none ring-accent placeholder:text-zinc-400 focus:ring-2"
          placeholder="Add tasks, edit calendar…"
          value={aiText}
          onChange={(e) => setAiText(e.target.value)}
          disabled={aiBusy}
        />
        <button
          type="submit"
          disabled={aiBusy}
          className="rounded-full bg-accent px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {aiBusy ? "…" : "Send"}
        </button>
      </form>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-zinc-900">{selected.title}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {selected.type === "task" ? "Task" : "Activity"}
              {selected.movable ? " · Movable" : " · Fixed"}
            </p>
            <ul className="mt-3 space-y-1 text-xs text-zinc-700">
              {selected.segments.map((s) => (
                <li key={`${s.startAt}-${s.endAt}`}>
                  {DateTime.fromISO(s.startAt).setZone(SYDNEY_TZ).toFormat("ccc d LLL, h:mm a")} –{" "}
                  {DateTime.fromISO(s.endAt).setZone(SYDNEY_TZ).toFormat("h:mm a")}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.type === "task" ? (
                <button
                  type="button"
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white"
                  onClick={() => void patchComplete(selected, !selected.completedAt)}
                >
                  {selected.completedAt ? "Mark incomplete" : "Mark complete"}
                </button>
              ) : null}
              {selected.isOverdue && selected.type === "task" ? (
                <button
                  type="button"
                  className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white"
                  onClick={() => void rescheduleOverdue(selected)}
                >
                  Reschedule
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800"
                onClick={() => void deleteOcc(selected)}
              >
                Delete
              </button>
              <button
                type="button"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
