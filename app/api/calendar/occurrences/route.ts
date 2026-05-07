import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/auth";
import { getDb } from "@/lib/mongodb";
import { currentMondayYmd, weekRangeUtcFromMonday } from "@/lib/calendar/sydneyWeek";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const weekStart = url.searchParams.get("weekStart") ?? currentMondayYmd();
  const { fromUtc, toUtc } = weekRangeUtcFromMonday(weekStart);

  let uid: ObjectId;
  try {
    uid = new ObjectId(session.user.id);
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const db = await getDb();
  const occs = await db
    .collection("calendar_occurrences")
    .find({
      userId: uid,
      segments: {
        $elemMatch: {
          startAt: { $lt: toUtc },
          endAt: { $gt: fromUtc },
        },
      },
    })
    .toArray();

  const seriesIds = [...new Set(occs.map((o) => o.seriesId.toString()))].map((id) => new ObjectId(id));
  const seriesList =
    seriesIds.length > 0
      ? await db
          .collection("calendar_series")
          .find({ _id: { $in: seriesIds }, userId: uid })
          .toArray()
      : [];
  const seriesById = new Map(seriesList.map((s) => [s._id.toString(), s]));

  const now = new Date();
  const payload = occs.map((o) => {
    const s = seriesById.get(o.seriesId.toString());
    const type = (s?.type ?? "task") as "task" | "activity";
    const title = (s?.title ?? "Untitled") as string;
    const movable = Boolean(s?.movable);
    const colorHex =
      typeof s?.colorHex === "string" && /^#(?:[0-9A-Fa-f]{6})$/.test(s.colorHex)
        ? s.colorHex.toUpperCase()
        : "#66AA3C";
    const completedAt = o.completedAt ?? null;
    const segs = Array.isArray(o.segments) ? o.segments : [];
    const lastEnd =
      segs.length > 0
        ? segs.reduce(
            (max: Date, seg: { endAt: Date }) => (seg.endAt > max ? seg.endAt : max),
            segs[0].endAt,
          )
        : now;
    const isOverdue = type === "task" && !completedAt && lastEnd < now;
    return {
      id: o._id.toString(),
      seriesId: o.seriesId.toString(),
      type,
      title,
      movable,
      colorHex,
      segments: segs.map((seg: { startAt: Date; endAt: Date }) => ({
        startAt: seg.startAt.toISOString(),
        endAt: seg.endAt.toISOString(),
      })),
      completedAt: completedAt ? completedAt.toISOString() : null,
      isOverdue,
    };
  });

  return NextResponse.json({ weekStart, fromUtc: fromUtc.toISOString(), toUtc: toUtc.toISOString(), occurrences: payload });
}
