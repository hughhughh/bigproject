import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { DateTime } from "luxon";
import { auth } from "@/auth";
import { getDb } from "@/lib/mongodb";

const SYDNEY_TZ = "Australia/Sydney";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let uid: ObjectId;
  try {
    uid = new ObjectId(session.user.id);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid session user id" }, { status: 400 });
  }

  const db = await getDb();
  const now = new Date();
  const startLocal = DateTime.now().setZone(SYDNEY_TZ).plus({ minutes: 10 });
  const endLocal = startLocal.plus({ minutes: 30 });
  const startAt = startLocal.toUTC().toJSDate();
  const endAt = endLocal.toUTC().toJSDate();

  const seriesInsert = await db.collection("calendar_series").insertOne({
    userId: uid,
    type: "activity",
    title: "Test Item",
    movable: false,
    colorHex: "#66AA3C",
    durationMinutes: 30,
    createdAt: now,
    updatedAt: now,
  });

  const occurrenceInsert = await db.collection("calendar_occurrences").insertOne({
    userId: uid,
    seriesId: seriesInsert.insertedId,
    segments: [{ startAt, endAt }],
    completedAt: null,
    source: "user",
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    ok: true,
    seriesId: seriesInsert.insertedId.toString(),
    occurrenceId: occurrenceInsert.insertedId.toString(),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  });
}
